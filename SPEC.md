# Registro de Vándalos de Cuello y Corbata — SPEC.md

## Descripción

Plataforma de inteligencia cívica para detectar autoridades chilenas involucradas en corrupción, colusiones y problemas legales.

---

## Arquitectura

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CLOUDFLARE EDGE                             │
│  ┌─────────────────────────┐  ┌─────────────────────────────────┐  │
│  │   Pages (Frontend)      │  │   Tunnel (Backend)              │  │
│  │   registrodevandalos    │  │   api.registrodevandalos.       │  │
│  │   .pages.dev            │  │   likay.cl                      │  │
│  │                         │  │   → localhost:8006              │  │
│  │   index.html estático   │  │                                 │  │
│  │   con detección de      │  │   FastAPI (Python)              │  │
│  │   entorno               │  │   Puerto 8006                   │  │
│  └─────────────────────────┘  └─────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Componentes

### 1. Backend (FastAPI)

| Aspecto | Detalle |
|---|---|
| **Archivo** | `backend.py` |
| **Puerto** | 8006 |
| **Host** | `0.0.0.0` |
| **Base de datos** | Neon PostgreSQL |
| **Túnel** | Cloudflare Tunnel → `api.registrodevandalos.likay.cl` |
| **Cloudflare config** | `~/.cloudflared/config.yml` |

**Endpoints:**

| Método | Endpoint | Descripción |
|---|---|---|
| GET | `/api/politicos/?limit=500&skip=0` | Lista de políticos con datos enriquecidos |
| GET | `/api/politicos/{id}` | Detalle completo (casos, patrimonio, familiares, relaciones, noticias) |
| GET | `/api/politicos/grafo?limit=250` | Grafo de nodos y aristas |
| GET | `/api/politicos/analitica/som?limit=500` | Vectores SOM |
| GET | `/api/casos/?limit=100&skip=0` | Casos de corrupción |
| GET | `/api/stats` | Estadísticas del sistema |
| GET | `/health` | Health check |

**Formato de respuesta de político:**

```json
{
  "id": 697,
  "nombre_completo": "Abraham Gacitúa",
  "tipo": "diputado",
  "region": "Sin región",
  "institucion": "Congreso",
  "cargo": "Diputado",
  "partido": "Partido Liberal Democrático",
  "estado_riesgo": "sin_registros",
  "num_eventos": 0,
  "num_empresas": 0,
  "num_familiares": 0,
  "eventos": [],
  "patrimonios": []
}
```

**Estados de riesgo:**
- `alerta_roja` → más de 2 casos
- `alerta_naranja` → 1-2 casos
- `sin_registros` → 0 casos

---

### 2. Frontend (HTML estático)

| Aspecto | Detalle |
|---|---|
| **Archivo** | `frontend/index.html` |
| **Deploy** | Cloudflare Pages (estático) |
| **URL** | `https://registrodevandalos.pages.dev` |
| **Dependencias** | Ninguna (HTML vanilla + CSS + JS) |

**Detección automática de entorno:**

```javascript
const _isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1" || location.hostname === "192.168.100.23" || location.port === "8006";
const API_BASE = _isLocal ? "/api/politicos" : "https://api.registrodevandalos.likay.cl/api/politicos";
const API_CASES = _isLocal ? "/api/casos" : "https://api.registrodevandalos.likay.cl/api/casos";
```

**Reglas:**
- NO usar `_worker.js` ni `_middleware.js` en Pages
- NO crear Workers proxy
- El HTML decide la URL del backend según `location.hostname`
- Local usa rutas relativas `/api/politicos`
- Producción usa URL absoluta `https://api.registrodevandalos.likay.cl/api/politicos`

---

### 3. Base de Datos (Neon PostgreSQL)

**Tablas principales:**

| Tabla | Descripción | Registros |
|---|---|---|
| `politicos` | Autoridades registradas | 289 |
| `casos_corrupcion` | Casos de corrupción | 128 |
| `noticias` | Noticias almacenadas | 260 |
| `relaciones` | Vínculos entre políticos | 4 |
| `politicos_aliases` | Alias (amigo de, hermano de...) | 20 |
| `familiares` | Familiares de políticos | 15 |
| `noticias_menciones` | Menciones de políticos en noticias | 0 |

**Columnas de `politicos`:**

| Columna | Tipo | Descripción |
|---|---|---|
| id | integer | PK |
| nombre_completo | varchar | Nombre completo |
| nombre | varchar | Nombre |
| apellido_paterno | varchar | Apellido paterno |
| apellido_materno | varchar | Apellido materno |
| email | varchar | Email |
| tipo | varchar | Tipo (diputado, senador, investigado) |
| region | varchar | Región |
| periodo | varchar | Período parlamentario |
| fuente | varchar | Fuente de datos |
| datos_json | jsonb | Datos adicionales |
| partido | varchar | Partido político |
| created_at | timestamp | Fecha de creación |
| updated_at | timestamp | Fecha de actualización |
| fuente_url | text | URL de la fuente |
| fecha_extraccion | timestamp | Fecha de extracción |
| fecha_verificacion | timestamp | Fecha de verificación |

---

## Infraestructura

### Cloudflare Tunnel

**Configuración (`~/.cloudflared/config.yml`):**

```yaml
tunnel: 654da129-237a-4b8a-a4c2-89601ed61e88
credentials-file: /home/chumbeke/.cloudflared/654da129-237a-4b8a-a4c2-89601ed61e88.json

ingress:
  - hostname: api.mapadata.cl
    service: http://localhost:8001
  - hostname: api.registrodevandalos.likay.cl
    service: http://localhost:8006
  - service: http_status:404
```

**DNS:**

| Registro | Tipo | Contenido | Proxy |
|---|---|---|---|
| api.mapadata.cl | CNAME | 654da129-237a-4b8a-a4c2-89601ed61e88.cfargotunnel.com | ON |
| api.registrodevandalos.likay.cl | CNAME | 654da129-237a-4b8a-a4c2-89601ed61e88.cfargotunnel.com | ON |
| registrodevandalos.likay.cl | CNAME | registrodevandalos.pages.dev | ON |

### Cloudflare Pages

| Aspecto | Detalle |
|---|---|
| Proyecto | `registrodevandalos` |
| Dominio | `registrodevandalos.pages.dev` |
| Dominio personalizado | `registrodevandalos.likay.cl` |
| Build command | (ninguno, estático) |
| Output directory | `frontend/` |

---

## Desarrollo Local

### Requisitos

- Python 3.11+
- Neon PostgreSQL
- Cloudflare Tunnel (cloudflared)

### Variables de entorno

```bash
DATABASE_URL="postgresql://neondb_owner:***@ep-dark-sunset-ah922o3v-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require"
```

### Iniciar backend

```bash
cd /home/chumbeke/registro-devandalos
source /home/chumbeke/esphome-venv/bin/activate
python -m uvicorn backend:app --host 0.0.0.0 --port 8006
```

### Iniciar túnel

```bash
cloudflared tunnel run mapadata
```

### Acceder

- Frontend + API: `http://localhost:8006`
- API pública: `https://api.registrodevandalos.likay.cl`

---

## Despliegue

### Backend (systemd)

```bash
systemctl --user restart registro-devandalos.service
```

### Frontend (Cloudflare Pages)

```bash
cd /home/chumbeke/registro-devandalos
CLOUDFLARE_API_TOKEN=*** npx wrangler pages deploy frontend/ --project-name registrodevandalos --branch main
```

---

## Archivos del proyecto

```
registro-devandalos/
├── backend.py              # FastAPI backend (puerto 8006)
├── frontend/
│   └── index.html          # Frontend estático (Cloudflare Pages)
├── README.md               # Documentación
├── ROADMAP.md              # Roadmap del proyecto
└── SPEC.md                 # Este archivo
```

**Archivos que NO deben existir:**
- ❌ `frontend/_worker.js` — No usar Workers en Pages
- ❌ `frontend/_middleware.js` — No usar middleware en Pages
- ❌ `proxy-wrangler.toml` — No usar proxy workers
- ❌ Cualquier otro backend (solo `backend.py`)

---

## Reglas importantes

1. **Un solo backend**: Solo `backend.py` en puerto 8006
2. **Un solo dominio de API**: `api.registrodevandalos.likay.cl`
3. **No Workers en Pages**: El frontend es HTML estático puro
4. **Detección automática**: El HTML decide la URL del backend según el hostname
5. **No hardcodeo de credenciales**: Usar variables de entorno
6. **CORS abierto**: `allow_origins=["*"]` para permitir cross-origin
7. **No mezclar proyectos**: Mapata (puerto 8001) y Registro Vándalos (puerto 8006) son independientes

---

## Próximos pasos

1. Poblar más partidos políticos con datos reales
2. Implementar scraping de noticias (CIPER, El Mostrador)
3. Crear tabla de relaciones con datos reales
4. Mejorar extracción de entidades con NLP
5. Implementar sistema de alertas

---

## Changelog

### 2026-09-01 — Fix backend/frontend: N+1, detalle, riesgo heredado, alias, limpieza

**Backend (`backend.py`):**
- Eliminada credencial Neon hardcodeada — ahora requiere `DATABASE_URL` sin default.
- N+1 corregido: `listar_politicos` pasó de ~870 queries (3 por cada uno de 289 políticos) a 1 query con `LEFT JOIN` agregado.
- Agregado endpoint `/api/politicos/{id}` (detalle): trae eventos, familiares, aliases y patrimonios reales.
- Agregado endpoint `/api/buscar/alias/`: búsqueda por apodo, no solo nombre legal.
- Riesgo heredado: nueva función `calcular_riesgo_heredado()` — suma casos propios + 0.5×casos de familiares directos, así el entorno de un político con antecedentes queda visible aunque él no tenga casos propios.
- `partido` ya no está hardcodeado a "Sin partido" — se lee de la columna real de `politicos`.

**Frontend (`frontend/index.html`):**
- Corregido mojibake (36+ ocurrencias, reincidente 2 veces por sobrescritura externa): texto guardado con doble encoding UTF-8→Latin-1→UTF-8. Validado en 0 residuos al cierre.
- Bug funcional: comparaciones `.includes("en_revisin")` sin tilde nunca matcheaban contra `"en_revisión"` real de la BD — estados procesales se clasificaban mal. Corregido en 2 puntos.
- Nueva sección "Entorno cercano" en el drawer: muestra familiares y alias de cada político, con flag visual cuando un familiar tiene casos de corrupción a su propio nombre.

**Limpieza de infraestructura:**
- Eliminados `_worker.js`, `frontend/_worker.js`, `frontend/functions/api/_middleware.js`, `wrangler.toml`, `proxy-wrangler.toml` — 4 configuraciones de red conflictivas apuntando a 3 dominios/puertos distintos (`localhost:8005`, `api.mapadata.cl`, `registro.mapadata.cl`), ninguna coordinada con el Cloudflare Tunnel real.
- Eliminado `__pycache__/` y `.wrangler/cache/` del control de versiones (exponía email y account ID de Cloudflare). Agregado `.gitignore`.

**Próximos pasos (agregado a la lista existente):**
6. Poblar tabla `noticias_menciones` para timeline unificado por persona.
7. Detectar "conexión no declarada": alias/familiar mencionado en prensa/casos sin fila correspondiente en `relaciones`.

### 2026-09-01 — Grafo interactivo: familiares como nodos + fix rutas relativas reintroducidas

**Backend (`backend.py`):**
- `/api/politicos/grafo` reescrito: antes solo leía `relaciones` (0 filas, grafo vacío). Ahora agrega familiares como nodos tipo `familiar` con arista al político, en el formato `{nodes, edges}` que ya esperaba el frontend (`renderApiNetwork`), incluyendo `metadata.estado` por nodo para colorear según casos asociados.

**Frontend (`frontend/index.html`):**
- Corregidas 3 rutas relativas reintroducidas tras un pull/rebase anterior (`/api/grafo/`, `/api/som/`, `/health`) — rompían en Cloudflare Pages por no usar el origen absoluto del backend. Se centralizó en una constante `BACKEND_ORIGIN` derivada de la detección de entorno ya existente (`_isLocal`), evitando repetir el ternario en cada fetch.
- Corregido "uble" → "Ñuble" en `REGION_ORDER` (mojibake residual, la región no aparecía filtrable correctamente).
- El grafo de "Relaciones" ahora puede mostrar familiares aunque `relaciones` siga vacía — usa `familiares`, que sí tiene datos.

### 2026-09-01 — Fix crítico: orden de rutas rompía /grafo y /analitica/som

**Backend (`backend.py`):**
- `/api/politicos/{politico_id}` estaba registrado antes que `/api/politicos/grafo` y `/api/politicos/analitica/som`. FastAPI resuelve rutas por orden de declaración, así que toda petición a `/grafo` o `/analitica/som` intentaba convertir el string a `int` para `politico_id` y fallaba con 422 antes de llegar al endpoint real — el grafo y el mapa SOM nunca respondían en producción. Reordenado: rutas específicas primero, ruta con parámetro dinámico al final.

### 2026-09-02 — Auditoría general: contrato SOM roto, errores silenciados, mojibake residual

**Backend (`backend.py`):**
- `/api/politicos/analitica/som` devolvía `{puntos:[{id, nombre, tipo, region, score_riesgo, total_casos}]}`, pero el frontend (`renderSom`/`trainSom`) esperaba `{items:[{politico_id, normalized}]}`. El mapa SOM nunca llegó a usar datos reales del backend — siempre caía al modo simulado por el mismatch de claves, sin ningún error visible. Reescrito con el contrato correcto (`items`, `politico_id`, `normalized` en [0,1] con casos y familiares como features) y de paso eliminado el N+1 que tenía este endpoint (antes 1 query extra por cada político).
- Confirmado con el usuario: tabla `patrimonio` existe con columna `politico_id` (FK), solo está vacía (0 filas) — el `LEFT JOIN`/`SELECT *` sobre ella no es un riesgo de columna inexistente, solo devuelve vacío hasta que se pueble.

**Frontend (`frontend/index.html`):**
- `catch {}` silencioso en `openProfile` al fallar la carga del detalle — no dejaba ningún rastro para depurar. Agregado `console.error`.
- El `catch` genérico de `loadData` había perdido el `console.error` que se agregó en una iteración anterior (se pisó en un rebase). Repuesto.
- Mojibake residual: `"SELECCIN"` → `"SELECCIÓN"`, `"estadstica"` → `"estadística"`.
- 3 tooltips con separador ` · ` perdido (quedaron dobles espacios sin separador visual) en `renderNetwork`, `renderApiNetwork` y `renderSom`. Corregidos.

**Pendiente para próxima iteración (detectado, no bug):**
- El buscador principal del UI es solo client-side sobre los políticos ya cargados; no usa el endpoint `/api/buscar/alias/` ya implementado en el backend — falta conectar un input/toggle en el frontend para activarlo.
- La búsqueda por nombre en `listar_politicos`/`grafo`/`som` sigue usando `ILIKE` de texto contra `casos_corrupcion.responsable` en vez de una FK real — funciona pero es frágil ante homónimos o variaciones de escritura del nombre.

### 2026-09-02 — Buscador de alias conectado al UI

**Frontend (`frontend/index.html`):**
- `applyFilters` sigue siendo síncrono (filtro instantáneo por nombre/partido/región/cargo). Cuando ese filtro no encuentra nada y hay texto de búsqueda, se dispara `searchAliases()` como fallback asíncrono contra `/api/buscar/alias/` — así "el Tati" (alias, no en `nombre_completo`) sí puede encontrar al político real.
- Resultados de alias se muestran en un dropdown (`#aliasHint`) bajo el buscador, con el alias, a quién pertenece, tipo de vínculo y si está verificado. Clic abre el perfil directamente.
- Se descarta con un token de secuencia (`aliasSearchToken`) cualquier respuesta que llegue tarde si el usuario ya siguió escribiendo — evita mostrar resultados obsoletos.
- Placeholder del buscador actualizado para reflejar la nueva capacidad ("...o alias").

**Pendiente:**
- Los 15 partidos políticos faltantes y el diseño de la estructura para "personas que trabajan para el gobierno" (no electas) quedan a la espera de que el usuario defina/pueble los datos en Neon — sin acceso de red a la BD desde este entorno no se puede avanzar ese punto.

### 2026-09-02 — Avance del usuario: partidos poblados + tabla funcionarios_gobierno (con 3 bugs corregidos)

**Avance del usuario (commits `df6cc20`, `e23f5c6`):** 15 partidos reales poblados en `politicos.partido`; nuevas tablas `patrimonio` (30), `pasivos` (26), `actividades` (27), `empresas` (12), `vinculos_empresariales` (13); nueva tabla `funcionarios_gobierno` con 20 funcionarios reales; `casos_corrupcion.politico_id` (FK) agregada y poblada para 15/128 casos (el resto sigue con `NULL`, matcheable solo por `ILIKE` sobre `responsable`); 3 endpoints nuevos (`/api/funcionarios/`, `/api/funcionarios/{id}`, `/api/funcionarios/instituciones/`) y nueva vista "Funcionarios" en el frontend.

**Bugs encontrados y corregidos en la revisión:**
- Mismo bug de orden de rutas que ya se había dado antes: `/api/funcionarios/{funcionario_id}` estaba declarado antes que `/api/funcionarios/instituciones/` — el filtro por institución nunca habría cargado. Reordenado.
- 2 rutas relativas fijas reintroducidas (`/api/funcionarios/?limit=100`, `/api/funcionarios/{id}`) sin `BACKEND_ORIGIN` — rompían en Cloudflare Pages igual que los bugs anteriores de esta clase.
- Bug de lectura de `Promise.allSettled`: `funcResult.data` no existe en ese objeto (tiene `.status`/`.value`), debía ser `funcResult.value.data` — `funcionarios` quedaba siempre vacío pese a que la petición funcionaba.
- Contenedor `#funcionariosList` no existía en el HTML — `renderFuncionariosList()` lanzaba `TypeError` al hacer clic en la vista "Funcionarios", rompiendo esa sección completa. Agregado el contenedor y ajustada `renderViz()` para mostrar/ocultar entre el SVG y la lista de funcionarios según la vista activa.
- Sin estilos definidos para `.person-funcionario`/`.badge-funcionario`/`.funcionarios-list` — agregados, reutilizando la paleta existente (`--cobalt` para distinguir funcionarios de políticos).

**Confirmado con el usuario, no era bug:** `casos_corrupcion.politico_id` sí existe como FK real; el endpoint de detalle de funcionario usa tanto esa FK como el `ILIKE` por nombre como respaldo, sin riesgo de perder los 113 casos aún sin FK asignada.

### 2026-09-03 — Worker de noticias, glosario, migración masiva de datos (con 3 correcciones)

**Avance del usuario (worker de noticias, commits `faf6933`...`9e5cf99`):** `worker_noticias.py` — scraping automático de 6 fuentes de prensa chilena, conectado a `detalle_politico` para mostrar menciones reales en el drawer.

**Avance del usuario (migración masiva, commit `298e22a`):**
- Casos con FK real: 15 → 90/128 (70%), por matching de apellido paterno/materno/nombre completo/parcial. Quedan 22 sin resolver (nombres que no matchean con ningún político registrado, ej. "Franka Grez", "Eduardo Gordon" — revisar manualmente si son funcionarios/terceros o errores de tipeo en la fuente).
- `relaciones`: 5 filas sintéticas → 7,809 reales, generadas por coincidencia de mención conjunta en `noticias_menciones` (tipo `mediatico`, sin confirmación judicial).
- `noticias`: 414 filas. `noticias_menciones`: 3,670 filas.
- Glosario "Guía rápida" agregado en el frontend: 4 tarjetas explicando riesgo propio / riesgo heredado / vínculo mediático / sin antecedentes.

**Correcciones aplicadas en la revisión:**
- Glosario usaba colores Bootstrap (`#dc3545`, `#fd7e14`, `#0dcaf0`, `#6c757d`) ajenos a la paleta del proyecto — reemplazados por las variables reales del sistema de diseño (`--red`, `--amber`, `--cobalt`, `--muted`) para que coincida visualmente con el resto del sitio (tarjetas, mapas, grafo).
- El grafo (`renderApiNetwork`) dibujaba todas las aristas igual, sin distinguir `tipo_relacion` — con 7,809 relaciones `mediatico` (no confirmadas) mezcladas visualmente con vínculos verificados (familiar, negocios), el grafo no reflejaba lo que el glosario promete. Corregido: aristas `mediatico` ahora se ven punteadas y tenues; las verificadas, sólidas y más marcadas.
- El backend traía las 200 relaciones del `LIMIT` sin orden — con 7,809 filas mayormente `mediatico`, la muestra de 200 podía quedar dominada por vínculos no confirmados, dejando fuera las pocas relaciones verificadas. Corregido: `ORDER BY` prioriza relaciones no-mediáticas primero, y solo llena el resto del cupo con mediáticas.

**Pendiente:**
- Resolver los 22 casos sin FK (nombres no encontrados en `politicos`).
- Evaluar si el volumen de relaciones `mediatico` (7,809) necesita algún umbral de relevancia (ej. mínimo de menciones conjuntas) antes de considerarse una "relación", para no diluir el objetivo del proyecto con ruido editorial.
### 2026-09-03 (2) — Auditoría de la sesión "avance grande": 10 bugs corregidos, 1 credencial rotada

**Avance del usuario (commits `8adec70`...`434e97c`):** grafo interactivo con D3.js v7.9 (zoom, pan, drag, force simulation), timeline por año en el perfil, endpoints de conexiones no declaradas (#7)/comparación (#14)/mapa de calor (#15), índices pg_trgm + caché TTL 5min (aplicados directo en Neon), URLs individuales por perfil (#13), alertas Telegram (#12), cron systemd diario (#16). Prácticamente todo el roadmap de mediano/largo plazo en una sesión.

**Bugs encontrados y corregidos en la revisión:**
- `backend.py`: `app = FastAPI(...)` declarado dos veces (la segunda pisaba la primera silenciosamente). Eliminado el duplicado.
- `backend.py`: endpoint `/api/casos/` había perdido su decorador `@app.get(...)` — la ruta no se registraba, 404 silencioso. Restaurado.
- `frontend/index.html`: el nuevo grafo D3 (que reemplazó al render SVG manual) no distinguía `edge.tipo` al construir los datos para D3 — las 7,809 relaciones `mediatico` se veían visualmente igual que los vínculos verificados, perdiendo el fix aplicado en la sesión anterior. Corregido: líneas sólidas para verificados, punteadas/tenues para mediáticos, agregada leyenda que lo explica.
- `frontend/index.html`: colores Bootstrap (`#dc3545`, `#fd7e14`, `#6c757d`, `#adb5bd`) en los estilos del timeline, mismo problema ya visto en el glosario. Reemplazados por las variables reales del proyecto.
- `frontend/index.html`: el timeline ordenaba por `e.año_inicio || e.año`, campos que el backend renombra a `fecha_inicio` en el `SELECT AS` — esas claves nunca llegan en la respuesta, el orden cronológico no funcionaba realmente. Corregido a `e.fecha_inicio` con `parseInt`.
- `frontend/index.html`: al abrir un link directo `#perfil/123`, `openProfile()` se llamaba antes de que `apiAvailable` se pusiera en `true` (eso ocurre después de cargar la lista completa) — el fetch del detalle nunca se disparaba, el perfil se abría vacío. Reordenado: el hash se procesa después de que `people` y `apiAvailable` estén listos.
- `worker_noticias.py`: la alerta de Telegram se calculaba sobre los artículos de la corrida actual sin verificar si ya habían sido guardados en corridas anteriores — como los feeds RSS suelen repetir los últimos N artículos, el cron diario iba a re-alertar sobre las mismas menciones día tras día. Agregada función `ya_existe()` que consulta la BD por hash antes de procesar; si ya existe, se salta sin re-procesar ni re-alertar.
- **`systemd/worker-noticias.service`: la credencial completa de Neon (usuario, password, host) estaba hardcodeada en texto plano y pública en GitHub.** Reemplazada por `EnvironmentFile=.env` (fuera del repo). *Acción pendiente del usuario: rotar la contraseña de Neon, ya que estuvo expuesta públicamente.*
- `migrations/001_pg_trgm_indices.sql` agregado — los índices pg_trgm se habían aplicado directo en Neon sin dejar el SQL versionado; ahora queda documentado y es reproducible en otro entorno.

**Pendiente:**
- Rotar la contraseña de Neon (credencial expuesta, ver arriba).
- Confirmar en el servidor que existe `/home/chumbeke/registro-devandalos/.env` con `DATABASE_URL` y los tokens de Telegram antes de reactivar el timer systemd (el `service` ya no trae el valor hardcodeado).
- `/api/cache/clear` es un `POST` público sin autenticación — bajo riesgo (solo limpia caché), pero vale agregar un token simple si se quiere cerrar del todo.

### 2026-09-03 (3) — Merge con reestructuración de frontend + segunda credencial expuesta

**Avance del usuario en paralelo (commits `1e116b1`, `c3051ee`):** frontend separado en 3 archivos (`index.html` ~300 líneas, `assets/css/styles.css`, `assets/js/app.js`, antes 1372 líneas en un solo archivo); `tests/test_backend.py` con 15 tests; `setup.sh` con instalación automática y flag `--install-systemd`; migración `pg_trgm` documentada de forma independiente.

**Conflicto de merge:** la reestructuración del frontend chocó con los 6 fixes aplicados en la sesión anterior (todos vivían en el `index.html` monolítico). Se tomó la nueva estructura separada como base — es la dirección correcta, más mantenible — y se **reaplicaron los 6 fixes sobre `app.js`/`styles.css`**, verificando cada uno:
- Colores Bootstrap del timeline → paleta del proyecto.
- Distinción visual `mediatico`/verificado en el grafo D3 (se había perdido de nuevo en la migración a `app.js`) + leyenda.
- Timeline con `fecha_inicio` real en vez de `año_inicio`/`año` inexistentes.
- Bug de secuencia `apiAvailable` con `#perfil/id`.

**Segunda credencial de Neon expuesta encontrada:** `tests/test_backend.py` tenía la misma contraseña ya expuesta en `systemd/worker-noticias.service`, hardcodeada como `os.environ.setdefault(...)`. Reemplazada por un placeholder (`usuario:password@localhost`) — los tests que requieren BD real fallarán sin una `DATABASE_URL` real exportada por quien los corra, lo cual es el comportamiento correcto (evita apuntar a producción por accidente).

**Otras correcciones:**
- Migración `pg_trgm` duplicada con nombre casi idéntico (`001_pg_trgm_indexes.sql` vs `001_pg_trgm_indices.sql`) — consolidada en la más completa (incluía además el índice de `politicos.nombre_completo`, ausente en la otra).
- `setup.sh`: no validaba la existencia de `.env` antes de instalar systemd (fallaría silenciosamente al arrancar el timer sin `DATABASE_URL`); mencionaba `mapata-full.service`, de otro proyecto del usuario. Ambos corregidos.

**Pendiente reforzado:** rotar la contraseña de Neon es ahora más urgente — estuvo expuesta en **dos** archivos distintos del repo público, no solo uno.

### 2026-09-03 (4) — Terminología más directa, fix estado_actual, matching de noticias más estricto

**Contexto:** el usuario pidió que el frontend muestre claramente condenas y casos reales, y señaló que términos como "riesgo propio"/"riesgo heredado"/"vínculo mediático" no son suficientemente directos para el objetivo del sitio (que la gente vea rápido "en qué anda metido" un político).

**Bug crítico encontrado y corregido:** `detalle_politico` enviaba el estado del caso como `estado` (columna real de la BD), pero el frontend en todas partes (lista, drawer, timeline, tooltips) leía `e.estado_actual` — un nombre de campo distinto. Como resultado, **ningún caso mostraba su estado real** (condenado, en investigación, etc.); todo caía al fallback "sin estado". Corregido: el `SELECT` ahora renombra `estado AS estado_actual` y `fuente_url AS fuente` (este último también esperado con otro nombre por el frontend).

**Terminología revisada (`frontend/index.html`, glosario; `frontend/assets/js/app.js`, `formatProcessState`):**
- "Riesgo propio" → "Con casos propios".
- "Riesgo heredado" → "Entorno comprometido".
- "Vínculo mediático" → "Mencionado junto a otro caso" (con la aclaración de que no confirma un vínculo real).
- "Abierto" → "Investigación en curso".
- "Sin estado" → "Sin antecedentes".

**Matching de noticias corregido (`worker_noticias.py`):** el índice de nombres indexaba cada palabra del nombre por separado (incluyendo apellidos comunes como "González", "Muñoz", "Silva"), y `detectar()` permitía coincidencias de una sola palabra (`lng=1`). Esto generaba riesgo real de falsos positivos: una noticia que mencionara un apellido común, sin relación con el político real, podía registrarse como mención. Corregido: el índice ahora solo indexa el nombre completo y sus bigramas consecutivos (mínimo 2 palabras), y `detectar()` ya no prueba n-gramas de 1 palabra.

**Pendiente:**
- Las 3,670 filas ya existentes en `noticias_menciones` fueron generadas con la lógica vieja (matching por palabra suelta) — pueden incluir falsos positivos. Conviene una limpieza/reproceso con la lógica nueva antes de confiar plenamente en esos datos.
- El filtro `caseFilters.estado_procesal` existe en el JS pero no tiene ningún `<select>` en el HTML que lo controle — queda fijo en "all" siempre. Falta agregar el control de UI.

### 2026-09-03 (5) — Mapeo de estados real, reordenamiento por severidad, filtro de casos visible, script de auditoría de menciones

**Contexto:** valores reales de `casos_corrupcion.estado` en la BD (en español, con variantes de redacción: "Condenado"/"Condenada", "querella"/"Querella") no coincidían con las claves internas en inglés que usaba el frontend. Se descartó la opción de ocultar políticos "sin antecedentes" (destruiría el propósito de mostrar el "entorno comprometido" — los familiares sin casos propios son justamente el dato que da sentido a esa categoría) y se descartó normalizar la BD (se prefiere preservar el dato original). Se optó por mapeo de traducción centralizado en el backend.

**Backend (`backend.py`):**
- Nueva función `normalizar_estado()`: traduce los valores reales de la BD (incluida la mayoría — 93/128 casos — con estado vacío, tratado como "sin_estado", no como "sin problemas") a las 4 claves internas (`condenado`, `abierto`, `cerrado_sin_condena`, `sin_estado`).
- `detalle_politico` y `/api/casos/` ahora agregan `estado_normalizado` a cada evento/caso, sin tocar el campo `estado_actual`/`estado` original (se preserva el texto real para mostrarlo tal cual).

**Frontend:**
- Todas las comparaciones de estado que antes hacían `.toLowerCase()` contra strings en inglés fijos (que nunca coincidían con los valores reales en español) ahora usan `estado_normalizado`. Corregido en: timeline visual, cronología detallada, badge del header del perfil, filtro/color de la vista de Casos.
- El badge de estado del header del perfil ahora prioriza el evento **más grave** entre todos los casos del político (condenado > abierto > cerrado sin condena > sin estado), no el más reciente cronológicamente ni un campo fantasma que nunca existía en la respuesta.
- Nuevo selector visible `#caseStateFilter` en la vista "Casos" (antes el filtro existía en el JS pero no tenía ningún control de UI) — se muestra/oculta según la vista activa, con las 4 categorías normalizadas.
- Terminología (glosario y `formatProcessState`) ajustada a un lenguaje más directo, pedido explícito del usuario: "Riesgo propio"→"Con casos propios", "Riesgo heredado"→"Entorno comprometido", "Vínculo mediático"→"Mencionado junto a otro caso", "Abierto"→"Investigación en curso", "Sin estado"→"Sin antecedentes".

**Matching de noticias (`migrations/audit_noticias_menciones.py`, nuevo):** script de auditoría/reproceso para las 3,670 menciones ya guardadas con la lógica vieja (matching por palabra suelta). Reconstruye qué políticos matchean el contexto guardado de cada mención usando la lógica nueva (bigramas, mínimo 2 palabras) y marca las que ya no coinciden en una columna nueva `valida_v2` (no elimina nada, solo marca para revisión manual). Modo dry-run por defecto; requiere `--apply` para escribir en la BD.

**Pendiente — bloqueado por falta de acceso a Neon desde este entorno:**
- Ejecutar `migrations/audit_noticias_menciones.py --apply` en el servidor con acceso real a la BD.
- Una vez creada la columna `valida_v2`, activar el filtro correspondiente en `detalle_politico` (dejado como comentario `TODO` explícito en el código, con la línea SQL exacta a agregar) para no mostrar menciones marcadas como falso positivo.

### 2026-09-03 (6) — Fix del script de auditoría (cursor RealDict desempaquetado como tupla)

**Bug encontrado (reportado por el usuario desde el servidor):** `migrations/audit_noticias_menciones.py` → `cargar_indice()` usaba `for pid, nombre in cur.fetchall()`, desempaquetado posicional de tupla, pero el cursor es `RealDictCursor` (devuelve dicts) — el índice quedaba siempre vacío ("0 combinaciones"), inconsistente con el resto del mismo archivo que sí accede por clave. Corregido a `row["id"]`/`row["nombre_completo"]`.

**Resultado tras el fix, corrido en el servidor (dry-run):** 817 combinaciones de nombre indexadas, 195 menciones revisadas, 33 válidas (17%) y **162 sospechosas (83%)** — confirma que el matching viejo (por palabra suelta) generó una proporción muy alta de falsos positivos, como se sospechaba.

**Nota de proceso:** el usuario reportó que la otra IA, trabajando directo en el servidor, había "corregido" `e.get("estado_actual")` a `e.get("estado")` en `backend.py` — pero esa columna ya había sido renombrada a `estado_actual` en el commit `d4354f1` (`SELECT estado AS estado_actual`), así que el cambio de la otra IA habría revertido esa corrección si se aplicó sobre una copia sin el `git pull` más reciente. Se le indicó verificar `git log --oneline -1 -- backend.py` antes de seguir editando ese archivo.

**Pendiente:** aplicar `--apply` en el servidor (autorizado), luego activar el filtro `valida_v2` documentado como TODO en `detalle_politico`.

### 2026-09-03 (7) — Script para poblar familiares desde Wikidata

**Contexto:** `familiares` no tenía ningún pipeline de población automática (a diferencia de casos/noticias) — se llenaba manualmente. No existe un registro público único de "familiares de políticos" en Chile (dato sensible, normalmente sale de investigación periodística), pero Wikidata modela relaciones familiares de forma estructurada (cónyuge, hijos, padres, hermanos) para personas con algo de notoriedad pública.

**`migrations/poblar_familiares_wikidata.py` (nuevo):** por cada político, busca su entidad en Wikidata por nombre (con un chequeo de similitud simple para filtrar matches obviamente equivocados), trae sus claims de familia (P26 cónyuge, P40 hijo, P22 padre, P25 madre, P3373 hermano) y los inserta en `familiares` con `fuente_url` apuntando a la página de Wikidata para verificación manual. Dry-run por defecto; `--apply` para insertar; `--limit N` para probar con pocos registros primero.

**Limitación honesta documentada en el propio script:** Wikidata solo cubre políticos con notoriedad pública nacional/mediática — diputados/senadores menos conocidos o funcionarios de gobierno probablemente no tengan entidad. Esto es un punto de partida, no reemplaza verificación humana; cada fila queda marcada con nota "Importado desde Wikidata, verificar manualmente."

**Siguiente paso sugerido (no implementado aún):** extender `worker_noticias.py` para detectar patrones de parentesco explícito en el texto ya scrapeado ("hijo de", "esposa de", "hermano del senador"), como fuente complementaria para los casos que Wikidata no cubre.

**Bloqueado:** no puedo ejecutar este script yo mismo — mi entorno no tiene acceso de red a `wikidata.org` ni a Neon. Requiere que se corra en el servidor con acceso real.

### 2026-09-04 — Auditoría integral pos-fix + terminología "Sin antecedentes" + patrimonio en pausa

**Auditoría integral (subagente)** de `backend.py` y `frontend/assets/js/app.js`, con todos los hallazgos corregidos:

**Backend (`backend.py`):**
- `grafo()`: `try/finally` (cierre de conexión), matching de casos por nombre, filtro de edges a `politico_ids` relevantes.
- `som()`: join `casos_familiares` corregido a `cc2.responsable ILIKE '%f.nombre_completo%'`; conteo de casos por nombre en `som()`/`grafo`/`comparar`/`mapa_regiones`.
- `cache_get`: purga entradas vencidas.
- Nuevo helper `bound_params(limit, skip)` (MAX_LIMIT=1000) aplicado a `listar_politicos`, `grafo`, `som`, `casos`, `noticias`, `listar_funcionarios`, `conexiones_no_declaradas`.
- `listar_funcionarios`: total count refleja el filtro de institución.
- `buscar_por_alias`: LIMIT.
- `clear_cache` requiere header `X-Admin-Token` (cuando `API_ADMIN_TOKEN` está definido).
- Eliminada línea muerta `if False else None` en `detalle_politico`.

**Frontend (`frontend/assets/js/app.js`):**
- `applyFilters` y `renderFuncionariosList(q)` ahora manejan la vista de funcionarios (filtran por búsqueda).
- `renderViz` pasa query; nav muestra/oculta `#viz`, `#funcionariosList`, `#caseStateFilter`, `#filters`.
- Nuevo helper `safeHref` (solo `http(s)|mailto|tel:`) aplicado a los 3 enlaces (caso fuente, funcionario fuente, noticia url).
- `initials()` saneado a letras; `escapeHtml(initials(...))` en `avatarHtml`.
- Búsqueda con debounce (200ms); `history.pushState` sin apilar mismo hash; `[...events].sort()` sin mutar; `activeSim.stop()` + reasignación para la simulación d3 force; funciones muertas eliminadas.

**Terminología (usuario: "el sin estado, dejarlo sin antecedentes"):** en `frontend/index.html`, chip `clear` y leyenda pasan de "sin registros" a "sin antecedentes"; opción del selector de casos `sin_estado` pasa a "Sin antecedentes". `formatProcessState` ya devolvía "Sin antecedentes" para `sin_estado`. La "Guía rápida" negra se mantiene como categorías de **riesgo** (Con casos propios / Entorno comprometido / Mencionado junto a otro caso / Sin antecedentes), concepto distinto al estado procesal del filtro.

**Verificación:** 10 endpoints probados devuelven 200 (`/api/politicos/`, `/api/casos/`, `/api/politicos/analitica/som`, `/api/politicos/grafo`, `/api/funcionarios/`, `/api/politicos/1115`, stats). `py_compile` backend OK; `node --check` frontend OK. Backend reiniciado en el servidor.

**Patrimonio — en pausa (bloqueado por la fuente):** la tabla `patrimonio` sigue vacía (0 filas). Al revisar la fuente, las 2,790 filas de `bienes_infoprobidad` vinculadas a 74 políticos NO tienen datos estructurados (`tipo`/`descripcion`/`valor` todos NULL; direcciones "RESERVADO"). Un backfill ahora insertaría solo filas vacías/engañosas y haría `num_empresas`/patrimonio confusos. Decisión del usuario: **diferir hasta un re-scrape** de infoprobidad que capture los bienes declarados. Documentado en `ROADMAP.md` (#3b).
