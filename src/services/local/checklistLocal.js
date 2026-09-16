// src/services/local/checklistLocal.js
// Misma lógica que backend/src/controllers/checklist.controller.js, contra
// localStorage en vez de SQLite/D1. Se usan dos tablas, igual que en la
// base real: checklist_tickers y checklist_indicators (relacionadas por
// ticker_id), para poder borrar/editar indicadores sueltos.

import { localStore } from '../localStore.js'

const TICKERS_TABLE = 'checklist_tickers'
const INDICATORS_TABLE = 'checklist_indicators'

function formatIndicator(row) {
  return { id: row.id, text: row.text, weight: row.weight, checked: !!row.checked }
}

function getIndicatorsFor(tickerId, allIndicators) {
  return allIndicators
    .filter((i) => String(i.ticker_id) === String(tickerId))
    .sort((a, b) => a.position - b.position || a.id - b.id)
    .map(formatIndicator)
}

function formatTicker(row, allIndicators) {
  return {
    id: row.id,
    symbol: row.symbol,
    sector: row.sector,
    expanded: !!row.expanded,
    indicators: getIndicatorsFor(row.id, allIndicators),
  }
}

export async function getAll() {
  const tickers = localStore.readTable(TICKERS_TABLE)
  const indicators = localStore.readTable(INDICATORS_TABLE)
  return [...tickers].sort((a, b) => a.id - b.id).map((t) => formatTicker(t, indicators))
}

// { symbol, sector, indicators?: [{text, weight}] }
export async function create({ symbol, sector = 'General', indicators = [] }) {
  const cleanSymbol = (symbol || '').trim().toUpperCase()
  if (!cleanSymbol) throw new Error('symbol es requerido')

  const tickers = localStore.readTable(TICKERS_TABLE)
  const existing = tickers.find((t) => t.symbol === cleanSymbol)
  if (existing) {
    const allIndicators = localStore.readTable(INDICATORS_TABLE)
    return formatTicker(existing, allIndicators)
  }

  const now = new Date().toISOString()
  const newTicker = {
    id: localStore.nextId(TICKERS_TABLE),
    symbol: cleanSymbol,
    sector,
    expanded: 1,
    created_at: now,
    updated_at: now,
  }
  tickers.push(newTicker)
  localStore.writeTable(TICKERS_TABLE, tickers)

  const allIndicators = localStore.readTable(INDICATORS_TABLE)
  const list = Array.isArray(indicators) ? indicators : []
  list.forEach((ind, i) => {
    allIndicators.push({
      id: localStore.nextId(INDICATORS_TABLE),
      ticker_id: newTicker.id,
      text: ind.text,
      weight: ind.weight || 3,
      checked: 0,
      position: i,
      created_at: now,
    })
  })
  localStore.writeTable(INDICATORS_TABLE, allIndicators)

  return formatTicker(newTicker, allIndicators)
}

// { sector?, expanded?, indicators?: [{text, weight}] } — si viene
// "indicators" se reemplaza la lista completa, igual que en el backend.
export async function update(id, body) {
  const tickers = localStore.readTable(TICKERS_TABLE)
  const idx = tickers.findIndex((t) => String(t.id) === String(id))
  if (idx === -1) throw new Error('Ticker no encontrado')
  const existing = tickers[idx]

  const updated = {
    ...existing,
    sector: body.sector !== undefined ? body.sector : existing.sector,
    expanded: body.expanded !== undefined ? (body.expanded ? 1 : 0) : existing.expanded,
    updated_at: new Date().toISOString(),
  }
  tickers[idx] = updated
  localStore.writeTable(TICKERS_TABLE, tickers)

  let allIndicators = localStore.readTable(INDICATORS_TABLE)
  if (Array.isArray(body.indicators)) {
    allIndicators = allIndicators.filter((i) => String(i.ticker_id) !== String(id))
    const now = new Date().toISOString()
    body.indicators.forEach((ind, i) => {
      allIndicators.push({
        id: localStore.nextId(INDICATORS_TABLE),
        ticker_id: Number(id),
        text: ind.text,
        weight: ind.weight || 3,
        checked: 0,
        position: i,
        created_at: now,
      })
    })
    localStore.writeTable(INDICATORS_TABLE, allIndicators)
  }

  return formatTicker(updated, allIndicators)
}

export async function remove(id) {
  const tickers = localStore.readTable(TICKERS_TABLE)
  const next = tickers.filter((t) => String(t.id) !== String(id))
  if (next.length === tickers.length) throw new Error('Ticker no encontrado')
  localStore.writeTable(TICKERS_TABLE, next)

  // Sin FK reales en localStorage: borramos los indicadores a mano
  // (equivalente al ON DELETE CASCADE de la base real).
  const indicators = localStore.readTable(INDICATORS_TABLE)
  localStore.writeTable(
    INDICATORS_TABLE,
    indicators.filter((i) => String(i.ticker_id) !== String(id))
  )
}

// { text, weight }
export async function addIndicator(tickerId, { text, weight = 3 }) {
  const tickers = localStore.readTable(TICKERS_TABLE)
  if (!tickers.find((t) => String(t.id) === String(tickerId))) {
    throw new Error('Ticker no encontrado')
  }
  if (!text || !text.trim()) throw new Error('text es requerido')

  const indicators = localStore.readTable(INDICATORS_TABLE)
  const siblings = indicators.filter((i) => String(i.ticker_id) === String(tickerId))
  const maxPos = siblings.reduce((max, i) => Math.max(max, i.position), -1)

  const row = {
    id: localStore.nextId(INDICATORS_TABLE),
    ticker_id: Number(tickerId),
    text: text.trim(),
    weight,
    checked: 0,
    position: maxPos + 1,
    created_at: new Date().toISOString(),
  }
  indicators.push(row)
  localStore.writeTable(INDICATORS_TABLE, indicators)
  return formatIndicator(row)
}

// { text?, weight?, checked? }
export async function updateIndicator(id, body) {
  const indicators = localStore.readTable(INDICATORS_TABLE)
  const idx = indicators.findIndex((i) => String(i.id) === String(id))
  if (idx === -1) throw new Error('Indicador no encontrado')
  const existing = indicators[idx]

  const updated = {
    ...existing,
    text: body.text !== undefined ? body.text : existing.text,
    weight: body.weight !== undefined ? body.weight : existing.weight,
    checked: body.checked !== undefined ? (body.checked ? 1 : 0) : existing.checked,
  }
  indicators[idx] = updated
  localStore.writeTable(INDICATORS_TABLE, indicators)
  return formatIndicator(updated)
}

export async function removeIndicator(id) {
  const indicators = localStore.readTable(INDICATORS_TABLE)
  const next = indicators.filter((i) => String(i.id) !== String(id))
  if (next.length === indicators.length) throw new Error('Indicador no encontrado')
  localStore.writeTable(INDICATORS_TABLE, next)
}