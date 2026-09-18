const db = require('../db');

function formatCaucion(row) {
  return {
    id: row.id,
    fecha: row.fecha,
    importe: row.importe,
    tasa: row.tasa,
    dias: row.dias,
    interes: row.interes,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

function validateBody(body) {
  const errors = [];
  if (!body.fecha) errors.push('fecha es requerida');
  if (!(Number(body.importe) > 0)) errors.push('el importe debe ser mayor a 0');
  if (!(Number(body.tasa) > 0)) errors.push('la tasa debe ser mayor a 0');
  if (!(Number.isInteger(Number(body.dias)) && Number(body.dias) > 0)) {
    errors.push('los días deben ser un número entero mayor a 0');
  }
  if (!(Number(body.interes) >= 0)) errors.push('el interés cobrado no puede ser negativo');
  return errors;
}

// GET /api/cauciones
function getAll(req, res) {
  const rows = db
    .prepare('SELECT * FROM cauciones ORDER BY fecha ASC, id ASC')
    .all();
  res.json(rows.map(formatCaucion));
}

// POST /api/cauciones
// { fecha, importe, tasa, dias, interes, notes? }
function create(req, res) {
  const errors = validateBody(req.body);
  if (errors.length) return res.status(400).json({ error: errors.join(', ') });

  const { fecha, notes = '' } = req.body;
  const importe = Number(req.body.importe);
  const tasa = Number(req.body.tasa);
  const dias = Number(req.body.dias);
  const interes = Number(req.body.interes);

  const info = db
    .prepare(
      `INSERT INTO cauciones (fecha, importe, tasa, dias, interes, notes)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(fecha, importe, tasa, dias, interes, notes);

  const created = db.prepare('SELECT * FROM cauciones WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(formatCaucion(created));
}

// PUT /api/cauciones/:id
function update(req, res) {
  const existing = db.prepare('SELECT * FROM cauciones WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Caución no encontrada' });

  const merged = {
    fecha: req.body.fecha ?? existing.fecha,
    importe: req.body.importe ?? existing.importe,
    tasa: req.body.tasa ?? existing.tasa,
    dias: req.body.dias ?? existing.dias,
    interes: req.body.interes ?? existing.interes,
  };
  const errors = validateBody(merged);
  if (errors.length) return res.status(400).json({ error: errors.join(', ') });

  const notes = req.body.notes !== undefined ? req.body.notes : existing.notes;

  db.prepare(
    `UPDATE cauciones SET
      fecha = ?, importe = ?, tasa = ?, dias = ?, interes = ?, notes = ?,
      updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    merged.fecha,
    Number(merged.importe),
    Number(merged.tasa),
    Number(merged.dias),
    Number(merged.interes),
    notes,
    req.params.id
  );

  const updated = db.prepare('SELECT * FROM cauciones WHERE id = ?').get(req.params.id);
  res.json(formatCaucion(updated));
}

// DELETE /api/cauciones/:id
function remove(req, res) {
  const result = db.prepare('DELETE FROM cauciones WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Caución no encontrada' });
  res.status(204).send();
}

// GET /api/cauciones/summary
// Total de interés cobrado por cauciones — se suma al resultado general
// de la bitácora (TradesModal.vue lo combina con el P&L de trades).
function getSummary(req, res) {
  const rows = db.prepare('SELECT * FROM cauciones').all();
  const totalInteres = Math.round(rows.reduce((acc, r) => acc + Number(r.interes || 0), 0) * 100) / 100;
  const totalImporte = Math.round(rows.reduce((acc, r) => acc + Number(r.importe || 0), 0) * 100) / 100;
  res.json({ totalInteres, totalImporte, cantidad: rows.length });
}

module.exports = { getAll, create, update, remove, getSummary };
