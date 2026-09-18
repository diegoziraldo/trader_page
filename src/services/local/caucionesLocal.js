// src/services/local/caucionesLocal.js
//
// Misma lógica que backend/src/controllers/cauciones.controller.js (y su
// gemelo de Cloudflare en functions/_lib/cauciones.js), pero contra
// localStorage en vez de SQLite/D1.

import { localStore } from '../localStore.js'

const TABLE = 'cauciones'

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
  }
}

function validateBody(body) {
  const errors = []
  if (!body.fecha) errors.push('fecha es requerida')
  if (!(Number(body.importe) > 0)) errors.push('el importe debe ser mayor a 0')
  if (!(Number(body.tasa) > 0)) errors.push('la tasa debe ser mayor a 0')
  if (!(Number.isInteger(Number(body.dias)) && Number(body.dias) > 0)) {
    errors.push('los días deben ser un número entero mayor a 0')
  }
  if (!(Number(body.interes) >= 0)) errors.push('el interés cobrado no puede ser negativo')
  return errors
}

function sortRows(rows) {
  return [...rows].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id - b.id)
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
    fecha: body.fecha,
    importe: Number(body.importe),
    tasa: Number(body.tasa),
    dias: Number(body.dias),
    interes: Number(body.interes),
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
    fecha: body.fecha ?? existing.fecha,
    importe: body.importe ?? existing.importe,
    tasa: body.tasa ?? existing.tasa,
    dias: body.dias ?? existing.dias,
    interes: body.interes ?? existing.interes,
  }
  const errors = validateBody(merged)
  if (errors.length) throw new Error(errors.join(', '))

  const updated = {
    ...existing,
    fecha: merged.fecha,
    importe: Number(merged.importe),
    tasa: Number(merged.tasa),
    dias: Number(merged.dias),
    interes: Number(merged.interes),
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
  const totalInteres = Math.round(rows.reduce((acc, r) => acc + Number(r.interes || 0), 0) * 100) / 100
  const totalImporte = Math.round(rows.reduce((acc, r) => acc + Number(r.importe || 0), 0) * 100) / 100
  return { totalInteres, totalImporte, cantidad: rows.length }
}
