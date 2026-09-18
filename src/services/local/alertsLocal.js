// src/services/local/alertsLocal.js
// Misma lógica que backend/src/controllers/alerts.controller.js, contra
// localStorage en vez de SQLite/D1.

import { localStore } from '../localStore.js'

const TABLE = 'alerts'

function formatAlert(row) {
  return {
    id: row.id,
    ticker: row.ticker,
    type: row.type,
    price: row.price,
    triggered: !!row.triggered,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function sortRows(rows) {
  // ORDER BY created_at DESC, igual que el backend.
  return [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export async function getAll() {
  return sortRows(localStore.readTable(TABLE)).map(formatAlert)
}

export async function create({ ticker, type = 'IN', price = null }) {
  if (!ticker) throw new Error('ticker es requerido')
  if (!['IN', 'TARGET', 'STOP_LOSS'].includes(type)) {
    throw new Error("type debe ser 'IN', 'TARGET' o 'STOP_LOSS'")
  }

  const now = new Date().toISOString()
  const row = {
    id: localStore.nextId(TABLE),
    ticker: ticker.toUpperCase(),
    type,
    price,
    triggered: 0,
    created_at: now,
    updated_at: now,
  }

  const rows = localStore.readTable(TABLE)
  rows.push(row)
  localStore.writeTable(TABLE, rows)
  return formatAlert(row)
}

export async function update(id, body) {
  const rows = localStore.readTable(TABLE)
  const idx = rows.findIndex((r) => String(r.id) === String(id))
  if (idx === -1) throw new Error('Alerta no encontrada')
  const existing = rows[idx]

  const {
    ticker = existing.ticker,
    type = existing.type,
    price = existing.price,
    triggered = existing.triggered,
  } = body

  const updated = {
    ...existing,
    ticker: ticker.toUpperCase(),
    type,
    price,
    triggered: triggered ? 1 : 0,
    updated_at: new Date().toISOString(),
  }

  rows[idx] = updated
  localStore.writeTable(TABLE, rows)
  return formatAlert(updated)
}

export async function remove(id) {
  const rows = localStore.readTable(TABLE)
  const next = rows.filter((r) => String(r.id) !== String(id))
  if (next.length === rows.length) throw new Error('Alerta no encontrada')
  localStore.writeTable(TABLE, next)
}