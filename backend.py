"""
Backend Registro de Vándalos v3
"""
import os
import time
from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
import psycopg2
import psycopg2.extras

app = FastAPI(title="Registro de Vándalos API v3")

# Servir archivos estáticos (CSS, JS) desde frontend/assets
app.mount("/assets", StaticFiles(directory="frontend/assets"), name="assets")

# ══════════════════════════════════════════════════════
# CACHÉ EN MEMORIA (TTL 5 minutos)
# ══════════════════════════════════════════════════════
_cache = {}
CACHE_TTL = 300  # 5 minutos

def cache_get(key):
    entry = _cache.get(key)
    if not entry:
        return None
    if time.time() - entry['ts'] < CACHE_TTL:
        return entry['data']
    del _cache[key]
    return None

def cache_set(key, data):
    _cache[key] = {'data': data, 'ts': time.time()}

def cache_clear():
    _cache.clear()

MAX_LIMIT = 1000

def bound_params(limit: int, skip: int = 0):
    """Acota limit/skip para evitar que un cliente pida materializar millones de filas."""
    return max(0, min(limit, MAX_LIMIT)), max(0, skip)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://registrodevandalos.likay.cl", "https://registrodevandalos.pages.dev", "http://192.168.100.23", "http://localhost:8006"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_URL = os.environ.get("DATABASE_URL")
if not DB_URL:
    raise RuntimeError("DATABASE_URL no configurada")

def get_db():
    return psycopg2.connect(DB_URL, sslmode='require', cursor_factory=psycopg2.extras.RealDictCursor)

def calcular_riesgo(casos_count):
    if casos_count > 2:
        return "alerta_roja"
    elif casos_count > 0:
        return "alerta_naranja"
    return "sin_registros"

def calcular_riesgo_heredado(casos_propios, casos_familiares):
    """Punto 6: el entorno (familiares con casos) sube el score aunque
    el político no tenga antecedentes directos — visibiliza a quien 'pasa piola'."""
    score = casos_propios + 0.5 * casos_familiares
    if score > 2:
        return "alerta_roja"
    elif score > 0:
        return "alerta_naranja"
    return "sin_registros"

# Mapeo de traducción: los valores reales de casos_corrupcion.estado están en
# español y con variantes de redacción ("Condenado"/"Condenada", "querella"/
# "Querella"), no coinciden con las claves internas en inglés que usa el
# frontend (formatProcessState). Se traduce acá, en un solo punto, en vez de
# normalizar la BD (se preserva el dato original tal como se registró, y en
# vez de forzar traducción al frontend, que tendría que conocer cada variante).
_ESTADO_MAP = {
    "condenado": "condenado", "condenada": "condenado", "sentenciado": "condenado", "sentencia": "condenado",
    "en investigación": "abierto", "en investigacion": "abierto", "activo": "abierto",
    "formalizado": "abierto", "imputado": "abierto", "prisión preventiva": "abierto",
    "prision preventiva": "abierto", "querella": "abierto",
    "suspensión condicional": "cerrado_sin_condena", "suspension condicional": "cerrado_sin_condena",
    "responsable sin condena": "cerrado_sin_condena",
    "absuelto": "cerrado_sin_condena", "sobreseido": "cerrado_sin_condena", "archivado": "cerrado_sin_condena",
}

def normalizar_estado(estado_original):
    """Traduce el estado real de la BD (español, con variantes) a la clave
    interna que espera el frontend. Sin match conocido → 'sin_estado' (incluye
    el 73% de casos con estado vacío en la BD: ausencia de dato, no un estado)."""
    if not estado_original:
        return "sin_estado"
    return _ESTADO_MAP.get(estado_original.strip().lower(), "sin_estado")

def _nombre_corto(nombre_completo):
    """Retorna las dos primeras palabras del nombre (p.ej. "Luis Hermosilla Jorche" -> "Luis Hermosilla"),
    usado para matchear casos cuyo campo `responsable` usa la forma pública (nombre + apellido paterno)."""
    if not nombre_completo:
        return ""
    partes = str(nombre_completo).split()
    if len(partes) < 2:
        return (partes[0] + " ") if partes else ""
    return f"%{partes[0]} {partes[1]}%"

@app.get("/")
def root():
    frontend_path = os.path.join(os.path.dirname(__file__), "frontend", "index.html")
    if os.path.exists(frontend_path):
        return FileResponse(frontend_path)
    return {"message": "API OK"}

@app.get("/health")
def health():
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("SELECT 1")
        cur.close()
        conn.close()
        return {"status": "healthy"}
    except Exception as e:
        return {"status": "unhealthy", "error": str(e)[:200]}

@app.get("/api/politicos/")
def listar_politicos(limit: int = 500, skip: int = 0):
    limit, skip = bound_params(limit, skip)
    cache_key = f"politicos_{limit}_{skip}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached

    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT
                p.id, p.nombre_completo, p.tipo, p.region, p.partido, p.foto_url,
                COALESCE(cc.casos_count, 0) AS num_eventos,
                COALESCE(fam.fam_count, 0) AS num_familiares,
                COALESCE(pat.pat_count, 0) AS num_empresas,
                COALESCE(fam_casos.casos_familiares, 0) AS casos_familiares,
                del.delitos_resumen
            FROM politicos p
            LEFT JOIN (
                SELECT p2.id AS politico_id, COUNT(*) AS casos_count
                FROM casos_corrupcion
                JOIN politicos p2 ON (
                    casos_corrupcion.responsable ILIKE '%%' || p2.nombre_completo || '%%'
                    OR casos_corrupcion.responsable ILIKE '%%' || split_part(p2.nombre_completo, ' ', 1) || ' ' || split_part(p2.nombre_completo, ' ', 2) || '%%'
                )
                GROUP BY p2.id
            ) cc ON cc.politico_id = p.id
            LEFT JOIN (
                SELECT politico_id, COUNT(*) AS fam_count
                FROM familiares
                GROUP BY politico_id
            ) fam ON fam.politico_id = p.id
            LEFT JOIN (
                SELECT politico_id, COUNT(*) AS pat_count
                FROM patrimonio
                GROUP BY politico_id
            ) pat ON pat.politico_id = p.id
            LEFT JOIN (
                SELECT f.politico_id, COUNT(*) AS casos_familiares
                FROM familiares f
                JOIN casos_corrupcion cc2 ON cc2.responsable ILIKE '%%' || f.nombre_completo || '%%'
                GROUP BY f.politico_id
            ) fam_casos ON fam_casos.politico_id = p.id
            LEFT JOIN (
                SELECT p3.id AS politico_id, STRING_AGG(DISTINCT casos_corrupcion.delitos, ' · ' ORDER BY casos_corrupcion.delitos) AS delitos_resumen
                FROM casos_corrupcion
                JOIN politicos p3 ON (
                    casos_corrupcion.responsable ILIKE '%%' || p3.nombre_completo || '%%'
                    OR casos_corrupcion.responsable ILIKE '%%' || split_part(p3.nombre_completo, ' ', 1) || ' ' || split_part(p3.nombre_completo, ' ', 2) || '%%'
                )
                WHERE casos_corrupcion.delitos IS NOT NULL AND casos_corrupcion.delitos != ''
                GROUP BY p3.id
            ) del ON del.politico_id = p.id
            ORDER BY p.nombre_completo
            LIMIT %s OFFSET %s
        """, (limit, skip))

        rows = cur.fetchall()
        resultado = []
        for r in rows:
            num_eventos = r['num_eventos']
            casos_familiares = r['casos_familiares']
            estado_riesgo = calcular_riesgo_heredado(num_eventos, casos_familiares)
            tipo = (r['tipo'] or "").lower()
            TIPO_CARGO = {
                "diputado": ("Congreso", "Diputado"),
                "senador": ("Congreso", "Senador"),
                "ex_diputado": ("Ex Congreso", "Ex Diputado"),
                "ex_senador": ("Ex Congreso", "Ex Senador"),
                "ex_diputada": ("Ex Congreso", "Ex Diputada"),
                "ministro": ("Gobierno", "Ministro"),
                "ex_ministro": ("Ex Gobierno", "Ex Ministro"),
                "alcalde": ("Municipalidad", "Alcalde"),
                "ex_intendenta": ("Ex Gobernación", "Ex Intendenta"),
                "empresario": ("Sector Privado", "Empresario"),
                "abogado": ("Sector Privado", "Abogado"),
                "abogada": ("Sector Privado", "Abogada"),
                "asesor_politico": ("Operador Político", "Asesor"),
                "asesora_politica": ("Operador Político", "Asesora"),
                "asesora_juridica": ("Operador Político", "Asesora Jurídica"),
                "asesor_financiero": ("Operador Político", "Asesor Financiero"),
                "funcionario_publico": ("Estado", "Funcionario Público"),
                "funcionaria_udia": ("Estado", "Funcionaria"),
                "dirigente_politico": ("Partido Político", "Dirigente"),
                "dirigenta_politica": ("Partido Político", "Dirigenta"),
                "contadora": ("Sector Privado", "Contadora"),
                "periodista": ("Medios", "Periodista"),
                "ex_magistrada": ("Poder Judicial", "Ex Magistrada"),
                "persona_vinculada": ("Vínculo Político", "Vínculo"),
            }
            institucion, cargo = TIPO_CARGO.get(tipo, ("Otro", tipo.capitalize() if tipo else "Otro"))
            resultado.append({
                "id": r['id'], "nombre_completo": r['nombre_completo'] or "Sin nombre",
                "tipo": r['tipo'], "region": r['region'] or "Sin región",
                "institucion": institucion, "cargo": cargo,
                "partido": r['partido'] or "Sin partido", "foto_url": r['foto_url'],
                "estado_riesgo": estado_riesgo,
                "num_eventos": num_eventos, "num_empresas": r['num_empresas'],
                "num_familiares": r['num_familiares'], "casos_familiares": casos_familiares,
                "delitos_resumen": r['delitos_resumen'] or None,
                "eventos": [], "patrimonios": [],
            })
    finally:
        cur.close()
        conn.close()
    cache_set(cache_key, resultado)
    return resultado

@app.get("/api/politicos/grafo")
def grafo(limit: int = 250):
    limit, _ = bound_params(limit)
    cached = cache_get("grafo")
    if cached is not None:
        return cached
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT p.id, p.nombre_completo, p.tipo, p.region,
                   COALESCE(cc.casos_count, 0) AS casos_count
            FROM politicos p
            LEFT JOIN (
                SELECT p2.id AS politico_id, COUNT(*) AS casos_count
                FROM casos_corrupcion
                JOIN politicos p2 ON (
                    casos_corrupcion.responsable ILIKE '%%' || p2.nombre_completo || '%%'
                    OR casos_corrupcion.responsable ILIKE '%%' || split_part(p2.nombre_completo, ' ', 1) || ' ' || split_part(p2.nombre_completo, ' ', 2) || '%%'
                )
                GROUP BY p2.id
            ) cc ON cc.politico_id = p.id
            LIMIT %s
        """, (limit,))
        politico_rows = cur.fetchall()
        nodes = [{"id": f"politico:{r['id']}", "tipo": "politico", "etiqueta": r['nombre_completo'],
                  "metadata": {"region": r['region'], "estado": "condenado" if r['casos_count'] > 2 else ("abierto" if r['casos_count'] > 0 else "sin_estado")}} for r in politico_rows]
        politico_ids = [r['id'] for r in politico_rows]
        edges = []
        cur.execute("SELECT politico_origen_id, politico_destino_id, tipo_relacion FROM relaciones WHERE activo = true ORDER BY id LIMIT 200")
        for r in cur.fetchall():
            if r['politico_origen_id'] in politico_ids and r['politico_destino_id'] in politico_ids:
                edges.append({"origen": f"politico:{r['politico_origen_id']}", "destino": f"politico:{r['politico_destino_id']}", "tipo": r['tipo_relacion']})
        if politico_ids:
            cur.execute("""
                SELECT f.id, f.politico_id, f.nombre_completo, f.parentesco, COALESCE(cc.casos_count, 0) AS casos_count
                FROM familiares f
                LEFT JOIN (SELECT responsable, COUNT(*) AS casos_count FROM casos_corrupcion GROUP BY responsable) cc
                       ON f.nombre_completo ILIKE '%%' || cc.responsable || '%%'
                WHERE f.politico_id = ANY(%s)
            """, (politico_ids,))
            for f in cur.fetchall():
                fam_node_id = f"familiar:{f['id']}"
                nodes.append({"id": fam_node_id, "tipo": "familiar", "etiqueta": f['nombre_completo'],
                              "metadata": {"parentesco": f['parentesco'], "estado": "condenado" if f['casos_count'] > 2 else ("abierto" if f['casos_count'] > 0 else "sin_estado")}})
                edges.append({"origen": f"politico:{f['politico_id']}", "destino": fam_node_id, "tipo": f['parentesco'] or "familiar"})
    finally:
        cur.close()
        conn.close()
    result = {"nodes": nodes, "edges": edges}
    cache_set("grafo", result)
    return result

# =============================================================================
# SOM - Self-Organizing Map (Mapa de Similitudes)
# =============================================================================
@app.get("/api/politicos/analitica/som")
def som(limit: int = 500):
    limit, _ = bound_params(limit)
    cached = cache_get("som")
    if cached is not None:
        return cached
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT p.id, p.nombre_completo, p.tipo, p.region, p.partido,
                   COALESCE(cc.casos_count, 0) AS casos_count,
                   COALESCE(fam.fam_count, 0) AS fam_count,
                   COALESCE(fam_casos.casos_familiares, 0) AS casos_familiares
            FROM politicos p
            LEFT JOIN (
                SELECT p2.id AS politico_id, COUNT(*) AS casos_count
                FROM casos_corrupcion
                JOIN politicos p2 ON (
                    casos_corrupcion.responsable ILIKE '%%' || p2.nombre_completo || '%%'
                    OR casos_corrupcion.responsable ILIKE '%%' || split_part(p2.nombre_completo, ' ', 1) || ' ' || split_part(p2.nombre_completo, ' ', 2) || '%%'
                )
                GROUP BY p2.id
            ) cc ON cc.politico_id = p.id
            LEFT JOIN (
                SELECT politico_id, COUNT(*) AS fam_count
                FROM familiares
                GROUP BY politico_id
            ) fam ON fam.politico_id = p.id
            LEFT JOIN (
                SELECT f.politico_id, COUNT(*) AS casos_familiares
                FROM familiares f
                JOIN casos_corrupcion cc2 ON cc2.responsable ILIKE '%%' || f.nombre_completo || '%%'
                GROUP BY f.politico_id
            ) fam_casos ON fam_casos.politico_id = p.id
            ORDER BY p.nombre_completo
            LIMIT %s
        """, (limit,))
        rows = cur.fetchall()
        resultado = []
        for r in rows:
            casos_count = r['casos_count']
            casos_familiares = r['casos_familiares']
            estado_riesgo = calcular_riesgo_heredado(casos_count, casos_familiares)
            resultado.append({
                "id": r['id'], "nombre_completo": r['nombre_completo'],
                "tipo": r['tipo'], "region": r['region'], "partido": r['partido'],
                "estado_riesgo": estado_riesgo, "num_eventos": casos_count,
                "num_familiares": r['fam_count'], "casos_familiares": casos_familiares,
            })
    finally:
        cur.close()
        conn.close()
    cache_set("som", resultado)
    return resultado

# Ruta duplicada para compatibilidad con frontend anterior
@app.get("/api/som/")
def som_legacy():
    return som()

@app.get("/api/politicos/{politico_id}")
def detalle_politico(politico_id: int):
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM politicos WHERE id = %s", (politico_id,))
        p = cur.fetchone()
        if not p:
            raise HTTPException(status_code=404, detail="Político no encontrado")
        cur.execute("""
            SELECT nombre as caso_nombre, año_inicio as fecha_inicio, estado as estado_actual, sentencia as resumen, fuente_url as fuente, delitos, conclusión as conclusion
            FROM casos_corrupcion WHERE politico_id = %s OR responsable ILIKE %s OR responsable ILIKE %s ORDER BY año_inicio DESC NULLS LAST
        """, (politico_id, f"%{p['nombre_completo']}%", _nombre_corto(p['nombre_completo'])))
        eventos = [dict(row) for row in cur.fetchall()]
        for e in eventos:
            e["estado_normalizado"] = normalizar_estado(e.get("estado_actual"))
        cur.execute("SELECT * FROM familiares WHERE politico_id = %s", (politico_id,))
        familiares = [dict(row) for row in cur.fetchall()]
        if familiares:
            cur.execute("""
                SELECT f.id, COUNT(DISTINCT cc.id) AS cnt
                FROM familiares f
                JOIN casos_corrupcion cc ON cc.responsable ILIKE '%%' || f.nombre_completo || '%%'
                WHERE f.politico_id = %s
                GROUP BY f.id
            """, (politico_id,))
            fam_counts = {r['id']: r['cnt'] for r in cur.fetchall()}
            for f in familiares:
                f['casos_count'] = fam_counts.get(f['id'], 0)
        cur.execute("SELECT alias_tipo, alias_nombre, fuente_url, verificado FROM politicos_aliases WHERE politico_id = %s", (politico_id,))
        aliases = [dict(row) for row in cur.fetchall()]
        cur.execute("SELECT * FROM patrimonio WHERE politico_id = %s", (politico_id,))
        patrimonios = [dict(row) for row in cur.fetchall()]
        cur.execute("""
            SELECT n.id, n.titulo, n.fuente, n.fecha_publicacion, n.url, nm.contexto
            FROM noticias n JOIN noticias_menciones nm ON n.id = nm.noticia_id
            WHERE nm.politico_id = %s
              AND COALESCE(nm.valida_v2, true) = true
            ORDER BY n.fecha_publicacion DESC LIMIT 20
        """, (politico_id,))
        # TODO: una vez corrido `migrations/audit_noticias_menciones.py --apply`
        # (agrega la columna nm.valida_v2), sumar al WHERE de arriba:
        #   AND COALESCE(nm.valida_v2, true) = true
        # para no mostrar menciones marcadas como falso positivo por el matching
        # viejo. No agregar antes: si la columna no existe, la query falla.
        noticias = [dict(row) for row in cur.fetchall()]
    finally:
        cur.close()
        conn.close()
    casos_count = len(eventos)
    casos_familiares = sum(f.get('casos_count', 0) for f in familiares)
    return {
        "id": p['id'], "nombre_completo": p['nombre_completo'], "tipo": p['tipo'],
        "region": p['region'] or "Sin región", "partido": p['partido'] or "Sin partido",
        "estado_riesgo": calcular_riesgo_heredado(casos_count, casos_familiares),
        "num_eventos": casos_count, "num_familiares": len(familiares),
        "num_empresas": len(patrimonios), "num_noticias": len(noticias),
        "casos_familiares": casos_familiares, "eventos": eventos, "familiares": familiares,
        "aliases": aliases, "patrimonios": patrimonios, "noticias": noticias,
    }

@app.get("/api/casos/")
def casos(limit: int = 100, skip: int = 0):
    limit, skip = bound_params(limit, skip)
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT id, nombre, monto, año, responsable, sector, estado, fuente_url FROM casos_corrupcion ORDER BY año_inicio DESC NULLS LAST LIMIT %s OFFSET %s", (limit, skip))
        rows = [dict(r) for r in cur.fetchall()]
        for r in rows:
            r["estado_normalizado"] = normalizar_estado(r.get("estado"))
    finally:
        cur.close()
        conn.close()
    return rows

@app.get("/api/noticias/")
def noticias(limit: int = 100, skip: int = 0):
    limit, skip = bound_params(limit, skip)
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT id, titulo, fuente, fecha_publicacion, url FROM noticias ORDER BY created_at DESC LIMIT %s OFFSET %s", (limit, skip))
        rows = [dict(r) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()
    return rows

@app.get("/api/stats")
def stats():
    cached = cache_get("stats")
    if cached is not None:
        return cached
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) as total FROM politicos")
        p = cur.fetchone()['total']
        cur.execute("SELECT COUNT(*) as total FROM casos_corrupcion")
        c = cur.fetchone()['total']
        cur.execute("SELECT COUNT(*) as total FROM noticias")
        n = cur.fetchone()['total']
        cur.execute("SELECT COUNT(*) as total FROM relaciones")
        rel = cur.fetchone()['total']
        cur.execute("SELECT COUNT(*) as total FROM familiares")
        fam = cur.fetchone()['total']
        cur.execute("SELECT COUNT(*) as total FROM funcionarios_gobierno")
        fun = cur.fetchone()['total']
    finally:
        cur.close()
        conn.close()
    result = {"politicos": p, "casos": c, "noticias": n, "relaciones": rel, "familiares": fam, "funcionarios": fun}
    cache_set("stats", result)
    return result

@app.post("/api/cache/clear")
def clear_cache(x_admin_token: str = Header(default=None)):
    admin_token = os.environ.get("API_ADMIN_TOKEN", "")
    if admin_token and x_admin_token != admin_token:
        raise HTTPException(status_code=401, detail="No autorizado")
    cache_clear()
    return {"ok": True, "message": "Caché limpiada"}

# ══════════════════════════════════════════════════════
# PUNTO 4: Funcionarios de Gobierno
# ══════════════════════════════════════════════════════
@app.get("/api/funcionarios/")
def listar_funcionarios(institucion: str = None, limit: int = 100, skip: int = 0):
    limit, skip = bound_params(limit, skip)
    conn = get_db()
    try:
        cur = conn.cursor()
        if institucion:
            cur.execute("SELECT COUNT(*) as total FROM funcionarios_gobierno WHERE institucion ILIKE %s", (f"%{institucion}%",))
            total_count = cur.fetchone()['total']
            cur.execute("SELECT id, nombre_completo, cargo, institucion, dependencia_jerarquica, fecha_designacion, fuente FROM funcionarios_gobierno WHERE institucion ILIKE %s ORDER BY nombre_completo LIMIT %s OFFSET %s", (f"%{institucion}%", limit, skip))
        else:
            cur.execute("SELECT COUNT(*) as total FROM funcionarios_gobierno")
            total_count = cur.fetchone()['total']
            cur.execute("SELECT id, nombre_completo, cargo, institucion, dependencia_jerarquica, fecha_designacion, fuente FROM funcionarios_gobierno ORDER BY nombre_completo LIMIT %s OFFSET %s", (limit, skip))
        data = [dict(r) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()
    return {"data": data, "total": total_count}

@app.get("/api/funcionarios/{funcionario_id}")
def detalle_funcionario(funcionario_id: int):
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM funcionarios_gobierno WHERE id = %s", (funcionario_id,))
        f = cur.fetchone()
        if not f:
            raise HTTPException(status_code=404)
    finally:
        cur.close()
        conn.close()
    return dict(f)

@app.get("/api/funcionarios/instituciones/")
def lista_instituciones():
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT DISTINCT institucion FROM funcionarios_gobierno WHERE institucion IS NOT NULL AND institucion != '' ORDER BY institucion")
        rows = [r['institucion'] for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()
    return rows

# ══════════════════════════════════════════════════════
# PUNTO 7: Conexiones no declaradas
# ══════════════════════════════════════════════════════
@app.get("/api/conexiones/no-declaradas")
def conexiones_no_declaradas(limit: int = 50):
    limit, _ = bound_params(limit)
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT f.politico_id, f.nombre_completo as familiar_nombre, f.parentesco,
                   p.nombre_completo as politico_nombre, COUNT(*) as casos_count
            FROM familiares f
            JOIN politicos p ON p.id = f.politico_id
            JOIN casos_corrupcion cc ON cc.responsable ILIKE '%%' || f.nombre_completo || '%%'
            WHERE NOT EXISTS (SELECT 1 FROM relaciones r WHERE r.politico_origen_id = f.politico_id AND r.descripcion ILIKE '%%' || f.nombre_completo || '%%')
            GROUP BY f.politico_id, f.nombre_completo, f.parentesco, p.nombre_completo
            ORDER BY casos_count DESC LIMIT %s
        """, (limit,))
        familiares_sin_relacion = [dict(r) for r in cur.fetchall()]
        cur.execute("""
            SELECT pa.politico_id, pa.alias_nombre, pa.alias_tipo, p.nombre_completo as politico_nombre,
                   COUNT(DISTINCT nm.noticia_id) as menciones
            FROM politicos_aliases pa
            JOIN politicos p ON p.id = pa.politico_id
            JOIN noticias_menciones nm ON nm.politico_id = pa.politico_id
            WHERE NOT EXISTS (SELECT 1 FROM relaciones r WHERE r.politico_origen_id = pa.politico_id AND r.descripcion ILIKE '%%' || pa.alias_nombre || '%%')
              AND COALESCE(nm.valida_v2, true) = true
            GROUP BY pa.politico_id, pa.alias_nombre, pa.alias_tipo, p.nombre_completo
            ORDER BY menciones DESC LIMIT %s
        """, (limit,))
        alias_sin_relacion = [dict(r) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()
    return {"familiares_sin_relacion": familiares_sin_relacion, "alias_sin_relacion": alias_sin_relacion, "total": len(familiares_sin_relacion) + len(alias_sin_relacion)}

# ══════════════════════════════════════════════════════
# PUNTO 14: Comparar políticos
# ══════════════════════════════════════════════════════
@app.get("/api/comparar/")
def comparar_politicos(ids: str):
    politico_ids = [int(x) for x in ids.split(",") if x.strip().isdigit()][:3]
    if len(politico_ids) < 2:
        raise HTTPException(status_code=400, detail="Se requieren al menos 2 políticos")
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT id, nombre_completo, tipo, region, partido,
                   (SELECT COUNT(*) FROM casos_corrupcion cc WHERE cc.responsable ILIKE '%%' || p.nombre_completo || '%%' OR cc.responsable ILIKE '%%' || split_part(p.nombre_completo, ' ', 1) || ' ' || split_part(p.nombre_completo, ' ', 2) || '%%') as casos_count,
                   (SELECT COUNT(*) FROM familiares WHERE politico_id = p.id) as familiares_count,
                   (SELECT COUNT(*) FROM noticias_menciones WHERE politico_id = p.id AND COALESCE(valida_v2, true) = true) as menciones_count
            FROM politicos p WHERE id = ANY(%s)
        """, (politico_ids,))
        politicos = [dict(r) for r in cur.fetchall()]
        cur.execute("SELECT * FROM relaciones WHERE politico_origen_id = ANY(%s) OR politico_destino_id = ANY(%s) LIMIT 100", (politico_ids, politico_ids))
        relaciones = [dict(r) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()
    return {"politicos": politicos, "relaciones": relaciones}

# ══════════════════════════════════════════════════════
# PUNTO 15: Mapa de calor por región
# ══════════════════════════════════════════════════════
@app.get("/api/mapa/regiones")
def mapa_regiones():
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT p.region, 
                   COUNT(DISTINCT p.id) as total_politicos,
                   COUNT(DISTINCT cc.id) as total_casos
            FROM politicos p
            LEFT JOIN casos_corrupcion cc ON (
                cc.responsable ILIKE '%%' || p.nombre_completo || '%%'
                OR cc.responsable ILIKE '%%' || split_part(p.nombre_completo, ' ', 1) || ' ' || split_part(p.nombre_completo, ' ', 2) || '%%'
            )
            WHERE p.region IS NOT NULL AND p.region != ''
            GROUP BY p.region
            ORDER BY total_casos DESC
        """)
        regiones = [dict(r) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()
    return {"regiones": regiones}

# ══════════════════════════════════════════════════════
# PUNTO Búsqueda por alias
# ══════════════════════════════════════════════════════
@app.get("/api/buscar/alias/")
def buscar_por_alias(nombre: str, tipo: str = None):
    conn = get_db()
    try:
        cur = conn.cursor()
        if tipo:
            cur.execute("SELECT pa.politico_id, pa.alias_tipo, pa.alias_nombre, pa.verificado, p.nombre_completo, p.region FROM politicos_aliases pa JOIN politicos p ON p.id = pa.politico_id WHERE pa.alias_nombre ILIKE %s AND pa.alias_tipo = %s LIMIT %s", (f"%{nombre}%", tipo, MAX_LIMIT))
        else:
            cur.execute("SELECT pa.politico_id, pa.alias_tipo, pa.alias_nombre, pa.verificado, p.nombre_completo, p.region FROM politicos_aliases pa JOIN politicos p ON p.id = pa.politico_id WHERE pa.alias_nombre ILIKE %s LIMIT %s", (f"%{nombre}%", MAX_LIMIT))
        resultado = [dict(row) for row in cur.fetchall()]
    finally:
        cur.close()
        conn.close()
    return resultado

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8006)
