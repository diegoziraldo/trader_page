const db = require('../db');

function getIndicators(tickerId) {
  return db
    .prepare('SELECT * FROM checklist_indicators WHERE ticker_id = ? ORDER BY position ASC, id ASC')
    .all(tickerId)
    .map((i) => ({
      id: i.id,
      text: i.text,
      weight: i.weight,
      checked: !!i.checked,
    }));
}

function formatTicker(row) {
  return {
    id: row.id,
    symbol: row.symbol,
    sector: row.sector,
    expanded: !!row.expanded,
    indicators: getIndicators(row.id),
  };
}

// GET /api/checklist
function getAll(req, res) {
  const rows = db.prepare('SELECT * FROM checklist_tickers ORDER BY id ASC').all();
  res.json(rows.map(formatTicker));
}

// POST /api/checklist  { symbol, sector, indicators?: [{text, weight}] }
function create(req, res) {
  const symbol = (req.body.symbol || '').trim().toUpperCase();
  const sector = req.body.sector || 'General';
  const indicators = Array.isArray(req.body.indicators) ? req.body.indicators : [];

  if (!symbol) {
    return res.status(400).json({ error: 'symbol es requerido' });
  }

  const existing = db.prepare('SELECT * FROM checklist_tickers WHERE symbol = ?').get(symbol);
  if (existing) {
    return res.status(200).json(formatTicker(existing));
  }

  const createTx = db.transaction(() => {
    const info = db
      .prepare('INSERT INTO checklist_tickers (symbol, sector) VALUES (?, ?)')
      .run(symbol, sector);
    const tickerId = info.lastInsertRowid;

    const insertIndicator = db.prepare(
      'INSERT INTO checklist_indicators (ticker_id, text, weight, position) VALUES (?, ?, ?, ?)'
    );
    indicators.forEach((ind, i) => {
      insertIndicator.run(tickerId, ind.text, ind.weight || 3, i);
    });

    return tickerId;
  });

  const tickerId = createTx();
  const created = db.prepare('SELECT * FROM checklist_tickers WHERE id = ?').get(tickerId);
  res.status(201).json(formatTicker(created));
}

// PUT /api/checklist/:id  { sector?, expanded?, indicators?: [{text, weight}] }
// Si viene "indicators", se reemplaza la lista completa (se usa al cambiar de
// sector, igual que hacía changeSector() en el frontend con localStorage).
function update(req, res) {
  const existing = db.prepare('SELECT * FROM checklist_tickers WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Ticker no encontrado' });

  const sector = req.body.sector !== undefined ? req.body.sector : existing.sector;
  const expanded = req.body.expanded !== undefined ? (req.body.expanded ? 1 : 0) : existing.expanded;

  const updateTx = db.transaction(() => {
    db.prepare(
      `UPDATE checklist_tickers SET sector = ?, expanded = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(sector, expanded, req.params.id);

    if (Array.isArray(req.body.indicators)) {
      db.prepare('DELETE FROM checklist_indicators WHERE ticker_id = ?').run(req.params.id);
      const insertIndicator = db.prepare(
        'INSERT INTO checklist_indicators (ticker_id, text, weight, position) VALUES (?, ?, ?, ?)'
      );
      req.body.indicators.forEach((ind, i) => {
        insertIndicator.run(req.params.id, ind.text, ind.weight || 3, i);
      });
    }
  });
  updateTx();

  const updated = db.prepare('SELECT * FROM checklist_tickers WHERE id = ?').get(req.params.id);
  res.json(formatTicker(updated));
}

// DELETE /api/checklist/:id
function remove(req, res) {
  // Borramos los indicadores explícitamente además de confiar en el
  // ON DELETE CASCADE, para no depender de que el PRAGMA foreign_keys
  // esté activo en cada conexión.
  const removeTx = db.transaction(() => {
    db.prepare('DELETE FROM checklist_indicators WHERE ticker_id = ?').run(req.params.id);
    return db.prepare('DELETE FROM checklist_tickers WHERE id = ?').run(req.params.id);
  });
  const result = removeTx();
  if (result.changes === 0) return res.status(404).json({ error: 'Ticker no encontrado' });
  res.status(204).send();
}

// POST /api/checklist/:tickerId/indicators  { text, weight }
function addIndicator(req, res) {
  const ticker = db.prepare('SELECT * FROM checklist_tickers WHERE id = ?').get(req.params.tickerId);
  if (!ticker) return res.status(404).json({ error: 'Ticker no encontrado' });

  const { text, weight = 3 } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'text es requerido' });

  const { max } = db
    .prepare('SELECT COALESCE(MAX(position), -1) as max FROM checklist_indicators WHERE ticker_id = ?')
    .get(req.params.tickerId);

  const info = db
    .prepare('INSERT INTO checklist_indicators (ticker_id, text, weight, position) VALUES (?, ?, ?, ?)')
    .run(req.params.tickerId, text.trim(), weight, max + 1);

  const created = db.prepare('SELECT * FROM checklist_indicators WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ id: created.id, text: created.text, weight: created.weight, checked: !!created.checked });
}

// PUT /api/checklist/indicators/:id  { text?, weight?, checked? }
function updateIndicator(req, res) {
  const existing = db.prepare('SELECT * FROM checklist_indicators WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Indicador no encontrado' });

  const text = req.body.text !== undefined ? req.body.text : existing.text;
  const weight = req.body.weight !== undefined ? req.body.weight : existing.weight;
  const checked = req.body.checked !== undefined ? (req.body.checked ? 1 : 0) : existing.checked;

  db.prepare('UPDATE checklist_indicators SET text = ?, weight = ?, checked = ? WHERE id = ?').run(
    text,
    weight,
    checked,
    req.params.id
  );

  const updated = db.prepare('SELECT * FROM checklist_indicators WHERE id = ?').get(req.params.id);
  res.json({ id: updated.id, text: updated.text, weight: updated.weight, checked: !!updated.checked });
}

// DELETE /api/checklist/indicators/:id
function removeIndicator(req, res) {
  const result = db.prepare('DELETE FROM checklist_indicators WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Indicador no encontrado' });
  res.status(204).send();
}

module.exports = {
  getAll,
  create,
  update,
  remove,
  addIndicator,
  updateIndicator,
  removeIndicator,
};