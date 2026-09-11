const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'dashboard.db');

const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// Tabla de prueba, solo para confirmar que la conexion y las escrituras andan.
db.exec(`
  CREATE TABLE IF NOT EXISTS ping (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Alertas de precio. type: 'IN' (entrada), 'TARGET' (take profit) o 'STOP_LOSS'
db.exec(`
  CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('IN', 'TARGET', 'STOP_LOSS')) DEFAULT 'IN',
    price REAL,
    triggered INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Watchlist de "Acciones USA" (panel izquierdo, NYSE/NASDAQ vía Finnhub).
db.exec(`
  CREATE TABLE IF NOT EXISTS watchlist_us (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL DEFAULT 'Personalizado',
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Semilla: si la tabla está vacía, la poblamos con la watchlist por defecto
// que antes estaba hardcodeada en App.vue, para no perder el estado inicial.
const usCount = db.prepare('SELECT COUNT(*) as count FROM watchlist_us').get().count;
if (usCount === 0) {
  const seedUs = db.prepare('INSERT INTO watchlist_us (symbol, name, position) VALUES (?, ?, ?)');
  const defaults = [
    ['AAPL', 'Apple'],
    ['MSFT', 'Microsoft'],
    ['TSLA', 'Tesla'],
    ['NVDA', 'NVIDIA'],
    ['AMZN', 'Amazon'],
    ['GOOGL', 'Alphabet'],
  ];
  const seedAll = db.transaction((rows) => {
    rows.forEach(([symbol, name], i) => seedUs.run(symbol, name, i));
  });
  seedAll(defaults);
}

// Checklist de compra: un ticker por fila, con sus indicadores (pesos e
// items tildables) en una tabla relacionada para poder editarlos sueltos.
db.exec(`
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
`);
// Sin esto, SQLite no borra los indicadores en cascada al borrar un ticker.
db.pragma('foreign_keys = ON');

// Bitácora de operaciones (trades) de CEDEARs y acciones argentinas, para
// llevar el registro de compras/ventas y calcular ganancias/pérdidas.
db.exec(`
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
`);

module.exports = db;