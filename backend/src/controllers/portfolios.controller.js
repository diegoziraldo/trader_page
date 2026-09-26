const db = require('../db');

// Armado de carteras: mismo criterio que functions/_lib/portfolios.js (su
// gemelo de Cloudflare), pero contra better-sqlite3 en vez de D1.

const ASSET_TYPES = ['CEDEAR', 'ACCION_AR'];

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function formatPortfolio(row) {
  return {
    id: row.id,
    name: row.name,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function formatPosition(row) {
  const quantity = Number(row.quantity);
  const avgPrice = Number(row.avg_price);
  return {
    id: row.id,
    portfolioId: row.portfolio_id,
    assetType: row.asset_type,
    ticker: row.ticker,
    underlyingTicker: row.underlying_ticker || '',
    ratio: row.ratio != null ? Number(row.ratio) : null,
    sector: row.sector || 'General',
    quantity,
    avgPrice,
    invested: round2(quantity * avgPrice),
    targetWeight: row.target_weight != null ? Number(row.target_weight) : null,
    manualPrice: row.manual_price != null ? Number(row.manual_price) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validatePortfolioBody(body) {
  const errors = [];
  if (!body.name || !String(body.name).trim()) errors.push('name es requerido');
  return errors;
}

function validatePositionBody(body) {
  const errors = [];
  if (!ASSET_TYPES.includes(body.assetType)) errors.push('assetType inválido');
  if (!body.ticker || !String(body.ticker).trim()) errors.push('ticker es requerido');
  if (!(Number(body.quantity) > 0)) errors.push('quantity debe ser mayor a 0');
  if (!(Number(body.avgPrice) > 0)) errors.push('avgPrice debe ser mayor a 0');
  if (body.ratio !== undefined && body.ratio !== null && body.ratio !== '' && !(Number(body.ratio) > 0)) {
    errors.push('ratio debe ser mayor a 0 (o dejalo vacío)');
  }
  if (
    body.targetWeight !== undefined &&
    body.targetWeight !== null &&
    body.targetWeight !== '' &&
    (Number(body.targetWeight) < 0 || Number(body.targetWeight) > 100)
  ) {
    errors.push('targetWeight debe estar entre 0 y 100');
  }
  return errors;
}

// ---------- Carteras ----------

// GET /api/portfolios
function getAllPortfolios(req, res) {
  const rows = db.prepare('SELECT * FROM portfolios ORDER BY id ASC').all();
  res.json(rows.map(formatPortfolio));
}

// POST /api/portfolios
function createPortfolio(req, res) {
  const errors = validatePortfolioBody(req.body);
  if (errors.length) return res.status(400).json({ error: errors.join(', ') });

  const name = String(req.body.name).trim();
  const notes = req.body.notes || '';

  const info = db.prepare('INSERT INTO portfolios (name, notes) VALUES (?, ?)').run(name, notes);
  const created = db.prepare('SELECT * FROM portfolios WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(formatPortfolio(created));
}

// PUT /api/portfolios/:id
function updatePortfolio(req, res) {
  const existing = db.prepare('SELECT * FROM portfolios WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Cartera no encontrada' });

  const name = req.body.name !== undefined ? String(req.body.name).trim() : existing.name;
  if (!name) return res.status(400).json({ error: 'name es requerido' });
  const notes = req.body.notes !== undefined ? req.body.notes : existing.notes;

  db.prepare(`UPDATE portfolios SET name = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`).run(
    name,
    notes,
    req.params.id
  );

  const updated = db.prepare('SELECT * FROM portfolios WHERE id = ?').get(req.params.id);
  res.json(formatPortfolio(updated));
}

// DELETE /api/portfolios/:id
function removePortfolio(req, res) {
  const result = db.prepare('DELETE FROM portfolios WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Cartera no encontrada' });
  res.status(204).send();
}

// ---------- Posiciones ----------

// GET /api/portfolios/:id/positions
function getPositions(req, res) {
  const rows = db
    .prepare('SELECT * FROM portfolio_positions WHERE portfolio_id = ? ORDER BY id ASC')
    .all(req.params.id);
  res.json(rows.map(formatPosition));
}

// POST /api/portfolios/:id/positions
function createPosition(req, res) {
  const portfolio = db.prepare('SELECT id FROM portfolios WHERE id = ?').get(req.params.id);
  if (!portfolio) return res.status(404).json({ error: 'Cartera no encontrada' });

  const errors = validatePositionBody(req.body);
  if (errors.length) return res.status(400).json({ error: errors.join(', ') });

  const ticker = String(req.body.ticker).trim().toUpperCase();
  const underlyingTicker = req.body.underlyingTicker ? String(req.body.underlyingTicker).trim().toUpperCase() : '';
  const ratio =
    req.body.ratio !== undefined && req.body.ratio !== null && req.body.ratio !== '' ? Number(req.body.ratio) : null;
  const sector = req.body.sector && String(req.body.sector).trim() ? String(req.body.sector).trim() : 'General';
  const targetWeight =
    req.body.targetWeight !== undefined && req.body.targetWeight !== null && req.body.targetWeight !== ''
      ? Number(req.body.targetWeight)
      : null;
  const manualPrice =
    req.body.manualPrice !== undefined && req.body.manualPrice !== null && req.body.manualPrice !== ''
      ? Number(req.body.manualPrice)
      : null;

  const info = db
    .prepare(
      `INSERT INTO portfolio_positions
        (portfolio_id, asset_type, ticker, underlying_ticker, ratio, sector, quantity, avg_price, target_weight, manual_price)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.params.id,
      req.body.assetType,
      ticker,
      underlyingTicker,
      ratio,
      sector,
      Number(req.body.quantity),
      Number(req.body.avgPrice),
      targetWeight,
      manualPrice
    );

  const created = db.prepare('SELECT * FROM portfolio_positions WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(formatPosition(created));
}

// PUT /api/portfolios/positions/:positionId
function updatePosition(req, res) {
  const existing = db.prepare('SELECT * FROM portfolio_positions WHERE id = ?').get(req.params.positionId);
  if (!existing) return res.status(404).json({ error: 'Posición no encontrada' });

  const merged = {
    assetType: req.body.assetType ?? existing.asset_type,
    ticker: req.body.ticker ?? existing.ticker,
    quantity: req.body.quantity ?? existing.quantity,
    avgPrice: req.body.avgPrice ?? existing.avg_price,
  };
  const errors = validatePositionBody(merged);
  if (errors.length) return res.status(400).json({ error: errors.join(', ') });

  const underlyingTicker =
    req.body.underlyingTicker !== undefined
      ? String(req.body.underlyingTicker).trim().toUpperCase()
      : existing.underlying_ticker;
  const ratio =
    req.body.ratio !== undefined
      ? req.body.ratio === '' || req.body.ratio === null
        ? null
        : Number(req.body.ratio)
      : existing.ratio;
  const sector = req.body.sector !== undefined ? String(req.body.sector).trim() || 'General' : existing.sector;
  const targetWeight =
    req.body.targetWeight !== undefined
      ? req.body.targetWeight === '' || req.body.targetWeight === null
        ? null
        : Number(req.body.targetWeight)
      : existing.target_weight;
  const manualPrice =
    req.body.manualPrice !== undefined
      ? req.body.manualPrice === '' || req.body.manualPrice === null
        ? null
        : Number(req.body.manualPrice)
      : existing.manual_price;

  db.prepare(
    `UPDATE portfolio_positions SET
      asset_type = ?, ticker = ?, underlying_ticker = ?, ratio = ?, sector = ?,
      quantity = ?, avg_price = ?, target_weight = ?, manual_price = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    merged.assetType,
    String(merged.ticker).trim().toUpperCase(),
    underlyingTicker,
    ratio,
    sector,
    Number(merged.quantity),
    Number(merged.avgPrice),
    targetWeight,
    manualPrice,
    req.params.positionId
  );

  const updated = db.prepare('SELECT * FROM portfolio_positions WHERE id = ?').get(req.params.positionId);
  res.json(formatPosition(updated));
}

// DELETE /api/portfolios/positions/:positionId
function removePosition(req, res) {
  const result = db.prepare('DELETE FROM portfolio_positions WHERE id = ?').run(req.params.positionId);
  if (result.changes === 0) return res.status(404).json({ error: 'Posición no encontrada' });
  res.status(204).send();
}

// GET /api/portfolios/:id/snapshots
function getSnapshots(req, res) {
  const rows = db
    .prepare('SELECT snapshot_date as date, value_ars as value FROM portfolio_value_snapshots WHERE portfolio_id = ? ORDER BY snapshot_date ASC')
    .all(req.params.id)
  res.json(rows)
}

// POST /api/portfolios/:id/snapshots  { date: 'YYYY-MM-DD', valueARS: number }
// Upsert: si ya existe un snapshot para esa cartera y esa fecha, lo actualiza
// (así el gráfico refleja el último precio del día, no el primero).
function recordSnapshot(req, res) {
  const { date, valueARS } = req.body
  if (!date || !(Number(valueARS) > 0)) {
    return res.status(400).json({ error: 'date y valueARS (mayor a 0) son requeridos' })
  }
  const portfolio = db.prepare('SELECT id FROM portfolios WHERE id = ?').get(req.params.id)
  if (!portfolio) return res.status(404).json({ error: 'Cartera no encontrada' })

  db.prepare(
    `INSERT INTO portfolio_value_snapshots (portfolio_id, snapshot_date, value_ars)
     VALUES (?, ?, ?)
     ON CONFLICT(portfolio_id, snapshot_date) DO UPDATE SET value_ars = excluded.value_ars`
  ).run(req.params.id, date, Number(valueARS))
  res.status(204).send()
}

module.exports = {
  getAllPortfolios,
  createPortfolio,
  updatePortfolio,
  removePortfolio,
  getPositions,
  createPosition,
  updatePosition,
  removePosition,
  getSnapshots,
  recordSnapshot,
};
