# Registro de Vándalos de Cuello y Corbata — Roadmap

Nota: este archivo tuvo contenido de otro proyecto del usuario (Google Places,
scraping_jobs, comunas_chile, api.mapata.cl) mezclado por error. Se limpió el
2026-09-02. El detalle completo de cada fix está en `SPEC.md`.

## Arquitectura (confirmada, no tocar sin razón)

- Backend FastAPI en servidor propio, puerto 8006.
- Expuesto vía Cloudflare Tunnel en `api.registrodevandalos.likay.cl`.
- Frontend estático (`frontend/index.html`) en Cloudflare Pages, sin workers ni middleware intermedios.
- Base de datos: Neon (Postgres).

## Completado

| Área | Qué | Cuándo |
|---|---|---|
| Backend | N+1 eliminado en listado, grafo y SOM (JOIN único en vez de cientos de queries) | 2026-09-01/02 |
| Backend | Endpoint de detalle `/api/politicos/{id}` (eventos, familiares, aliases, patrimonio) | 2026-09-01 |
| Backend | Riesgo heredado: familiares con casos suben el `estado_riesgo` del político aunque él no tenga antecedentes propios | 2026-09-01 |
| Backend | Buscador por alias (`/api/buscar/alias/`) | 2026-09-01 |
| Backend | Grafo con familiares como nodos (antes solo leía `relaciones`, vacía) | 2026-09-01 |
| Backend | Tabla y endpoints de `funcionarios_gobierno` (no electos): listado, detalle, filtro por institución | 2026-09-02 |
| Backend | 15 partidos políticos reales poblados; FK `casos_corrupcion.politico_id` agregada (15/128 casos migrados, resto por `ILIKE`) | 2026-09-02 |
| Backend | Tablas `patrimonio`, `pasivos`, `actividades`, `empresas`, `vinculos_empresariales` con datos | 2026-09-02 |
| Backend | Migración de 90/128 casos a FK (70%) | 2026-09-02 |
| Backend | 7,809 relaciones pobladas desde menciones en noticias | 2026-09-02 |
| Backend | Worker de Noticias v1.2: 6 fuentes funcionando, 135 artículos, 91 con menciones | 2026-09-02 |
| Frontend | Mojibake corregido en todo el archivo (varias reincidencias) | 2026-09-01/02 |
| Frontend | Rutas relativas → `BACKEND_ORIGIN` centralizado con detección de entorno | 2026-09-01/02 |
| Frontend | Sección "Entorno cercano" en el drawer (familiares + alias + casos de cada uno) | 2026-09-01 |
| Frontend | Buscador de alias conectado al UI (dropdown de coincidencias) | 2026-09-02 |
| Frontend | Vista "Funcionarios" con tarjetas y drawer de detalle | 2026-09-02 |
| Frontend | Hero explicativo mejorado + sección "Guía rápida" (glosario de riesgos) | 2026-09-02 |
| Infra | Eliminados 4 archivos de red conflictivos (`_worker.js`, `_middleware.js`, 2× `wrangler.toml`) que apuntaban a 3 dominios/puertos distintos | 2026-09-01 |
| Infra | `.gitignore`, sin credenciales ni `__pycache__`/`.wrangler` en el repo | 2026-09-01 |
| Backend | Scraping automático de 6 fuentes de prensa (`worker_noticias.py`), conectado al detalle de político | 2026-09-03 |
| Backend | `casos_corrupcion.politico_id` migrado 15→90/128 (70%) | 2026-09-03 |
| Backend | `relaciones` poblada 5→7,809 (mención conjunta en noticias, tipo `mediatico`) | 2026-09-03 |
| Frontend | Glosario "Guía rápida" (4 tarjetas: riesgo propio/heredado, vínculo mediático, sin antecedentes) | 2026-09-03 |
| Frontend | Grafo distingue visualmente vínculos verificados (sólido) de mediáticos/no confirmados (punteado, tenue) | 2026-09-03 |

## Pendiente — corto plazo (alto impacto, bajo esfuerzo)

| # | Qué | Por qué importa | Bloqueante |
|---|---|---|---|
| 1 | ✅ Poblar `relaciones` con datos reales | completado 2026-09-03 — 7,809 filas (mención conjunta en noticias, tipo `mediatico`) | — |
| 2 | ✅ Poblar `noticias_menciones` | completado 2026-09-03 — 3,670 filas, vía `worker_noticias.py`; auditoría de falsos positivos pendiente (`migrations/audit_noticias_menciones.py --apply`) | requiere correr el script en el servidor con acceso a Neon |
| 3 | Migrar el resto de `casos_corrupcion` a FK real | avanzó 15→90/128 (70%) el 2026-09-03; quedan 22 sin resolver por nombre no encontrado en `politicos` (revisar manualmente) | ninguno, es revisión de datos |
| 17 | Poblar `familiares` desde Wikidata | script listo (`migrations/poblar_familiares_wikidata.py`), pendiente correr en servidor con acceso a Wikidata + Neon | requiere acceso de red que este entorno no tiene |
| 4 | ✅ Hero explicativo en la portada | ya existía, sin cambios | — |
| 5 | ✅ Glosario ("Guía rápida") | completado 2026-09-03 — 4 tarjetas con la paleta de color real del sitio | — |

## Pendiente — mediano plazo

| # | Qué | Detalle |
|---|---|---|
| 6 | ✅ Grafo interactivo real (D3.js v7.9, zoom/pan/drag) | completado 2026-09-03 |
| 7 | ✅ Detectar "conexión no declarada" (`/api/conexiones/no-declaradas`) | completado 2026-09-03 — corazón del objetivo del proyecto |
| 7b | Umbral de relevancia para relaciones `mediatico` (ej. mínimo de menciones conjuntas) | con 7,809 filas de solo mención conjunta, sin umbral se diluye la señal real entre ruido editorial (dos políticos citados en una misma noticia de trámite no es necesariamente relevante) |
| 8 | ✅ Timeline interactivo por año en el drawer | completado 2026-09-03 |
| 9 | ✅ Índices `pg_trgm` | completado 2026-09-03 — ver `migrations/001_pg_trgm_indices.sql` |
| 10 | ✅ Caché TTL 5min en endpoints principales | completado 2026-09-03 |

## Pendiente — largo plazo / escala

| # | Qué | Detalle |
|---|---|---|
| 11 | ✅ Scraping automatizado de prensa | completado — `worker_noticias.py`, 6 fuentes |
| 12 | ✅ Alertas Telegram | completado 2026-09-03 — con deduplicación agregada en la revisión |
| 13 | ✅ URLs individuales (`#perfil/id`) | completado 2026-09-03 |
| 14 | ✅ Modo comparación (`/api/comparar/`) | completado 2026-09-03 |
| 15 | ✅ Mapa de calor por región (`/api/mapa/regiones`) | completado 2026-09-03 |
| 16 | ✅ Cron diario (systemd timer) | completado 2026-09-03 |

## Notas técnicas activas

- **Acción urgente pendiente del usuario: rotar la contraseña de Neon.** Estuvo hardcodeada en texto plano en **dos archivos distintos** (`systemd/worker-noticias.service` y `tests/test_backend.py`), públicos en GitHub, hasta la revisión del 2026-09-03. Ya corregido en el código (usa `.env` externo / placeholder en tests), pero la credencial vieja debe considerarse comprometida.
- `/api/cache/clear` es un `POST` público sin autenticación — bajo riesgo (solo limpia caché en memoria), pero conviene agregar un token simple antes de considerar el backend "cerrado".
- El backend abre una conexión Postgres por endpoint; algunos ya usan `try/finally` (agregado en la sesión de caché), otros no todavía (`/api/conexiones/no-declaradas`, `/api/comparar/`, `/api/mapa/regiones`) — homogeneizar.
- `SELECT *` se usa en varios endpoints de `funcionarios_gobierno` — funcional, pero trae columnas sin filtrar; preferible listar columnas explícitas si el schema crece.
- Regla del proyecto: cada push debe agregar una entrada en `SPEC.md` con el detalle de qué cambió y por qué.
