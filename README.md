# Vue Finanzas

Dashboard financiero con **Vue 3 + Vite**, **Cloudflare Pages Functions + D1**
y un backend opcional **Express + SQLite** para desarrollo independiente.

La persistencia ahora tiene una única interfaz desde el frontend:

1. intenta usar `/api`;
2. si `/api` responde correctamente, guarda en D1 (Cloudflare) o SQLite (Express);
3. si la API no existe, está caída o D1 no está configurado, usa un respaldo local en `localStorage` del navegador.

Un error real de validación o de datos (`400`, `404`, etc.) **no** se oculta con
el respaldo local. Solo se activa cuando la infraestructura de persistencia no
está disponible (`502/503/504`, timeout, error de red o una ruta que devuelve
HTML en vez de JSON).

## Estructura

```text
src/
├── App.vue
├── components/
├── composables/
├── data/
└── services/
    ├── apiClient.js         # cliente API único + clasificación de errores
    ├── localStorageDb.js    # respaldo local cuando no hay backend
    └── *Service.js          # persistencia de cada módulo

functions/
├── api/[[route]].js         # API Hono para Cloudflare Pages Functions
└── _lib/                    # lógica de alerts/watchlist/checklist/trades/journal

backend/
└── src/
    ├── db.js                # SQLite local; usa el mismo schema.sql que D1
    ├── server.js
    ├── controllers/
    └── routes/

schema.sql                   # schema canónico compartido por D1 y SQLite
migrations/
├── 001_add_ccl_to_trades.sql
└── 002_add_ratio_to_trades.sql
wrangler.toml                # binding D1 + configuración Pages local
```

## Desarrollo con Cloudflare Pages + D1 local

Instalá dependencias y copiá `.env.example`:

```bash
npm install
cp .env.example .env
```

En `.env` configurá solamente la clave de Finnhub si vas a usar cotizaciones:

```env
VITE_FINNHUB_API_KEY=tu_clave
VITE_API_URL=
```

`VITE_API_URL` queda vacío para que el frontend use `/api`, que en Cloudflare
Pages apunta al mismo proyecto.

### 1. Crear D1

```bash
npx wrangler d1 create vue-finanzas-db
```

Copiá el `database_id` que devuelve Wrangler a `wrangler.toml`.

El binding debe llamarse **DB**, porque el código usa `c.env.DB`.

### 2. Crear el schema local

```bash
npm run db:migrate:local
```

Para una base nueva, `schema.sql` ya contiene `ccl` y `ratio` en `trades`.

### 3. Levantar Pages Functions + D1 local

```bash
npm run pages:dev
```

Wrangler usará el `pages_build_output_dir` del `wrangler.toml` y el binding D1
configurado para Pages local.

También podés ejecutar el frontend con hot reload:

```bash
# Terminal 1
npm run pages:dev

# Terminal 2
npm run dev
```

El proxy de `vite.config.js` reenvía `/api` a `http://localhost:8788`.

## Backend opcional: Express + SQLite

No hace falta para Cloudflare. Sirve cuando querés ejecutar una API local
tradicional.

```bash
cd backend
npm install
cp .env.example .env
npm start
```

Por defecto queda en:

```text
http://localhost:3001/api
```

Podés indicar en la raíz del frontend:

```env
VITE_API_URL=http://localhost:3001
```

El cliente agrega `/api` automáticamente, por lo que también acepta:

```env
VITE_API_URL=http://localhost:3001/api
```

SQLite usa automáticamente:

```text
backend/data/dashboard.db
```

y toma las tablas desde el `schema.sql` de la raíz para evitar que SQLite y D1
terminen con estructuras distintas.

## Producción en Cloudflare Pages

### 1. D1 remoto

Si la base todavía no existe:

```bash
npx wrangler d1 create vue-finanzas-db
```

Guardá el `database_id` en `wrangler.toml`.

### 2. Schema remoto

Para una base nueva:

```bash
npm run db:migrate:remote
```

### 3. Binding del proyecto Pages

En Cloudflare Dashboard:

```text
Workers & Pages
→ tu proyecto Pages
→ Settings
→ Bindings
→ D1 database bindings
→ Variable name: DB
→ Database: vue-finanzas-db
```

Después de modificar un binding, redeployá el proyecto.

### 4. Variables de build

Configurá:

```env
VITE_FINNHUB_API_KEY=tu_clave
VITE_API_URL=
```

No pongas la clave de Finnhub dentro del código fuente.

## Bases existentes: migraciones

Si ya tenés una base anterior a la versión con CCL/ratio, no vuelvas a ejecutar
`ALTER TABLE` a ciegas. Usá las migraciones correspondientes solo una vez:

```bash
# Local
npm run db:migrate:ccl:local
npm run db:migrate:ratio:local

# Remoto
npm run db:migrate:ccl:remote
npm run db:migrate:ratio:remote
```

Si una base vieja ya tiene alguna de esas columnas, esa migración no debe
repetirse porque SQLite/D1 devolverá `duplicate column name`.

## Diagnóstico de conexión

Cloudflare / Pages:

```text
GET /api/health
GET /api/db-check
```

SQLite / Express:

```text
GET http://localhost:3001/api/health
GET http://localhost:3001/api/db-check
```

`/api/db-check` ahora es de solo lectura: ejecuta `SELECT 1` y no agrega filas
a `ping` cada vez que se consulta.

Si D1 no está configurado en Pages, la API devuelve:

```json
{
  "error": "La base de datos D1 no está configurada para este entorno",
  "code": "DB_UNAVAILABLE"
}
```

El frontend detecta ese caso como indisponibilidad y pasa al respaldo local.

## Qué significa trabajar sin base de datos

Cuando no existe D1 ni SQLite/Express, estos módulos siguen funcionando con
`localStorage`:

- Alertas
- Watchlist USA
- Checklist e indicadores
- Mis Trades
- Planilla profesional de trading

Los registros creados sin backend reciben IDs negativos para diferenciarlos de
los registros persistidos en la base.

Este respaldo es **por navegador/dispositivo**: no sincroniza automáticamente
entre computadoras, usuarios o teléfonos. Cuando el backend vuelve a estar
disponible, los datos ya remotos continúan sincronizados; los registros locales
nuevos quedan identificados como locales hasta que se migren manualmente.

## Persistencia de Trades y CEDEARs

La tabla `trades` guarda:

- fecha
- tipo de activo
- ticker
- compra/venta
- cantidad
- precio
- comisión
- notas
- CCL
- ratio CEDEAR

El cálculo de precio en USD y el resumen de resultados usan el mismo formato en
D1, SQLite y el respaldo local del navegador.

## Fuentes de cotizaciones

| Dato | Fuente |
|---|---|
| Dólar Oficial / Blue / MEP / CCL | dolarapi.com |
| Riesgo País | argentinadatos.com |
| Acciones USA | Finnhub |
| CEDEARs | cálculo `(precio USD ÷ ratio) × CCL` |
| Persistencia | D1 / SQLite / localStorage fallback |
