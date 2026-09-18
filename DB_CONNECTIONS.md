# Corrección de conexiones a base de datos

## Problemas corregidos

### 1. Un solo schema para SQLite y D1

`backend/src/db.js` ya no recrea manualmente tablas en un schema paralelo.
Carga el `schema.sql` de la raíz y, para instalaciones viejas, agrega `ccl` y
`ratio` solo si todavía faltan.

Esto evita que Express tenga una estructura distinta de D1.

### 2. Binding D1 correctamente identificado

Todas las Pages Functions usan un único binding: `DB`.
Antes de ejecutar una consulta se valida que `c.env.DB.prepare` exista.
Cuando falta el binding, la API devuelve `503` con `code = DB_UNAVAILABLE` en
vez de producir un error genérico.

### 3. Pages local + D1 local

`wrangler.toml` declara `preview_database_id = "DB"`, necesario para la
configuración de D1 de Pages local.
`npm run pages:dev` ya no intenta forzar `--d1=DB`; usa la configuración del
proyecto.

### 4. Cliente API único

Todos los servicios persistentes usan `src/services/apiClient.js`.
Acepta tanto:

- `VITE_API_URL=http://localhost:3001`
- `VITE_API_URL=http://localhost:3001/api`
- `VITE_API_URL=` para `/api`

Además distingue errores de infraestructura de errores de negocio.

### 5. Funcionalidad sin backend

Cuando la API no está disponible, el frontend usa `src/services/localStorageDb.js`.
Esto evita el error genérico `Error al crear el trade` cuando el usuario está
ejecutando el frontend sin D1/SQLite.

### 6. Diagnóstico no destructivo

`GET /api/db-check` dejó de insertar filas de prueba en `ping`.
Ahora realiza únicamente `SELECT 1 AS ok`.

### 7. CORS y errores Express

Express devuelve JSON consistente para `404` y errores internos, y mantiene
CORS configurable mediante `CORS_ORIGIN`.

### 8. Nulls en alertas

Actualizar una alerta con `price: null` ahora permite limpiar el precio en vez
de conservar silenciosamente el anterior.
