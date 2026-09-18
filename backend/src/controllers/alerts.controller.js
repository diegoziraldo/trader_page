const db = require('../db');

// GET /api/alerts
function getAll(req, res) {
  const rows = db.prepare('SELECT * FROM alerts ORDER BY created_at DESC').all();
  res.json(rows.map(formatAlert));
}

// POST /api/alerts
function create(req, res) {
  const { ticker, type = 'IN', price = null } = req.body;

  if (!ticker) {
    return res.status(400).json({ error: 'ticker es requerido', code: 'VALIDATION_ERROR' });
  }
  if (!['IN', 'TARGET', 'STOP_LOSS'].includes(type)) {
    return res.status(400).json({ error: "type debe ser 'IN', 'TARGET' o 'STOP_LOSS'", code: 'VALIDATION_ERROR' });
  }

  if (price !== null && price !== '' && !(Number(price) > 0)) {
    return res.status(400).json({ error: 'price debe ser mayor a 0', code: 'VALIDATION_ERROR' });
  }

  const stmt = db.prepare('INSERT INTO alerts (ticker, type, price) VALUES (?, ?, ?)');
  const info = stmt.run(ticker.toUpperCase(), type, price);

  const created = db.prepare('SELECT * FROM alerts WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(formatAlert(created));
}

// PUT /api/alerts/:id
function update(req, res) {
  const existing = db.prepare('SELECT * FROM alerts WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Alerta no encontrada' });

  const ticker = req.body.ticker !== undefined
    ? String(req.body.ticker).trim().toUpperCase()
    : existing.ticker;
  const type = req.body.type !== undefined ? req.body.type : existing.type;
  const price = req.body.price !== undefined ? req.body.price : existing.price;
  const triggered = req.body.triggered !== undefined ? req.body.triggered : existing.triggered;

  if (!ticker) return res.status(400).json({ error: 'ticker es requerido', code: 'VALIDATION_ERROR' });
  if (!['IN', 'TARGET', 'STOP_LOSS'].includes(type)) {
    return res.status(400).json({ error: "type debe ser 'IN', 'TARGET' o 'STOP_LOSS'", code: 'VALIDATION_ERROR' });
  }
  if (price !== null && price !== '' && !(Number(price) > 0)) {
    return res.status(400).json({ error: 'price debe ser mayor a 0', code: 'VALIDATION_ERROR' });
  }

  db.prepare(`
    UPDATE alerts
    SET ticker = ?, type = ?, price = ?, triggered = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(ticker.toUpperCase(), type, price, triggered ? 1 : 0, req.params.id);

  const updated = db.prepare('SELECT * FROM alerts WHERE id = ?').get(req.params.id);
  res.json(formatAlert(updated));
}

// DELETE /api/alerts/:id
function remove(req, res) {
  const result = db.prepare('DELETE FROM alerts WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Alerta no encontrada' });
  res.status(204).send();
}

function formatAlert(row) {
  return {
    id: row.id,
    ticker: row.ticker,
    type: row.type,
    price: row.price,
    triggered: !!row.triggered,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

module.exports = { getAll, create, update, remove };