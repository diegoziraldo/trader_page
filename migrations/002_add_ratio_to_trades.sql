-- Agrega el ratio CEDEAR a las operaciones existentes.
-- Compatible con D1/SQLite. Ejecutar una sola vez en bases ya creadas.
-- Local:
--   npx wrangler d1 execute DB --local --file=./migrations/002_add_ratio_to_trades.sql
-- Producción:
--   npx wrangler d1 execute DB --remote --file=./migrations/002_add_ratio_to_trades.sql

ALTER TABLE trades ADD COLUMN ratio REAL NOT NULL DEFAULT 1;
