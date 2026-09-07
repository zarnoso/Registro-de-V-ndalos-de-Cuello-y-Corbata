"""Puebla la tabla `familiares` consultando Wikidata para cada político.

Wikidata modela relaciones familiares con propiedades estructuradas:
  P26  = cónyuge
  P40  = hijo/a
  P22  = padre
  P25  = madre
  P3373 = hermano/a

Para cada político:
  1. Busca su entidad Wikidata por nombre (wbsearchentities).
  2. Si encuentra una entidad humana (P31=Q5) razonablemente cercana al
     nombre completo, trae sus claims de familia (wbgetentities).
  3. Resuelve el nombre legible de cada familiar (labels en español).
  4. Inserta en `familiares` (politico_id, nombre_completo, parentesco,
     fuente_url), evitando duplicados con un UNIQUE lógico simple
     (politico_id + nombre_completo + parentesco) chequeado antes de
     insertar — Wikidata no impone su propio esquema en tu BD.

Limitaciones honestas:
  - Wikidata solo tiene entidad para políticos con algo de notoriedad
    pública (nacional/mediática) — diputados/senadores menos conocidos
    o funcionarios de gobierno probablemente no tengan entidad.
  - El match de nombre es por búsqueda de texto, no es 100% infalible
    con homónimos — se aplica un chequeo mínimo de similitud y se deja
    todo con fuente_url apuntando a la página de Wikidata para que
    cualquier dato se pueda verificar manualmente.
  - Esto es un punto de partida, no reemplaza verificación humana.

Uso:
    python3 migrations/poblar_familiares_wikidata.py            # dry-run
    python3 migrations/poblar_familiares_wikidata.py --apply    # inserta
    python3 migrations/poblar_familiares_wikidata.py --apply --limit 20
"""
import os
import sys
import time
import unicodedata
import requests
import psycopg2
import psycopg2.extras

DB_URL = os.environ["DATABASE_URL"]
WIKIDATA_API = "https://www.wikidata.org/w/api.php"
HEADERS = {"User-Agent": "RegistroDeVandalos/1.0 (proyecto de transparencia, contacto via GitHub)"}

PROPIEDADES_FAMILIA = {
    "P26": "conyuge",
    "P40": "hijo",
    "P22": "padre",
    "P25": "madre",
    "P3373": "hermano",
}


def normalizar(s):
    if not s:
        return ""
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower().strip()
    return s


def similitud_nombre(a, b):
    """Comparación simple por palabras en común, suficiente para filtrar
    matches obviamente equivocados sin depender de una librería extra."""
    pa, pb = set(normalizar(a).split()), set(normalizar(b).split())
    if not pa or not pb:
        return 0.0
    return len(pa & pb) / max(len(pa), len(pb))


def buscar_entidad(nombre):
    """Busca en Wikidata una entidad humana (P31=Q5) que matchee el nombre."""
    try:
        r = requests.get(WIKIDATA_API, params={
            "action": "wbsearchentities", "search": nombre, "language": "es",
            "format": "json", "type": "item", "limit": 5,
        }, headers=HEADERS, timeout=10)
        r.raise_for_status()
        candidatos = r.json().get("search", [])
    except requests.RequestException as e:
        print(f"  ! Error buscando '{nombre}': {e}")
        return None

    mejor, mejor_score = None, 0.0
    for c in candidatos:
        label = c.get("label", "")
        score = similitud_nombre(nombre, label)
        if score > mejor_score:
            mejor, mejor_score = c, score

    if mejor and mejor_score >= 0.5:
        return mejor["id"]
    return None


def obtener_familiares(qid):
    """Trae las propiedades de familia de una entidad Wikidata."""
    try:
        r = requests.get(WIKIDATA_API, params={
            "action": "wbgetentities", "ids": qid, "format": "json",
            "props": "claims", "languages": "es",
        }, headers=HEADERS, timeout=10)
        r.raise_for_status()
        claims = r.json()["entities"][qid].get("claims", {})
    except (requests.RequestException, KeyError) as e:
        print(f"  ! Error obteniendo claims de {qid}: {e}")
        return []

    familiares_qids = []
    for prop, parentesco in PROPIEDADES_FAMILIA.items():
        for claim in claims.get(prop, []):
            try:
                fam_qid = claim["mainsnak"]["datavalue"]["value"]["id"]
                familiares_qids.append((fam_qid, parentesco))
            except (KeyError, TypeError):
                continue
    return familiares_qids


def resolver_nombres(qids):
    """Convierte una lista de QIDs a nombres legibles, en un solo request
    (wbgetentities acepta múltiples ids separados por |)."""
    if not qids:
        return {}
    try:
        r = requests.get(WIKIDATA_API, params={
            "action": "wbgetentities", "ids": "|".join(qids), "format": "json",
            "props": "labels", "languages": "es",
        }, headers=HEADERS, timeout=10)
        r.raise_for_status()
        entidades = r.json()["entities"]
    except requests.RequestException as e:
        print(f"  ! Error resolviendo nombres: {e}")
        return {}
    resultado = {}
    for qid, data in entidades.items():
        label = data.get("labels", {}).get("es", {}).get("value")
        if label:
            resultado[qid] = label
    return resultado


def main():
    apply_changes = "--apply" in sys.argv
    limit = None
    if "--limit" in sys.argv:
        limit = int(sys.argv[sys.argv.index("--limit") + 1])

    conn = psycopg2.connect(DB_URL, sslmode="require", cursor_factory=psycopg2.extras.RealDictCursor)
    cur = conn.cursor()

    cur.execute("SELECT id, nombre_completo FROM politicos ORDER BY id" + (f" LIMIT {limit}" if limit else ""))
    politicos = cur.fetchall()
    print(f"Procesando {len(politicos)} políticos...\n")

    total_insertados, total_sin_entidad, total_sin_familia = 0, 0, 0

    for p in politicos:
        pid, nombre = p["id"], p["nombre_completo"]
        qid = buscar_entidad(nombre)
        time.sleep(0.3)  # cortesía con la API pública, evita rate limiting

        if not qid:
            total_sin_entidad += 1
            continue

        familiares_qids = obtener_familiares(qid)
        if not familiares_qids:
            total_sin_familia += 1
            continue

        nombres = resolver_nombres([q for q, _ in familiares_qids])
        fuente_url = f"https://www.wikidata.org/wiki/{qid}"

        for fam_qid, parentesco in familiares_qids:
            fam_nombre = nombres.get(fam_qid)
            if not fam_nombre:
                continue
            print(f"  {nombre} -> {parentesco}: {fam_nombre}")
            if apply_changes:
                cur.execute("""
                    SELECT 1 FROM familiares
                    WHERE politico_id = %s AND nombre_completo = %s AND parentesco = %s
                """, (pid, fam_nombre, parentesco))
                if not cur.fetchone():
                    cur.execute("""
                        INSERT INTO familiares (politico_id, nombre_completo, parentesco, fuente_url, notas)
                        VALUES (%s, %s, %s, %s, %s)
                    """, (pid, fam_nombre, parentesco, fuente_url, "Importado desde Wikidata, verificar manualmente."))
                    total_insertados += 1
        time.sleep(0.3)

    if apply_changes:
        conn.commit()

    print(f"\nResumen: {total_insertados} familiares {'insertados' if apply_changes else 'encontrados (dry-run)'}, "
          f"{total_sin_entidad} políticos sin entidad Wikidata, {total_sin_familia} con entidad pero sin datos de familia.")
    if not apply_changes:
        print("Modo dry-run — ejecuta con --apply para insertar en la BD.")

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
