// functions/_lib/cauciones.js
//
// Cauciones bursátiles: colocás pesos (o dólares) como caucionante a una
// TNA pactada por N días. El broker cobra una comisión (fija o % sobre el
// interés bruto) que hay que restar para saber la ganancia neta real que
// te queda de esa caución.
//
// Fórmulas (interés simple, base 365 días, igual que usan los brokers
// argentinos para cauciones colocadoras):
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

// Suma días calendario a una fecha "YYYY-MM-DD" usando UTC, para no
// arrastrar corrimientos de huso horario al calcular el vencimiento.
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

export async function getAll(db) {
  const { results } = await db
    .prepare('SELECT * FROM cauciones ORDER BY start_date DESC, id DESC')
    .all();
  return results.map(formatCaucion);
}

export async function create(db, body) {
  const errors = validateBody(body);
  if (errors.length) throw { status: 400, message: errors.join(', ') };

  const broker = (body.broker || '').trim();
  const notes = body.notes || '';
  const status = STATUSES.includes(body.status) ? body.status : 'ACTIVA';

  const info = await db
    .prepare(
      `INSERT INTO cauciones
        (start_date, term_days, amount, currency, tna, broker, fee_type, fee_value, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      body.startDate,
      Number(body.termDays),
      Number(body.amount),
      body.currency,
      Number(body.tna),
      broker,
      body.feeType,
      Number(body.feeValue),
      status,
      notes
    )
    .run();

  const created = await db.prepare('SELECT * FROM cauciones WHERE id = ?').bind(info.meta.last_row_id).first();
  return formatCaucion(created);
}

export async function update(db, id, body) {
  const existing = await db.prepare('SELECT * FROM cauciones WHERE id = ?').bind(id).first();
  if (!existing) throw { status: 404, message: 'Caución no encontrada' };

  const merged = {
    startDate: body.startDate ?? existing.start_date,
    termDays: body.termDays ?? existing.term_days,
    amount: body.amount ?? existing.amount,
    currency: body.currency ?? existing.currency,
    tna: body.tna ?? existing.tna,
    feeType: body.feeType ?? existing.fee_type,
    feeValue: body.feeValue ?? existing.fee_value,
    status: body.status ?? existing.status,
  };
  const errors = validateBody(merged);
  if (errors.length) throw { status: 400, message: errors.join(', ') };

  const broker = body.broker !== undefined ? String(body.broker).trim() : existing.broker;
  const notes = body.notes !== undefined ? body.notes : existing.notes;

  await db
    .prepare(
      `UPDATE cauciones SET
        start_date = ?, term_days = ?, amount = ?, currency = ?, tna = ?,
        broker = ?, fee_type = ?, fee_value = ?, status = ?, notes = ?,
        updated_at = datetime('now')
       WHERE id = ?`
    )
    .bind(
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
      id
    )
    .run();

  const updated = await db.prepare('SELECT * FROM cauciones WHERE id = ?').bind(id).first();
  return formatCaucion(updated);
}

export async function remove(db, id) {
  const result = await db.prepare('DELETE FROM cauciones WHERE id = ?').bind(id).run();
  if (result.meta.changes === 0) throw { status: 404, message: 'Caución no encontrada' };
}

// Resumen: cuánto tenés colocado hoy, cuánto vas a ganar (o ya ganaste) neto
// de comisión, y la TNA neta promedio ponderada por monto de las activas.
export async function getSummary(db) {
  const rows = await getAll(db);
  const activas = rows.filter((r) => r.status === 'ACTIVA');
  const finalizadas = rows.filter((r) => r.status === 'FINALIZADA');

  const totalColocadoActivas = activas.reduce((acc, r) => acc + r.amount, 0);
  const gananciaNetaProyectada = activas.reduce((acc, r) => acc + r.netGain, 0);
  const gananciaNetaRealizada = finalizadas.reduce((acc, r) => acc + r.netGain, 0);
  const tnaNetaPromedioPonderada =
    totalColocadoActivas > 0
      ? activas.reduce((acc, r) => acc + r.netTNA * r.amount, 0) / totalColocadoActivas
      : 0;

  return {
    totals: {
      cantidadActivas: activas.length,
      cantidadFinalizadas: finalizadas.length,
      totalColocadoActivas: round2(totalColocadoActivas),
      gananciaNetaProyectada: round2(gananciaNetaProyectada),
      gananciaNetaRealizada: round2(gananciaNetaRealizada),
      gananciaNetaTotal: round2(gananciaNetaProyectada + gananciaNetaRealizada),
      tnaNetaPromedioPonderada: round2(tnaNetaPromedioPonderada),
    },
  };
}
