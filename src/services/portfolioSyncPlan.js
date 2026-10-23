// src/services/portfolioSyncPlan.js
//
// Lógica pura para reflejar "Mis Trades" en las posiciones de una cartera.
// La usan tanto el botón "Sincronizar con Mis Trades" (PortfolioBuilder,
// sincronización completa) como el guardado/edición/borrado de un trade con
// cartera asignada (TradesModal, sincronización acotada a ese ticker).
//
// Está separada del acceso a datos (planSync es una función pura; runSync
// recibe las funciones de lectura/escritura por parámetro) para poder
// probarla sin navegador ni base de datos real.
//
// Una sola fuente de verdad: las cantidades y el costo salen del MISMO motor
// que usa la trazabilidad por lotes (lotTracking.js), que a su vez replica la
// fórmula de "Posiciones abiertas". Antes esta sincronización calculaba su
// propio promedio (de todas las compras históricas, sin comisiones y sin
// descontar lo ya vendido), y la cartera mostraba un costo distinto al PPC.
//
// Reglas:
//  - Cantidad = lo que sigue abierto en esa cartera (compras − ventas, nunca
//    negativa). Precio promedio = costo promedio móvil (PPC) con comisiones:
//    las compras lo recalculan, las ventas reducen la cantidad pero no lo
//    mueven. Fecha de alta de la posición = fecha de la primera compra (para
//    que el gráfico de evolución arranque ahí, no desde hoy).
//  - Sector: el del trade más reciente que lo tenga cargado (distinto de
//    "General"); si ninguno, el del catálogo (argentinePortfolioAssets.js);
//    si tampoco, "General".
//  - Qué trades cuentan para una cartera: SOLO los asignados explícitamente
//    a ella (portfolioId === portfolioId). Los trades sin cartera asignada
//    no entran a ninguna cartera automáticamente — hay que editarlos y
//    elegirles una cartera para que empiecen a contar. Esto es a propósito:
//    si un ticker (ej. AAPL) tiene compras repartidas entre varias carteras
//    y además compras viejas sin cartera, cada cartera tiene que mostrar
//    SOLO lo que es suyo, nunca el total sumado de todas.
//  - Cantidad > 0: crea la posición si no existe, o la actualiza SOLO si algo
//    realmente cambió (cantidad, precio promedio, o sector/ratio si faltaban).
//    Cantidad 0 y la posición existe: se borra (vendida por completo).
//  - Con `tickers` (sincronización acotada, al guardar/editar/borrar un
//    trade puntual) solo se revisan esos tickers; si alguno ya no tiene
//    ningún trade y tenía posición, la posición se borra (caso: borraste
//    su único trade).

import { PORTFOLIO_ASSET_BY_TICKER } from '../data/argentinePortfolioAssets.js'
import { buildLotLedger } from './lotTracking.js'

// Lo que "debería" tener cada ticker de una cartera según sus trades: es la
// misma cuenta que usa planSync y que usa el control de datos para detectar
// posiciones desfasadas.
export function expectedPositions(allTrades, portfolioId, tickers = null) {
  const scoped = Array.isArray(tickers)
  const relevant = allTrades.filter((t) => {
    if (scoped && !tickers.includes(t.ticker)) return false
    return t.portfolioId != null && String(t.portfolioId) === String(portfolioId)
  })

  const sectorByTicker = {}
  for (const t of [...relevant].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) {
    if (t.sector && t.sector !== 'General') sectorByTicker[t.ticker] = t.sector
  }

  const ledger = buildLotLedger(relevant)
  const out = {}
  for (const [ticker, L] of Object.entries(ledger.byTicker)) {
    out[ticker] = {
      ticker,
      assetType: L.assetType,
      qty: L.open.qty,
      avgCost: L.ppp.avgCost,
      firstBuyDate: L.lots[0]?.date ?? null,
      sector: sectorByTicker[ticker] || null,
      hasBuys: L.lots.length > 0,
    }
  }
  return out
}

export function planSync(allTrades, positions, portfolioId, opts = {}) {
  const { tickers = null } = opts
  const scoped = Array.isArray(tickers)
  const expected = expectedPositions(allTrades, portfolioId, tickers)
  const existingByTicker = new Map(positions.map((p) => [p.ticker, p]))
  const actions = []

  for (const [ticker, data] of Object.entries(expected)) {
    const existing = existingByTicker.get(ticker)
    const catalogAsset = PORTFOLIO_ASSET_BY_TICKER[ticker]
    const knownSector = data.sector || catalogAsset?.sector || null

    if (existing) {
      if (data.qty > 0) {
        const payload = {}
        if (Math.abs(Number(existing.quantity) - data.qty) > 1e-9) payload.quantity = data.qty
        if (Math.abs(Number(existing.avgPrice) - data.avgCost) > 1e-6) payload.avgPrice = data.avgCost
        if (existing.sector === 'General' && knownSector) payload.sector = knownSector
        // Completa ratio/subyacente si la posición no los tenía cargados
        // (ej. se creó antes de que el catálogo tuviera este ticker).
        if (existing.assetType === 'CEDEAR' && existing.ratio == null && catalogAsset?.ratio != null) {
          payload.ratio = catalogAsset.ratio
        }
        if (existing.assetType === 'CEDEAR' && !existing.underlyingTicker && catalogAsset) {
          payload.underlyingTicker = catalogAsset.ticker
        }
        if (Object.keys(payload).length) actions.push({ type: 'update', id: existing.id, ticker, payload })
      } else {
        actions.push({ type: 'delete', id: existing.id, ticker })
      }
      continue
    }

    if (!(data.qty > 0) || !data.hasBuys) {
      actions.push({ type: 'skip', ticker })
      continue
    }

    actions.push({
      type: 'create',
      ticker,
      payload: {
        assetType: data.assetType,
        ticker,
        quantity: data.qty,
        avgPrice: data.avgCost,
        createdAt: data.firstBuyDate,
        sector: knownSector || undefined,
        // Ratio y subyacente: solo tienen sentido para CEDEARs, y solo si
        // el catálogo los tiene cargados (igual criterio que el sector: si
        // no hay match, quedan sin cargar y se completan a mano).
        ratio: data.assetType === 'CEDEAR' ? catalogAsset?.ratio ?? undefined : undefined,
        underlyingTicker: data.assetType === 'CEDEAR' ? catalogAsset?.ticker ?? undefined : undefined,
      },
    })
  }

  // Ticker acotado que ya no tiene ningún trade relevante pero tenía
  // posición (ej. borraste el único trade de ese ticker en esta cartera).
  if (scoped) {
    for (const ticker of tickers) {
      if (expected[ticker]) continue
      const existing = existingByTicker.get(ticker)
      if (existing) actions.push({ type: 'delete', id: existing.id, ticker })
    }
  }

  return actions
}

// deps: { getTrades, getPositions, createPosition, updatePosition, deletePosition }
// opts: { tickers?: string[], trades?: Trade[] }
//   (trades: pasala si ya la tenés a mano, para no volver a pedirla)
export async function runSync(deps, portfolioId, opts = {}) {
  const allTrades = opts.trades ?? (await deps.getTrades())
  const positions = await deps.getPositions(portfolioId)
  const actions = planSync(allTrades, positions, portfolioId, opts)

  const summary = { created: 0, updated: 0, removed: 0, skippedClosed: 0 }
  for (const a of actions) {
    if (a.type === 'create') {
      await deps.createPosition(portfolioId, a.payload)
      summary.created++
    } else if (a.type === 'update') {
      await deps.updatePosition(a.id, a.payload)
      summary.updated++
    } else if (a.type === 'delete') {
      await deps.deletePosition(a.id)
      summary.removed++
    } else if (a.type === 'skip') {
      summary.skippedClosed++
    }
  }
  summary.changed = summary.created + summary.updated + summary.removed > 0
  return summary
}
