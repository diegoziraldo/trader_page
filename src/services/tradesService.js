// Persistencia de trades. API/DB como fuente primaria y localStorage como
// respaldo cuando no hay backend disponible.

import { ApiUnavailableError, deleteJson, getJson, postJson, putJson } from './apiClient'
import {
  cacheTrades,
  isLocalId,
  localCreateTrade,
  localDeleteTrade,
  localGetTrades,
  localGetTradesSummary,
  localUpdateTrade,
} from './localStorageDb'

function hasUnsyncedTrades() {
  return localGetTrades().some((trade) => isLocalId(trade.id))
}

export async function getTrades() {
  try {
    const rows = await getJson('/trades')
    cacheTrades(rows)
    return localGetTrades()
  } catch (error) {
    if (error instanceof ApiUnavailableError) return localGetTrades()
    throw error
  }
}

export async function getTradesSummary() {
  try {
    const summary = await getJson('/trades/summary')
    if (hasUnsyncedTrades()) return localGetTradesSummary()
    return summary
  } catch (error) {
    if (error instanceof ApiUnavailableError) return localGetTradesSummary()
    throw error
  }
}

export async function createTrade(data) {
  try {
    const created = await postJson('/trades', data)
    cacheTrades([created, ...localGetTrades().filter((row) => String(row.id) !== String(created.id))])
    return created
  } catch (error) {
    if (error instanceof ApiUnavailableError) return localCreateTrade(data)
    throw error
  }
}

export async function updateTrade(id, data) {
  if (isLocalId(id)) return localUpdateTrade(id, data)
  try {
    const updated = await putJson(`/trades/${encodeURIComponent(id)}`, data)
    cacheTrades([updated, ...localGetTrades().filter((row) => String(row.id) !== String(updated.id))])
    return updated
  } catch (error) {
    if (error instanceof ApiUnavailableError) return localUpdateTrade(id, data)
    throw error
  }
}

export async function deleteTrade(id) {
  if (isLocalId(id)) return localDeleteTrade(id)
  try {
    await deleteJson(`/trades/${encodeURIComponent(id)}`)
    try {
      localDeleteTrade(id)
    } catch {
      // No había copia local: la eliminación remota ya fue exitosa.
    }
  } catch (error) {
    if (error instanceof ApiUnavailableError) return localDeleteTrade(id)
    throw error
  }
}
