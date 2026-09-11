const db = require('../db');

// GET /api/watchlist/us
function getAll(req, res) {
  const rows = db.prepare('SELECT * FROM watchlist_us ORDER BY position ASC, id ASC').all();
  res.json(rows);
}

// POST /api/watchlist/us  { symbol, name? }
function create(req, res) {
  const { name = 'Personalizado' } = req.body;
  const symbol = (req.body.symbol || '').trim().toUpperCase();

  if (!symbol) {
    return res.status(400).json({ error: 'symbol es requerido' });
  }

  const existing = db.prepare('SELECT * FROM watchlist_us WHERE symbol = ?').get(symbol);
  if (existing) {
    // Ya está en la lista: no es un error, devolvemos el que ya había.
    return res.status(200).json(existing);
  }

  const { max } = db.prepare('SELECT COALESCE(MAX(position), -1) as max FROM watchlist_us').get();
  const stmt = db.prepare('INSERT INTO watchlist_us (symbol, name, position) VALUES (?, ?, ?)');
  const info = stmt.run(symbol, name, max + 1);

  const created = db.prepare('SELECT * FROM watchlist_us WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(created);
}

// DELETE /api/watchlist/us/:symbol
// Se borra por símbolo (no por id) porque así es como el frontend identifica
// cada fila de la watchlist en pantalla.
function remove(req, res) {
  const symbol = req.params.symbol.toUpperCase();
  const result = db.prepare('DELETE FROM watchlist_us WHERE symbol = ?').run(symbol);
  if (result.changes === 0) return res.status(404).json({ error: 'Ticker no encontrado' });
  res.status(204).send();
}

module.exports = { getAll, create, remove };