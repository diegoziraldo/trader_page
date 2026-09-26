-- Migración: agrega la tabla de historial de valor de cartera, para los
-- gráficos de rendimiento diario y mensual. Solo hace falta correrla UNA
-- VEZ si tu base ya existía antes de este cambio.
--
-- Local:
--   npx wrangler d1 execute DB --local --file=./migrations/003_add_portfolio_snapshots.sql
-- Producción:
--   npx wrangler d1 execute DB --remote --file=./migrations/003_add_portfolio_snapshots.sql
--
-- (Si tu carpeta tiene espacios en el nombre, como "Nuevo vol", usá la ruta
-- absoluta entre comillas en --file, igual que la vez pasada.)

CREATE TABLE IF NOT EXISTS portfolio_value_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  portfolio_id INTEGER NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  snapshot_date TEXT NOT NULL,
  value_ars REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(portfolio_id, snapshot_date)
);
