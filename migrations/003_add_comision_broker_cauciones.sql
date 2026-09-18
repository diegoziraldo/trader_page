-- Migración: agrega la columna `comision_broker` a la tabla `cauciones` ya
-- existente. Solo hace falta correrla UNA VEZ si tu base de datos D1 (o tu
-- SQLite local) ya tiene la tabla `cauciones` sin esta columna. Si es una
-- base nueva, `schema.sql` ya la crea con `comision_broker` incluida.
--
-- Local:
--   npx wrangler d1 execute DB --local --file=./migrations/003_add_comision_broker_cauciones.sql
-- Producción:
--   npx wrangler d1 execute DB --remote --file=./migrations/003_add_comision_broker_cauciones.sql
--
-- Nota: si la columna ya existe, este comando va a fallar con un error de
-- "duplicate column name" — es esperable, ignoralo.

ALTER TABLE cauciones ADD COLUMN comision_broker REAL NOT NULL DEFAULT 0;
