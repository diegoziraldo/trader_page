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
  -- Dólar CCL vigente el día de la operación. Con esto se puede calcular el
  -- rendimiento en USD de cada CEDEAR/acción (precio_ars / ccl), además del
  -- rendimiento en pesos. Nullable: operaciones viejas pueden no tenerlo
  -- cargado todavía.
  ccl REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Planilla profesional de trading (plan de trade completo, para cualquier
-- tipo de instrumento: acciones, CEDEARs, forex, futuros, cripto, opciones,
-- índices, materias primas, bonos). Guarda todo lo que un trader profesional
-- necesita anotar de cada operación: setup, gestión de riesgo, resultado y
-- revisión post-trade.
CREATE TABLE IF NOT EXISTS trade_journal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_date TEXT NOT NULL,
  exit_date TEXT,
  market TEXT NOT NULL CHECK (market IN (
    'ACCION', 'CEDEAR', 'FOREX', 'FUTURO', 'CRIPTO', 'OPCION', 'INDICE', 'MATERIA_PRIMA', 'BONO', 'OTRO'
  )) DEFAULT 'ACCION',
  symbol TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('LONG', 'SHORT')) DEFAULT 'LONG',
  strategy TEXT NOT NULL DEFAULT '',
  timeframe TEXT NOT NULL DEFAULT '',
  entry_price REAL NOT NULL,
  stop_loss REAL,
  take_profit REAL,
  exit_price REAL,
  size REAL NOT NULL,
  leverage REAL NOT NULL DEFAULT 1,
  fee REAL NOT NULL DEFAULT 0,
  risk_amount REAL,
  risk_percent REAL,
  status TEXT NOT NULL CHECK (status IN ('ABIERTO', 'CERRADO', 'CANCELADO')) DEFAULT 'ABIERTO',
  emotion TEXT NOT NULL DEFAULT '',
  followed_plan INTEGER NOT NULL DEFAULT 1,
  entry_reason TEXT NOT NULL DEFAULT '',
  lessons TEXT NOT NULL DEFAULT '',
  account TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Cauciones bursátiles: colocás pesos (o dólares) como caucionante a una
-- TNA pactada por N días. El broker cobra una comisión (fija o % sobre el
-- interés bruto) que hay que restar para saber la ganancia neta real.
-- Fórmulas (interés simple, base 365 días, igual que usan los brokers
-- argentinos para cauciones colocadoras):
--   interés bruto   = monto × (TNA / 100) × (días / 365)
--   comisión broker = % → interés bruto × (feeValue / 100)  |  fija → feeValue
--   ganancia neta   = interés bruto - comisión broker  (= lo que "te queda")
--   TNA neta        = (ganancia neta / monto) × (365 / días) × 100
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

-- Armado de carteras: agrupa posiciones de CEDEARs/acciones argentinas para
-- analizar composición, peso y diversificación de forma profesional. Cada
-- posición puede llevar el ratio de conversión (CEDEARs por acción) para
-- valuar correctamente en USD contra el precio real de la acción subyacente,
-- igual criterio que usa la bitácora de trades.
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
  -- Solo aplica a CEDEARs: ticker de la acción subyacente en USA (para
  -- traer el precio en vivo por Finnhub) y ratio de conversión (cuántos
  -- CEDEARs equivalen a 1 acción). Con ambos cargados se puede valuar la
  -- posición en USD "de verdad" (precio real ÷ ratio), no aproximado con
  -- el CCL general.
  underlying_ticker TEXT NOT NULL DEFAULT '',
  ratio REAL,
  sector TEXT NOT NULL DEFAULT 'General',
  quantity REAL NOT NULL,
  avg_price REAL NOT NULL,
  -- Peso objetivo (%) que el usuario quiere que tenga esta posición en la
  -- cartera, para comparar contra el peso real y ver si hay que rebalancear.
  target_weight REAL,
  -- Precio actual manual: para ACCION_AR (o cualquier ticker sin cotización
  -- en vivo disponible), el usuario lo carga/actualiza a mano.
  manual_price REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Historial de valor de la cartera, un punto por día, para armar los
-- gráficos de rendimiento diario y mensual. Vive en la base (no en
-- localStorage) para que sea el mismo dato sin importar desde qué
-- dispositivo, navegador o URL de deploy abras la app.
CREATE TABLE IF NOT EXISTS portfolio_value_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  portfolio_id INTEGER NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  snapshot_date TEXT NOT NULL, -- 'YYYY-MM-DD'
  value_ars REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(portfolio_id, snapshot_date)
);
