// src/services/local/watchlistLocal.js
// Misma lógica que backend/src/controllers/watchlist.controller.js, contra
// localStorage en vez de SQLite/D1. Incluye la misma siembra por defecto
// que trae schema.sql, para que el panel "Acciones USA" no arranque vacío.

import { localStore } from '../localStore.js'

const TABLE = 'watchlist_us'

const DEFAULTS = [
  ['AAPL', 'Apple'],
  ['MSFT', 'Microsoft'],
  ['TSLA', 'Tesla'],
  ['NVDA', 'NVIDIA'],
  ['AMZN', 'Amazon'],
  ['GOOGL', 'Alphabet'],
]

function ensureSeeded() {
  if (localStore.wasSeeded(TABLE)) return
  const rows = localStore.readTable(TABLE)
  if (rows.length === 0) {
    const now = new Date().toISOString()
    DEFAULTS.forEach(([symbol, name], i) => {
      rows.push({ id: localStore.nextId(TABLE), symbol, name, position: i, created_at: now })
    })
    localStore.writeTable(TABLE, rows)
  }
  localStore.markSeeded(TABLE)
}

function sortRows(rows) {
  return [...rows].sort((a, b) => a.position - b.position || a.id - b.id)
}

export async function getAll() {
  ensureSeeded()
  return sortRows(localStore.readTable(TABLE))
}

// { symbol, name? }
export async function create({ symbol, name = 'Personalizado' }) {
  ensureSeeded()
  const cleanSymbol = (symbol || '').trim().toUpperCase()
  if (!cleanSymbol) throw new Error('symbol es requerido')

  const rows = localStore.readTable(TABLE)
  const existing = rows.find((r) => r.symbol === cleanSymbol)
  if (existing) return existing // ya está: no es error, se devuelve tal cual

  const maxPos = rows.reduce((max, r) => Math.max(max, r.position), -1)
  const row = {
    id: localStore.nextId(TABLE),
    symbol: cleanSymbol,
    name,
    position: maxPos + 1,
    created_at: new Date().toISOString(),
  }
  rows.push(row)
  localStore.writeTable(TABLE, rows)
  return row
}

export async function remove(symbol) {
  ensureSeeded()
  const clean = symbol.toUpperCase()
  const rows = localStore.readTable(TABLE)
  const next = rows.filter((r) => r.symbol !== clean)
  if (next.length === rows.length) throw new Error('Ticker no encontrado')
  localStore.writeTable(TABLE, next)
}
