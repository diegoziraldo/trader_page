// Persistencia de la watchlist USA. API/DB como fuente primaria y
// localStorage como respaldo cuando no hay backend disponible.

import { ApiUnavailableError, deleteJson, getJson, postJson } from './apiClient'
import {
  cacheWatchlist,
  hasLocalOnlyWatchlistSymbol,
  localAddWatchlist,
  localGetWatchlist,
  localRemoveWatchlist,
} from './localStorageDb'

export async function getUsWatchlist() {
  try {
    const rows = await getJson('/watchlist/us')
    cacheWatchlist(rows)
    return localGetWatchlist()
  } catch (error) {
    if (error instanceof ApiUnavailableError) return localGetWatchlist()
    throw error
  }
}

export async function addUsWatchlistTicker(data) {
  try {
    const saved = await postJson('/watchlist/us', data)
    cacheWatchlist([saved, ...localGetWatchlist().filter((row) => row.symbol !== saved.symbol)])
    return saved
  } catch (error) {
    if (error instanceof ApiUnavailableError) return localAddWatchlist(data)
    throw error
  }
}

export async function removeUsWatchlistTicker(symbol) {
  if (hasLocalOnlyWatchlistSymbol(symbol)) return localRemoveWatchlist(symbol)
  try {
    await deleteJson(`/watchlist/us/${encodeURIComponent(symbol)}`)
    try {
      localRemoveWatchlist(symbol)
    } catch {
      // No había copia local: la eliminación remota ya fue exitosa.
    }
  } catch (error) {
    if (error instanceof ApiUnavailableError) return localRemoveWatchlist(symbol)
    throw error
  }
}
