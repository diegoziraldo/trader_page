// src/services/local/tradesLocal.js
//
// Misma lógica que backend/src/controllers/trades.controller.js (y su
// gemelo de Cloudflare en functions/_lib/trades.js), pero contra
// localStorage en vez de SQLite/D1. Los nombres de columnas internos
// (trade_date, asset_type, etc.) se mantienen iguales a la fila de la base
// de datos real, para que el resto de la lógica (formatTrade, computeSummary)
// sea un calco 1:1 y no se desincronice si el backend cambia.

import { localStore } from '../localStore.js'

const TABLE = 'trades'

function formatTrade(row) {
  return {
    id: row.id,
    date: row.trade_date,
    assetType: row.asset_type,
    ticker: row.ticker,
    operation: row.operation,
    quantity: row.quantity,
    price: row.price,
    fee: row.fee,
    notes: row.notes,
    total:
      row.operation === 'COMPRA'
        ? row.quantity * row.price + row.fee
        : row.quantity * row.price - row.fee,
    createdAt: row.created_at,
  }
}

function validateBody(body) {
  const errors = []
  if (!body.date) errors.push('date es requerido')
  if (!['CEDEAR', 'ACCION_AR'].includes(body.assetType)) errors.push('assetType inválido')
  if (!body.ticker || !String(body.ticker).trim()) errors.push('ticker es requerido')
  if (!['COMPRA', 'VENTA'].includes(body.operation)) errors.push('operation inválido')
  if (!(Number(body.quantity) > 0)) errors.push('quantity debe ser mayor a 0')
  if (!(Number(body.price) > 0)) errors.push('price debe ser mayor a 0')
  return errors
}

function sortRows(rows) {
  return [...rows].sort((a, b) => a.trade_date.localeCompare(b.trade_date) || a.id - b.id)
}

export async function getAll() {
  return sortRows(localStore.readTable(TABLE)).map(formatTrade)
}

export async function create(body) {
  const errors = validateBody(body)
  if (errors.length) throw new Error(errors.join(', '))

  const now = new Date().toISOString()
  const row = {
    id: localStore.nextId(TABLE),
    trade_date: body.date,
    asset_type: body.assetType,
    ticker: body.ticker.trim().toUpperCase(),
    operation: body.operation,
    quantity: Number(body.quantity),
    price: Number(body.price),
    fee: Number(body.fee) || 0,
    notes: body.notes || '',
    created_at: now,
    updated_at: now,
  }

  const rows = localStore.readTable(TABLE)
  rows.push(row)
  localStore.writeTable(TABLE, rows)
  return formatTrade(row)
}

export async function update(id, body) {
  const rows = localStore.readTable(TABLE)
  const idx = rows.findIndex((r) => String(r.id) === String(id))
  if (idx === -1) throw new Error('Trade no encontrado')
  const existing = rows[idx]

  const merged = {
    date: body.date ?? existing.trade_date,
    assetType: body.assetType ?? existing.asset_type,
    ticker: body.ticker ?? existing.ticker,
    operation: body.operation ?? existing.operation,
    quantity: body.quantity ?? existing.quantity,
    price: body.price ?? existing.price,
  }
  const errors = validateBody(merged)
  if (errors.length) throw new Error(errors.join(', '))

  const updated = {
    ...existing,
    trade_date: merged.date,
    asset_type: merged.assetType,
    ticker: String(merged.ticker).trim().toUpperCase(),
    operation: merged.operation,
    quantity: Number(merged.quantity),
    price: Number(merged.price),
    fee: body.fee !== undefined ? Number(body.fee) : existing.fee,
    notes: body.notes !== undefined ? body.notes : existing.notes,
    updated_at: new Date().toISOString(),
  }

  rows[idx] = updated
  localStore.writeTable(TABLE, rows)
  return formatTrade(updated)
}

export async function remove(id) {
  const rows = localStore.readTable(TABLE)
  const next = rows.filter((r) => String(r.id) !== String(id))
  if (next.length === rows.length) throw new Error('Trade no encontrado')
  localStore.writeTable(TABLE, next)
}

// Ganancias/pérdidas realizadas por costo promedio (PPC) — copiado tal cual
// del backend para que el resultado sea idéntico esté o no conectado.
function computeSummary(trades) {
  const bySymbol = {}

  for (const t of trades) {
    if (!bySymbol[t.ticker]) {
      bySymbol[t.ticker] = {
        ticker: t.ticker,
        assetType: t.assetType,
        quantity: 0,
        avgCost: 0,
        invested: 0,
        realizedPL: 0,
        totalBought: 0,
        totalSold: 0,
      }
    }
    const s = bySymbol[t.ticker]

    if (t.operation === 'COMPRA') {
      const costoPrevio = s.avgCost * s.quantity
      const nuevaCantidad = s.quantity + t.quantity
      const nuevoCosto = costoPrevio + t.quantity * t.price + t.fee
      s.avgCost = nuevaCantidad > 0 ? nuevoCosto / nuevaCantidad : 0
      s.quantity = nuevaCantidad
      s.invested = nuevoCosto
      s.totalBought += t.quantity * t.price + t.fee
    } else {
      const pl = t.quantity * (t.price - s.avgCost) - t.fee
      s.realizedPL += pl
      const cantidadRestante = s.quantity - t.quantity

      if (cantidadRestante <= 0.000001) {
        // La posición quedó completamente cerrada.
        // Se conserva realizedPL porque pertenece al histórico.
        s.quantity = 0
        s.avgCost = 0
        s.invested = 0
      } else {
        // Queda una posición abierta: solo se conserva el costo de las unidades restantes.
        s.quantity = cantidadRestante
        s.invested = s.avgCost * s.quantity
      }
      s.totalSold += t.quantity * t.price - t.fee
    }
  }

  const bySymbolList = Object.values(bySymbol).map((s) => ({
    ...s,
    quantity: Math.round(s.quantity * 1e6) / 1e6,
    avgCost: Math.round(s.avgCost * 100) / 100,
    invested: Math.round(s.invested * 100) / 100,
    realizedPL: Math.round(s.realizedPL * 100) / 100,
  }))

  const totals = {
    realizedPL: Math.round(bySymbolList.reduce((acc, s) => acc + s.realizedPL, 0) * 100) / 100,
    invested: Math.round(bySymbolList.reduce((acc, s) => acc + s.invested, 0) * 100) / 100,
    openPositions: bySymbolList.filter((s) => s.quantity > 0).length,
    totalTrades: trades.length,
  }

  return { bySymbol: bySymbolList, totals }
}

export async function getSummary() {
  const trades = await getAll()
  return computeSummary(trades)
}