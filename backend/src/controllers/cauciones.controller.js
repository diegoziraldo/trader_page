const db = require('../db');

// Cauciones bursátiles: mismas fórmulas que functions/_lib/cauciones.js
// (su gemelo de Cloudflare), pero contra better-sqlite3 en vez de D1.
//   interés bruto   = monto × (TNA / 100) × (días / 365)
//   comisión broker = % → interés bruto × (feeValue / 100)  |  fija → feeValue
//   ganancia neta   = interés bruto - comisión broker
//   TNA neta        = (ganancia neta / monto) × (365 / días) × 100

const CURRENCIES = ['ARS', 'USD'];
const FEE_TYPES = ['PERCENT', 'FIXED'];
const STATUSES = ['ACTIVA', 'FINALIZADA'];

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function addDays(dateStr, days) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + Number(days || 0));
  return dt.toISOString().slice(0, 10);
}

function formatCaucion(row) {
  const amount = Number(row.amount);
  const tna = Number(row.tna);
  const termDays = Number(row.term_days);

  const grossInterest = amount * (tna / 100) * (termDays / 365);
  const brokerFee =
    row.fee_type === 'PERCENT' ? grossInterest * (Number(row.fee_value) / 100) : Number(row.fee_value);
  const netGain = grossInterest - brokerFee;
  const netTNA = amount > 0 && termDays > 0 ? (netGain / amount) * (365 / termDays) * 100 : 0;

  return {
    id: row.id,
    startDate: row.start_date,
    termDays,
    endDate: addDays(row.start_date, termDays),
    amount,
    currency: row.currency,
    tna,
    broker: row.broker,
    feeType: row.fee_type,
    feeValue: Number(row.fee_value),
    status: row.status,
    notes: row.notes,
    grossInterest: round2(grossInterest),
    brokerFee: round2(brokerFee),
    netGain: round2(netGain),
    netTNA: round2(netTNA),
    totalToReceive: round2(amount + netGain),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validateBody(body) {
  const errors = [];
  if (!body.startDate) errors.push('startDate es requerido');
  if (!(Number(body.termDays) > 0)) errors.push('termDays debe ser mayor a 0');
  if (!(Number(body.amount) > 0)) errors.push('amount debe ser mayor a 0');
  if (!CURRENCIES.includes(body.currency)) errors.push('currency inválida');
  if (body.tna === undefined || body.tna === null || body.tna === '' || Number(body.tna) < 0 || Number.isNaN(Number(body.tna))) {
    errors.push('tna debe ser un número válido');
  }
  if (!FEE_TYPES.includes(body.feeType)) errors.push('feeType inválido');
  if (body.feeValue === undefined || body.feeValue === null || body.feeValue === '' || Number(body.feeValue) < 0) {
    errors.push('feeValue debe ser un número válido');
  }
  if (body.status && !STATUSES.includes(body.status)) errors.push('status inválido');
  return errors;
}

// GET /api/cauciones
function getAll(req, res) {
  const rows = db.prepare('SELECT * FROM cauciones ORDER BY start_date DESC, id DESC').all();
  res.json(rows.map(formatCaucion));
}

// POST /api/cauciones
function create(req, res) {
  const errors = validateBody(req.body);
  if (errors.length) return res.status(400).json({ error: errors.join(', ') });

  const broker = (req.body.broker || '').trim();
  const notes = req.body.notes || '';
  const status = STATUSES.includes(req.body.status) ? req.body.status : 'ACTIVA';

  const info = db
    .prepare(
      `INSERT INTO cauciones
        (start_date, term_days, amount, currency, tna, broker, fee_type, fee_value, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.body.startDate,
      Number(req.body.termDays),
      Number(req.body.amount),
      req.body.currency,
      Number(req.body.tna),
      broker,
      req.body.feeType,
      Number(req.body.feeValue),
      status,
      notes
    );

  const created = db.prepare('SELECT * FROM cauciones WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(formatCaucion(created));
}

// PUT /api/cauciones/:id
function update(req, res) {
  const existing = db.prepare('SELECT * FROM cauciones WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Caución no encontrada' });

  const merged = {
    startDate: req.body.startDate ?? existing.start_date,
    termDays: req.body.termDays ?? existing.term_days,
    amount: req.body.amount ?? existing.amount,
    currency: req.body.currency ?? existing.currency,
    tna: req.body.tna ?? existing.tna,
    feeType: req.body.feeType ?? existing.fee_type,
    feeValue: req.body.feeValue ?? existing.fee_value,
    status: req.body.status ?? existing.status,
  };
  const errors = validateBody(merged);
  if (errors.length) return res.status(400).json({ error: errors.join(', ') });

  const broker = req.body.broker !== undefined ? String(req.body.broker).trim() : existing.broker;
  const notes = req.body.notes !== undefined ? req.body.notes : existing.notes;

  db.prepare(
    `UPDATE cauciones SET
      start_date = ?, term_days = ?, amount = ?, currency = ?, tna = ?,
      broker = ?, fee_type = ?, fee_value = ?, status = ?, notes = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    merged.startDate,
    Number(merged.termDays),
    Number(merged.amount),
    merged.currency,
    Number(merged.tna),
    broker,
    merged.feeType,
    Number(merged.feeValue),
    merged.status,
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
function getSummary(req, res) {
  const rows = db
    .prepare('SELECT * FROM cauciones ORDER BY start_date DESC, id DESC')
    .all()
    .map(formatCaucion);

  const activas = rows.filter((r) => r.status === 'ACTIVA');
  const finalizadas = rows.filter((r) => r.status === 'FINALIZADA');

  const totalColocadoActivas = activas.reduce((acc, r) => acc + r.amount, 0);
  const gananciaNetaProyectada = activas.reduce((acc, r) => acc + r.netGain, 0);
  const gananciaNetaRealizada = finalizadas.reduce((acc, r) => acc + r.netGain, 0);
  const tnaNetaPromedioPonderada =
    totalColocadoActivas > 0
      ? activas.reduce((acc, r) => acc + r.netTNA * r.amount, 0) / totalColocadoActivas
      : 0;

  res.json({
    totals: {
      cantidadActivas: activas.length,
      cantidadFinalizadas: finalizadas.length,
      totalColocadoActivas: round2(totalColocadoActivas),
      gananciaNetaProyectada: round2(gananciaNetaProyectada),
      gananciaNetaRealizada: round2(gananciaNetaRealizada),
      gananciaNetaTotal: round2(gananciaNetaProyectada + gananciaNetaRealizada),
      tnaNetaPromedioPonderada: round2(tnaNetaPromedioPonderada),
    },
  });
}

module.exports = { getAll, create, update, remove, getSummary };
