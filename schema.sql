-- Schema para Cloudflare D1 (SQLite serverless).
-- Se aplica una sola vez con:
--   npx wrangler d1 execute DB_NAME --file=./schema.sql          (local)
--   npx wrangler d1 execute DB_NAME --remote --file=./schema.sql (producción)

CREATE TABLE IF NOT EXISTS ping (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Alertas de precio. type: 'IN' (entrada), 'TARGET' (take profit) o 'STOP_LOSS'
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('IN', 'TARGET', 'STOP_LOSS')) DEFAULT 'IN',
  price REAL,
  triggered INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Watchlist de "Acciones USA" (panel izquierdo, NYSE/NASDAQ vía Finnhub).
CREATE TABLE IF NOT EXISTS watchlist_us (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT 'Personalizado',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Semilla: watchlist por defecto (se ignora si ya existe, gracias a UNIQUE(symbol)).
INSERT OR IGNORE INTO watchlist_us (symbol, name, position) VALUES
  ('AAPL', 'Apple', 0),
  ('MSFT', 'Microsoft', 1),
  ('TSLA', 'Tesla', 2),
  ('NVDA', 'NVIDIA', 3),
  ('AMZN', 'Amazon', 4),
  ('GOOGL', 'Alphabet', 5);

-- Checklist de compra: un ticker por fila, con sus indicadores en una tabla
-- relacionada para poder editarlos sueltos.
CREATE TABLE IF NOT EXISTS checklist_tickers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL UNIQUE,
  sector TEXT NOT NULL DEFAULT 'General',
  expanded INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS checklist_indicators (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker_id INTEGER NOT NULL REFERENCES checklist_tickers(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  weight INTEGER NOT NULL DEFAULT 3,
  checked INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Bitácora de operaciones (trades) de CEDEARs y acciones argentinas.
CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trade_date TEXT NOT NULL,
  asset_type TEXT NOT NULL CHECK (asset_type IN ('CEDEAR', 'ACCION_AR')) DEFAULT 'CEDEAR',
  ticker TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('COMPRA', 'VENTA')) DEFAULT 'COMPRA',
  quantity REAL NOT NULL,
  price REAL NOT NULL,
  fee REAL NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
