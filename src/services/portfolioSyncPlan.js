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
// Reglas:
//  - Tenencia neta de un ticker = COMPRAs - VENTAs. Precio promedio =
//    promedio ponderado de las compras. Fecha de alta de la posición =
//    fecha de la primera compra (para que el gráfico de evolución arranque
//    ahí, no desde hoy).
//  - Sector: el del trade más reciente que lo tenga cargado (distinto de
//    "General"); si ninguno, el del catálogo (argentinePortfolioAssets.js);
//    si tampoco, "General".
//  - Qué trades cuentan para una cartera: los asignados explícitamente a
//    ella, más los SIN cartera asignada (trades viejos, de antes de que
//    existiera este campo) — pero estos últimos solo si `includeAllUnassigned`
//    es true, o si esa cartera ya tiene una posición de ese ticker. Así:
//      · el botón manual "Sincronizar" (includeAllUnassigned: true) sí trae
//        todo lo viejo sin cartera, como pediste.
//      · el auto-sync al guardar UN trade nuevo con cartera asignada no
//        contamina una cartera distinta ni una recién creada con trades
//        viejos de otros tickers que nunca tuvo.
//  - Tenencia neta > 0: crea la posición si no existe, o la actualiza SOLO
//    si algo realmente cambió (cantidad, precio promedio, o sector si
//    estaba en "General"). Tenencia neta <= 0 y la posición existe: se
//    borra (vendida por completo).
//  - Con `tickers` (sincronización acotada, al guardar/editar/borrar un
//    trade puntual) solo se revisan esos tickers; si alguno ya no tiene
//    ningún trade y tenía posición, la posición se borra (caso: borraste
//    su único trade).

import { PORTFOLIO_ASSET_BY_TICKER } from '../data/argentinePortfolioAssets.js'

export function planSync(allTrades, positions, portfolioId, opts = {}) {
  const { tickers = null, includeAllUnassigned = false } = opts
  const scoped = Array.isArray(tickers)
  const heldTickers = new Set(positions.map((p) => p.ticker))

  const relevant = allTrades.filter((t) => {
    if (scoped && !tickers.includes(t.ticker)) return false
    if (t.portfolioId != null) return String(t.portfolioId) === String(portfolioId)
    return includeAllUnassigned || heldTickers.has(t.ticker)
  })

  const byTicker = {}
  for (const t of relevant) {
    if (!byTicker[t.ticker]) byTicker[t.ticker] = { assetType: t.assetType, buys: [], netQty: 0, sector: null }
    const entry = byTicker[t.ticker]
    if (t.sector && t.sector !== 'General') entry.sector = t.sector
    const qty = Number(t.quantity)
    if (t.operation === 'COMPRA') {
      entry.buys.push({ date: t.date, qty, price: Number(t.price) })
      entry.netQty += qty
    } else {
      entry.netQty -= qty
    }
  }

  const existingByTicker = new Map(positions.map((p) => [p.ticker, p]))
  const actions = []

  for (const [ticker, data] of Object.entries(byTicker)) {
    const existing = existingByTicker.get(ticker)
    const totalCost = data.buys.reduce((acc, b) => acc + b.qty * b.price, 0)
    const totalQtyBought = data.buys.reduce((acc, b) => acc + b.qty, 0)
    const avgPrice = totalQtyBought > 0 ? totalCost / totalQtyBought : null
    const knownSector = data.sector || PORTFOLIO_ASSET_BY_TICKER[ticker]?.sector || null

    if (existing) {
      if (data.netQty > 0) {
        const payload = {}
        if (Math.abs(Number(existing.quantity) - data.netQty) > 1e-9) payload.quantity = data.netQty
        if (avgPrice != null && Math.abs(Number(existing.avgPrice) - avgPrice) > 1e-6) payload.avgPrice = avgPrice
        if (existing.sector === 'General' && knownSector) payload.sector = knownSector
        // Completa ratio/subyacente si la posición no los tenía cargados
        // (ej. se creó antes de que el catálogo tuviera este ticker).
        const catalogAsset = PORTFOLIO_ASSET_BY_TICKER[ticker]
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

    if (!(data.netQty > 0) || !data.buys.length) {
      actions.push({ type: 'skip', ticker })
      continue
    }

    const earliestBuyDate = data.buys.reduce((min, b) => (b.date < min ? b.date : min), data.buys[0].date)
    const catalogAsset = PORTFOLIO_ASSET_BY_TICKER[ticker]
    actions.push({
      type: 'create',
      ticker,
      payload: {
        assetType: data.assetType,
        ticker,
        quantity: data.netQty,
        avgPrice,
        createdAt: earliestBuyDate,
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
      if (byTicker[ticker]) continue
      const existing = existingByTicker.get(ticker)
      if (existing) actions.push({ type: 'delete', id: existing.id, ticker })
    }
  }

  return actions
}

// deps: { getTrades, getPositions, createPosition, updatePosition, deletePosition }
// opts: { tickers?: string[], includeAllUnassigned?: boolean, trades?: Trade[] }
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
