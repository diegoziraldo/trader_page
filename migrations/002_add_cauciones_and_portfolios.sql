-- Migración: agrega las tablas de Cauciones y Armado de Carteras.
-- Solo hace falta correrla UNA VEZ si tu base de datos D1 (o tu SQLite
-- local) fue creada antes de este cambio. Si es una base nueva, ya
-- corriste `schema.sql` completo y estas tablas ya existen.
--
-- Local:
--   npx wrangler d1 execute DB --local --file=./migrations/002_add_cauciones_and_portfolios.sql
-- Producción:
--   npx wrangler d1 execute DB --remote --file=./migrations/002_add_cauciones_and_portfolios.sql
--
-- Usa CREATE TABLE IF NOT EXISTS, así que es seguro correrla más de una vez.

CREATE TABLE IF NOT EXISTS cauciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  start_date TEXT NOT NULL,
  term_days INTEGER NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('ARS', 'USD')) DEFAULT 'ARS',
  tna REAL NOT NULL,
  broker TEXT NOT NULL DEFAULT '',
  fee_type TEXT NOT NULL CHECK (fee_type IN ('PERCENT', 'FIXED')) DEFAULT 'PERCENT',
  fee_value REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('ACTIVA', 'FINALIZADA')) DEFAULT 'ACTIVA',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS portfolios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS portfolio_positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  portfolio_id INTEGER NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  asset_type TEXT NOT NULL CHECK (asset_type IN ('CEDEAR', 'ACCION_AR')) DEFAULT 'CEDEAR',
  ticker TEXT NOT NULL,
  underlying_ticker TEXT NOT NULL DEFAULT '',
  ratio REAL,
  sector TEXT NOT NULL DEFAULT 'General',
  quantity REAL NOT NULL,
  avg_price REAL NOT NULL,
  target_weight REAL,
  manual_price REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
