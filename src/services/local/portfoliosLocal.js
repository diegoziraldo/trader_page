// src/services/local/portfoliosLocal.js
//
// Misma lógica que backend/src/controllers/portfolios.controller.js (y su
// gemelo de Cloudflare en functions/_lib/portfolios.js), pero contra
// localStorage en vez de SQLite/D1.

import { localStore } from '../localStore.js'

const PORTFOLIOS_TABLE = 'portfolios'
const POSITIONS_TABLE = 'portfolio_positions'

const ASSET_TYPES = ['CEDEAR', 'ACCION_AR']

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

function formatPortfolio(row) {
  return {
    id: row.id,
    name: row.name,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function formatPosition(row) {
  const quantity = Number(row.quantity)
  const avgPrice = Number(row.avg_price)
  return {
    id: row.id,
    portfolioId: row.portfolio_id,
    assetType: row.asset_type,
    ticker: row.ticker,
    underlyingTicker: row.underlying_ticker || '',
    ratio: row.ratio != null ? Number(row.ratio) : null,
    sector: row.sector || 'General',
    quantity,
    avgPrice,
    invested: round2(quantity * avgPrice),
    targetWeight: row.target_weight != null ? Number(row.target_weight) : null,
    manualPrice: row.manual_price != null ? Number(row.manual_price) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function validatePortfolioBody(body) {
  const errors = []
  if (!body.name || !String(body.name).trim()) errors.push('name es requerido')
  return errors
}

function validatePositionBody(body) {
  const errors = []
  if (!ASSET_TYPES.includes(body.assetType)) errors.push('assetType inválido')
  if (!body.ticker || !String(body.ticker).trim()) errors.push('ticker es requerido')
  if (!(Number(body.quantity) > 0)) errors.push('quantity debe ser mayor a 0')
  if (!(Number(body.avgPrice) > 0)) errors.push('avgPrice debe ser mayor a 0')
  if (body.ratio !== undefined && body.ratio !== null && body.ratio !== '' && !(Number(body.ratio) > 0)) {
    errors.push('ratio debe ser mayor a 0 (o dejalo vacío)')
  }
  if (
    body.targetWeight !== undefined &&
    body.targetWeight !== null &&
    body.targetWeight !== '' &&
    (Number(body.targetWeight) < 0 || Number(body.targetWeight) > 100)
  ) {
    errors.push('targetWeight debe estar entre 0 y 100')
  }
  return errors
}

// ---------- Carteras ----------

export async function getAllPortfolios() {
  return localStore.readTable(PORTFOLIOS_TABLE).sort((a, b) => a.id - b.id).map(formatPortfolio)
}

export async function createPortfolio(body) {
  const errors = validatePortfolioBody(body)
  if (errors.length) throw new Error(errors.join(', '))

  const now = new Date().toISOString()
  const row = {
    id: localStore.nextId(PORTFOLIOS_TABLE),
    name: String(body.name).trim(),
    notes: body.notes || '',
    created_at: now,
    updated_at: now,
  }
  const rows = localStore.readTable(PORTFOLIOS_TABLE)
  rows.push(row)
  localStore.writeTable(PORTFOLIOS_TABLE, rows)
  return formatPortfolio(row)
}

export async function updatePortfolio(id, body) {
  const rows = localStore.readTable(PORTFOLIOS_TABLE)
  const idx = rows.findIndex((r) => String(r.id) === String(id))
  if (idx === -1) throw new Error('Cartera no encontrada')
  const existing = rows[idx]

  const name = body.name !== undefined ? String(body.name).trim() : existing.name
  if (!name) throw new Error('name es requerido')

  const updated = {
    ...existing,
    name,
    notes: body.notes !== undefined ? body.notes : existing.notes,
    updated_at: new Date().toISOString(),
  }
  rows[idx] = updated
  localStore.writeTable(PORTFOLIOS_TABLE, rows)
  return formatPortfolio(updated)
}

export async function removePortfolio(id) {
  const rows = localStore.readTable(PORTFOLIOS_TABLE)
  const next = rows.filter((r) => String(r.id) !== String(id))
  if (next.length === rows.length) throw new Error('Cartera no encontrada')
  localStore.writeTable(PORTFOLIOS_TABLE, next)

  // Al borrar la cartera, sus posiciones también (igual que ON DELETE
  // CASCADE en el schema real).
  const positions = localStore.readTable(POSITIONS_TABLE)
  const remainingPositions = positions.filter((p) => String(p.portfolio_id) !== String(id))
  localStore.writeTable(POSITIONS_TABLE, remainingPositions)
}

// ---------- Posiciones ----------

export async function getPositions(portfolioId) {
  return localStore
    .readTable(POSITIONS_TABLE)
    .filter((p) => String(p.portfolio_id) === String(portfolioId))
    .sort((a, b) => a.id - b.id)
    .map(formatPosition)
}

export async function createPosition(portfolioId, body) {
  const portfolios = localStore.readTable(PORTFOLIOS_TABLE)
  if (!portfolios.some((p) => String(p.id) === String(portfolioId))) {
    throw new Error('Cartera no encontrada')
  }

  const errors = validatePositionBody(body)
  if (errors.length) throw new Error(errors.join(', '))

  const now = new Date().toISOString()
  const row = {
    id: localStore.nextId(POSITIONS_TABLE),
    portfolio_id: portfolioId,
    asset_type: body.assetType,
    ticker: String(body.ticker).trim().toUpperCase(),
    underlying_ticker: body.underlyingTicker ? String(body.underlyingTicker).trim().toUpperCase() : '',
    ratio: body.ratio !== undefined && body.ratio !== null && body.ratio !== '' ? Number(body.ratio) : null,
    sector: body.sector && String(body.sector).trim() ? String(body.sector).trim() : 'General',
    quantity: Number(body.quantity),
    avg_price: Number(body.avgPrice),
    target_weight:
      body.targetWeight !== undefined && body.targetWeight !== null && body.targetWeight !== ''
        ? Number(body.targetWeight)
        : null,
    manual_price:
      body.manualPrice !== undefined && body.manualPrice !== null && body.manualPrice !== ''
        ? Number(body.manualPrice)
        : null,
    created_at: now,
    updated_at: now,
  }

  const rows = localStore.readTable(POSITIONS_TABLE)
  rows.push(row)
  localStore.writeTable(POSITIONS_TABLE, rows)
  return formatPosition(row)
}

export async function updatePosition(id, body) {
  const rows = localStore.readTable(POSITIONS_TABLE)
  const idx = rows.findIndex((r) => String(r.id) === String(id))
  if (idx === -1) throw new Error('Posición no encontrada')
  const existing = rows[idx]

  const merged = {
    assetType: body.assetType ?? existing.asset_type,
    ticker: body.ticker ?? existing.ticker,
    quantity: body.quantity ?? existing.quantity,
    avgPrice: body.avgPrice ?? existing.avg_price,
  }
  const errors = validatePositionBody(merged)
  if (errors.length) throw new Error(errors.join(', '))

  const updated = {
    ...existing,
    asset_type: merged.assetType,
    ticker: String(merged.ticker).trim().toUpperCase(),
    underlying_ticker:
      body.underlyingTicker !== undefined
        ? String(body.underlyingTicker).trim().toUpperCase()
        : existing.underlying_ticker,
    ratio:
      body.ratio !== undefined ? (body.ratio === '' || body.ratio === null ? null : Number(body.ratio)) : existing.ratio,
    sector: body.sector !== undefined ? String(body.sector).trim() || 'General' : existing.sector,
    quantity: Number(merged.quantity),
    avg_price: Number(merged.avgPrice),
    target_weight:
      body.targetWeight !== undefined
        ? body.targetWeight === '' || body.targetWeight === null
          ? null
          : Number(body.targetWeight)
        : existing.target_weight,
    manual_price:
      body.manualPrice !== undefined
        ? body.manualPrice === '' || body.manualPrice === null
          ? null
          : Number(body.manualPrice)
        : existing.manual_price,
    updated_at: new Date().toISOString(),
  }

  rows[idx] = updated
  localStore.writeTable(POSITIONS_TABLE, rows)
  return formatPosition(updated)
}

export async function removePosition(id) {
  const rows = localStore.readTable(POSITIONS_TABLE)
  const next = rows.filter((r) => String(r.id) !== String(id))
  if (next.length === rows.length) throw new Error('Posición no encontrada')
  localStore.writeTable(POSITIONS_TABLE, next)
}
