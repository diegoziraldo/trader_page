# Vue Finanzas

Dashboard financiero (dólar/riesgo país, watchlist de acciones USA, CEDEARs,
alertas de precio, checklist de compra, bitácora de trades) hecho con
**Vue 3 + Vite** en el frontend y **Cloudflare Pages Functions + D1** como
backend/base de datos. Todo corre en un solo proyecto de Cloudflare.

## Estructura

```
src/                    # Frontend Vue 3
├── App.vue             # Layout de 3 columnas, conecta todo
├── components/         # SearchBar, FinanceTicker, StockPanel, AlertsPanel, Checklist, TradesModal, JournalModal, etc.
├── composables/        # Estado reactivo (useDolar, useStocks, useAlerts, useEarnings...)
├── data/                # Listas estáticas (tickers con CEDEAR, ranking S&P 500)
└── services/            # Llamadas a APIs externas (Finnhub, dolarapi) y a /api (propio backend)

functions/               # Backend: Cloudflare Pages Functions
├── api/[[route]].js     # Router único (Hono) para todo /api/*
└── _lib/                # Lógica de cada recurso (alerts, watchlist, checklist, trades, journal) usando D1

schema.sql               # Definición de tablas D1 + seed inicial
migrations/               # Migraciones puntuales para bases D1/SQLite ya existentes
wrangler.toml             # Config de Cloudflare (build output, binding de D1)
```

## Desarrollo local

```bash
npm install
cp .env.example .env
# Editá .env y pegá tu clave de Finnhub (gratis en https://finnhub.io/register)

# 1) Creá la base de datos D1 (una sola vez)
npx wrangler d1 create vue-finanzas-db
# Copiá el "database_id" que te devuelve y pegalo en wrangler.toml

# 2) Aplicá el schema a la base local
npm run db:migrate:local

# 3) Levantá todo (build + Pages Functions + D1 local) en http://localhost:8788
npm run pages:dev
```

Si preferís el hot-reload de Vite mientras programás el frontend, corré
`npm run pages:dev` en una terminal y `npm run dev` en otra: el proxy de
`vite.config.js` reenvía `/api` al puerto 8788.

## Deploy a producción (Cloudflare Pages)

1. **Creá la base D1 remota** (si no la creaste antes):
   ```bash
   npx wrangler d1 create vue-finanzas-db
   ```
   Guardá el `database_id` en `wrangler.toml`.

2. **Aplicá el schema en producción**:
   ```bash
   npm run db:migrate:remote
   ```

3. **Conectá el binding de D1 en el proyecto de Cloudflare Pages**: Dashboard
   → tu proyecto → Settings → Functions → D1 database bindings → agregá
   `DB` → `vue-finanzas-db`. (Si tu proyecto ya está enlazado a este repo de
   GitHub, esto es lo único que faltaba para que la base de datos funcione).

4. **Variables de entorno del build** (Settings → Environment variables):
   `VITE_FINNHUB_API_KEY` con tu clave. `VITE_API_URL` dejalo vacío (usa
   rutas relativas `/api`, mismo dominio).

5. Hacé push a GitHub — Cloudflare Pages buildea (`npm run build`, output
   `dist`) y despliega el frontend + las funciones de `/functions` juntos.

## Qué es 100% en vivo y qué es calculado

| Dato | Fuente | Notas |
|---|---|---|
| Dólar Oficial/Blue/MEP/CCL | dolarapi.com | En vivo, sin API key |
| Riesgo País | argentinadatos.com | En vivo, sin API key |
| Acciones USA (AAPL, TSLA, etc.) | Finnhub | En vivo, requiere API key gratis |
| CEDEARs (GGAL.BA, YPFD.BA, etc.) | Calculado | `(precio USD Finnhub ÷ ratio) × CCL`. Finnhub no cubre BYMA en el plan gratis. |
| Alertas, checklist, trades, planilla profesional, watchlist | Cloudflare D1 | Persistido en la base de datos propia, vía `/api/*` |

Los ratios de CEDEARs son editables desde la UI (campo "Ratio").

## Rendimiento en pesos y en dólares (CCL) de tus CEDEARs

La bitácora de trades ("📒 Mis Trades") calcula, para cada ticker, el
resultado realizado y el costo promedio tanto en pesos como en dólares:

- Cada operación guarda el **dólar CCL** vigente ese día (autocompletado: en
  vivo vía dolarapi.com si la fecha es hoy, o histórico vía
  api.argentinadatos.com si es una fecha pasada; siempre editable a mano).
- Con eso, el costo y el resultado realizado de cada venta se calculan en
  USD igual que en ARS (precio ARS ÷ CCL de ese día), usando costo promedio
  ponderado (PPC).
- Para las posiciones abiertas de CEDEARs, además se trae el precio actual
  en vivo (data912.com) y se muestra el valor de mercado y el rendimiento
  no realizado en ARS y en USD, igual que en el estado de cuenta de un
  broker.

Si a alguna operación de un ticker le falta el CCL, esa fila se muestra con
"—" en vez de un número (en lugar de calcular mal), hasta que la completes.

## Notas sobre las alarmas de precio

Precios en vivo vía Finnhub (no Yahoo Finance, para evitar problemas de CORS
en el navegador). El calendario de balances (`earningsService.js`) también
usa Finnhub, filtrado a compañías con CEDEAR en BYMA.