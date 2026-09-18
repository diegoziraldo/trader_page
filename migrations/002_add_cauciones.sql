-- Migración: crea la tabla `cauciones` en una base D1 (o SQLite local) que
-- ya existía de antes de este cambio. Si es una base nueva, `schema.sql` ya
-- la crea y no hace falta correr esto.
--
-- Local:
--   npx wrangler d1 execute DB --local --file=./migrations/002_add_cauciones.sql
-- Producción:
--   npx wrangler d1 execute DB --remote --file=./migrations/002_add_cauciones.sql

CREATE TABLE IF NOT EXISTS cauciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha TEXT NOT NULL,
  importe REAL NOT NULL,
  tasa REAL NOT NULL,
  dias INTEGER NOT NULL,
  interes REAL NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
