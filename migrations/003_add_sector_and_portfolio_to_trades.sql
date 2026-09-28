-- Migración: agrega `sector` y `portfolio_id` a la tabla `trades` ya existente.
--   sector       -> sector del papel al momento de la operación (default 'General').
--   portfolio_id -> cartera (Armado de Carteras) a la que se destina la operación.
--                   Nullable: los trades viejos quedan sin cartera asignada.
--
-- Requiere que ya exista la tabla `portfolios` (migración 002).
-- Solo hace falta correrla UNA VEZ si tu base D1 (o SQLite local) se creó antes
-- de este cambio. Si es una base nueva, `schema.sql` ya trae estas columnas.
--
-- Local:
--   npx wrangler d1 execute DB --local --file=./migrations/003_add_sector_and_portfolio_to_trades.sql
-- Producción (ojo: si la ruta tiene espacios, usá la ruta absoluta entre comillas):
--   npx wrangler d1 execute DB --remote --file=./migrations/003_add_sector_and_portfolio_to_trades.sql
--
-- Nota: si una columna ya existe, va a fallar con "duplicate column name" — es
-- esperable, ignoralo.

ALTER TABLE trades ADD COLUMN sector TEXT NOT NULL DEFAULT 'General';
ALTER TABLE trades ADD COLUMN portfolio_id INTEGER REFERENCES portfolios(id) ON DELETE SET NULL;
