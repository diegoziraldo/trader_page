// src/services/local/caucionesLocal.js
//
// Misma lógica que backend/src/controllers/cauciones.controller.js (y su
// gemelo de Cloudflare en functions/_lib/cauciones.js), pero contra
// localStorage en vez de SQLite/D1.

import { localStore } from '../localStore.js'

const TABLE = 'cauciones'

const CURRENCIES = ['ARS', 'USD']
const FEE_TYPES = ['PERCENT', 'FIXED']
const STATUSES = ['ACTIVA', 'FINALIZADA']

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

function addDays(dateStr, days) {
  const [y, m, d] = String(dateStr).split('-').map(Number)
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1))
  dt.setUTCDate(dt.getUTCDate() + Number(days || 0))
  return dt.toISOString().slice(0, 10)
}

function formatCaucion(row) {
  const amount = Number(row.amount)
  const tna = Number(row.tna)
  const termDays = Number(row.term_days)

  const grossInterest = amount * (tna / 100) * (termDays / 365)
  const brokerFee =
    row.fee_type === 'PERCENT' ? grossInterest * (Number(row.fee_value) / 100) : Number(row.fee_value)
  const netGain = grossInterest - brokerFee
  const netTNA = amount > 0 && termDays > 0 ? (netGain / amount) * (365 / termDays) * 100 : 0

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
  }
}

function validateBody(body) {
  const errors = []
  if (!body.startDate) errors.push('startDate es requerido')
  if (!(Number(body.termDays) > 0)) errors.push('termDays debe ser mayor a 0')
  if (!(Number(body.amount) > 0)) errors.push('amount debe ser mayor a 0')
  if (!CURRENCIES.includes(body.currency)) errors.push('currency inválida')
  if (body.tna === undefined || body.tna === null || body.tna === '' || Number(body.tna) < 0 || Number.isNaN(Number(body.tna))) {
    errors.push('tna debe ser un número válido')
  }
  if (!FEE_TYPES.includes(body.feeType)) errors.push('feeType inválido')
  if (body.feeValue === undefined || body.feeValue === null || body.feeValue === '' || Number(body.feeValue) < 0) {
    errors.push('feeValue debe ser un número válido')
  }
  if (body.status && !STATUSES.includes(body.status)) errors.push('status inválido')
  return errors
}

function sortRows(rows) {
  return [...rows].sort((a, b) => b.start_date.localeCompare(a.start_date) || b.id - a.id)
}

export async function getAll() {
  return sortRows(localStore.readTable(TABLE)).map(formatCaucion)
}

export async function create(body) {
  const errors = validateBody(body)
  if (errors.length) throw new Error(errors.join(', '))

  const now = new Date().toISOString()
  const row = {
    id: localStore.nextId(TABLE),
    start_date: body.startDate,
    term_days: Number(body.termDays),
    amount: Number(body.amount),
    currency: body.currency,
    tna: Number(body.tna),
    broker: (body.broker || '').trim(),
    fee_type: body.feeType,
    fee_value: Number(body.feeValue),
    status: STATUSES.includes(body.status) ? body.status : 'ACTIVA',
    notes: body.notes || '',
    created_at: now,
    updated_at: now,
  }

  const rows = localStore.readTable(TABLE)
  rows.push(row)
  localStore.writeTable(TABLE, rows)
  return formatCaucion(row)
}

export async function update(id, body) {
  const rows = localStore.readTable(TABLE)
  const idx = rows.findIndex((r) => String(r.id) === String(id))
  if (idx === -1) throw new Error('Caución no encontrada')
  const existing = rows[idx]

  const merged = {
    startDate: body.startDate ?? existing.start_date,
    termDays: body.termDays ?? existing.term_days,
    amount: body.amount ?? existing.amount,
    currency: body.currency ?? existing.currency,
    tna: body.tna ?? existing.tna,
    feeType: body.feeType ?? existing.fee_type,
    feeValue: body.feeValue ?? existing.fee_value,
    status: body.status ?? existing.status,
  }
  const errors = validateBody(merged)
  if (errors.length) throw new Error(errors.join(', '))

  const updated = {
    ...existing,
    start_date: merged.startDate,
    term_days: Number(merged.termDays),
    amount: Number(merged.amount),
    currency: merged.currency,
    tna: Number(merged.tna),
    broker: body.broker !== undefined ? String(body.broker).trim() : existing.broker,
    fee_type: merged.feeType,
    fee_value: Number(merged.feeValue),
    status: merged.status,
    notes: body.notes !== undefined ? body.notes : existing.notes,
    updated_at: new Date().toISOString(),
  }

  rows[idx] = updated
  localStore.writeTable(TABLE, rows)
  return formatCaucion(updated)
}

export async function remove(id) {
  const rows = localStore.readTable(TABLE)
  const next = rows.filter((r) => String(r.id) !== String(id))
  if (next.length === rows.length) throw new Error('Caución no encontrada')
  localStore.writeTable(TABLE, next)
}

export async function getSummary() {
  const rows = await getAll()
  const activas = rows.filter((r) => r.status === 'ACTIVA')
  const finalizadas = rows.filter((r) => r.status === 'FINALIZADA')

  const totalColocadoActivas = activas.reduce((acc, r) => acc + r.amount, 0)
  const gananciaNetaProyectada = activas.reduce((acc, r) => acc + r.netGain, 0)
  const gananciaNetaRealizada = finalizadas.reduce((acc, r) => acc + r.netGain, 0)
  const tnaNetaPromedioPonderada =
    totalColocadoActivas > 0
      ? activas.reduce((acc, r) => acc + r.netTNA * r.amount, 0) / totalColocadoActivas
      : 0

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
  }
}
