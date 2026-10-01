// src/services/portfolioSyncService.js
// Conecta la lógica pura de sincronización (portfolioSyncPlan.js) con los
// servicios reales de trades y carteras (base de datos o fallback local).

import { getTrades } from './tradesService.js'
import { getPositions, createPosition, updatePosition, deletePosition } from './portfoliosService.js'
import { runSync } from './portfolioSyncPlan.js'

const deps = { getTrades, getPositions, createPosition, updatePosition, deletePosition }

// Refleja "Mis Trades" en las posiciones de la cartera `portfolioId`,
// usando SOLO los trades asignados explícitamente a esa cartera.
// opts.tickers: sincronización acotada a esos tickers (más rápida; la usa
//   TradesModal al guardar/editar/borrar un trade puntual).
// opts.trades: lista de trades ya obtenida, para no volver a pedirla.
export function syncPortfolioFromTrades(portfolioId, opts = {}) {
  return runSync(deps, portfolioId, opts)
}
