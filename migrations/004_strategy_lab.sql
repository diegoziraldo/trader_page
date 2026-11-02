-- Migración 004: módulo STRATEGY LAB.
-- Es idempotente (todo usa IF NOT EXISTS) y NO toca ninguna tabla existente:
-- se puede correr varias veces sin perder datos.
--
-- Local:
--   npx wrangler d1 execute DB --local  --file=./migrations/004_strategy_lab.sql
-- Producción:
--   npx wrangler d1 execute DB --remote --file=./migrations/004_strategy_lab.sql
--
-- (Si tu ruta tiene espacios, usá la ruta absoluta entre comillas en --file.)
-- Para bases nuevas, el mismo contenido está al final de schema.sql.

-- Identidad de la estrategia. Lo que NO afecta las reglas (nombre, descripción,
-- categoría, notas, estado) vive acá y se puede editar sin crear versión.
CREATE TABLE IF NOT EXISTS strategies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'ARCHIVED')) DEFAULT 'ACTIVE',
  current_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Reglas congeladas de la estrategia en un momento dado. Una operación apunta
-- SIEMPRE a una versión concreta; una versión con operaciones nunca se modifica.
-- `signature` es el JSON canónico de todo el contenido que afecta las reglas
-- (sirve para detectar si hubo un cambio real y merece nueva versión).
CREATE TABLE IF NOT EXISTS strategy_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  strategy_id INTEGER NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  direction_mode TEXT NOT NULL CHECK (direction_mode IN ('LONG', 'SHORT', 'BOTH')) DEFAULT 'BOTH',
  timeframes TEXT NOT NULL DEFAULT '[]',   -- JSON: ["15m","1H","1D"]
  indicators TEXT NOT NULL DEFAULT '[]',   -- JSON: ["HMA 50","RSI 14","MACD"]
  stop_loss_rule TEXT NOT NULL DEFAULT '',
  take_profit_rule TEXT NOT NULL DEFAULT '',
  target_rr REAL,
  signature TEXT NOT NULL,
  change_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (strategy_id, version_number)
);

-- Condiciones de entrada/salida/filtro de una versión. Estructura abierta:
-- `label` es texto libre; `indicator`, `operator` y `params` (JSON) son
-- opcionales y no están limitados a una lista fija.
-- `condition_key` es un identificador estable que se conserva entre versiones
-- para poder medir la efectividad de una misma condición a lo largo del tiempo.
CREATE TABLE IF NOT EXISTS strategy_conditions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id INTEGER NOT NULL REFERENCES strategy_versions(id) ON DELETE CASCADE,
  condition_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('ENTRY', 'EXIT', 'FILTER')) DEFAULT 'ENTRY',
  label TEXT NOT NULL,
  indicator TEXT NOT NULL DEFAULT '',
  operator TEXT NOT NULL DEFAULT '',
  params TEXT NOT NULL DEFAULT '{}',
  required INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 0,
  UNIQUE (version_id, condition_key)
);

-- Operaciones (backtesting manual o trading real). Se guardan SOLO los datos
-- de entrada; R, %, monto, resultado y duración se derivan al leer
-- (src/services/strategyLab/tradeMath.js) para que nunca queden desincronizados.
-- Fecha/hora de salida vacías = operación pendiente.
CREATE TABLE IF NOT EXISTS strategy_trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  strategy_id INTEGER NOT NULL REFERENCES strategies(id) ON DELETE RESTRICT,
  version_id INTEGER NOT NULL REFERENCES strategy_versions(id) ON DELETE RESTRICT,
  record_type TEXT NOT NULL CHECK (record_type IN ('BACKTEST', 'REAL')),
  symbol TEXT NOT NULL,
  asset_name TEXT NOT NULL DEFAULT '',
  market TEXT NOT NULL DEFAULT '',
  instrument_type TEXT NOT NULL DEFAULT 'ACCION' CHECK (instrument_type IN (
    'ACCION', 'CEDEAR', 'FOREX', 'FUTURO', 'CRIPTO', 'OPCION', 'INDICE', 'MATERIA_PRIMA', 'BONO', 'OTRO'
  )),
  direction TEXT NOT NULL CHECK (direction IN ('LONG', 'SHORT')),
  timeframe TEXT NOT NULL,
  entry_date TEXT NOT NULL,
  entry_time TEXT NOT NULL DEFAULT '',
  entry_price REAL NOT NULL CHECK (entry_price > 0),
  stop_loss REAL,
  take_profit REAL,
  risk_amount REAL,
  risk_percent REAL,
  quantity REAL,
  exit_date TEXT,
  exit_time TEXT NOT NULL DEFAULT '',
  exit_price REAL,
  fees REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Evita cargar dos veces la misma oportunidad.
CREATE UNIQUE INDEX IF NOT EXISTS uq_strategy_trades_dup
  ON strategy_trades (strategy_id, record_type, symbol, timeframe, direction, entry_date, entry_time, entry_price);
CREATE INDEX IF NOT EXISTS idx_strategy_trades_strategy ON strategy_trades (strategy_id);
CREATE INDEX IF NOT EXISTS idx_strategy_trades_version ON strategy_trades (version_id);
CREATE INDEX IF NOT EXISTS idx_strategy_trades_symbol ON strategy_trades (symbol);
CREATE INDEX IF NOT EXISTS idx_strategy_trades_entry_date ON strategy_trades (entry_date);

-- Estado individual de cada condición en cada operación.
CREATE TABLE IF NOT EXISTS trade_condition_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trade_id INTEGER NOT NULL REFERENCES strategy_trades(id) ON DELETE CASCADE,
  condition_id INTEGER NOT NULL REFERENCES strategy_conditions(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('MET', 'NOT_MET', 'NA')),
  UNIQUE (trade_id, condition_id)
);

-- Capturas de gráfico. D1 no es almacenamiento de archivos y el proyecto no
-- tiene R2, así que se guardan como data URL ya reducida por el navegador
-- (máx. ~1 MB cada una, 3 por operación). Si más adelante se agrega R2,
-- alcanza con cambiar `data_url` por una clave de objeto.
CREATE TABLE IF NOT EXISTS trade_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trade_id INTEGER NOT NULL REFERENCES strategy_trades(id) ON DELETE CASCADE,
  filename TEXT NOT NULL DEFAULT '',
  mime TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  data_url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_trade_attachments_trade ON trade_attachments (trade_id);
