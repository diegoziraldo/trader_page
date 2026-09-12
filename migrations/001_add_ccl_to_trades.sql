-- Migración: agrega la columna `ccl` a la tabla `trades` ya existente.
-- Solo hace falta correrla UNA VEZ si tu base de datos D1 (o tu SQLite local)
-- fue creada antes de este cambio y ya tiene la tabla `trades` sin esta
-- columna. Si es una base nueva, `schema.sql` ya la crea con `ccl` incluido
-- y no hace falta correr esto.
--
-- Local:
--   npx wrangler d1 execute DB --local --file=./migrations/001_add_ccl_to_trades.sql
-- Producción:
--   npx wrangler d1 execute DB --remote --file=./migrations/001_add_ccl_to_trades.sql
--
-- Nota: si la columna ya existe, este comando va a fallar con un error de
-- "duplicate column name" — es esperable, ignoralo.

ALTER TABLE trades ADD COLUMN ccl REAL;
