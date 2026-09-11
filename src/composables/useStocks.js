import { ref, onMounted, onUnmounted } from 'vue'
import { fetchQuote, getTheoreticalCedear } from '../services/stockService'
import { getUsWatchlist, addUsWatchlistTicker, removeUsWatchlistTicker } from '../services/watchlistService'

// Cada cuánto se refresca automáticamente toda la watchlist
const REFRESH_MS = 20_000 // 20 segundos

/**
 * Watchlist de acciones de EE.UU. (NYSE/NASDAQ), con precio real de Finnhub.
 * La lista de símbolos vive en el backend (tabla watchlist_us); acá solo se
 * le suma el precio en vivo que viene de Finnhub.
 */
export function useUsStocks() {
  const stocks = ref([])

  let intervalId = null

  // Trae la lista guardada en el backend al arrancar
  async function loadFromBackend() {
    try {
      const remote = await getUsWatchlist()
      stocks.value = remote.map(r => ({
        symbol: r.symbol, name: r.name, price: null, changePercent: null, loading: true, error: null,
      }))
    } catch (e) {
      console.error('No se pudo cargar la watchlist de USA', e)
      stocks.value = []
    }
  }

  async function refreshOne(stock) {
    stock.loading = true
    stock.error = null
    try {
      const q = await fetchQuote(stock.symbol)
      stock.price = q.price
      stock.changePercent = q.changePercent
    } catch (e) {
      stock.error = e.message
    } finally {
      stock.loading = false
    }
  }

  async function refreshAll() {
    await Promise.all(stocks.value.map(refreshOne))
  }

  async function addTicker(symbol) {
    symbol = symbol.trim().toUpperCase()
    if (!symbol || stocks.value.some(s => s.symbol === symbol)) return
    const stock = { symbol, name: 'Personalizado', price: null, changePercent: null, loading: true, error: null }
    stocks.value.unshift(stock)
    refreshOne(stock)
    try {
      const saved = await addUsWatchlistTicker({ symbol })
      stock.name = saved.name
    } catch (e) {
      console.error('Error guardando el ticker en el backend', e)
    }
  }

  async function removeTicker(symbol) {
    stocks.value = stocks.value.filter(s => s.symbol !== symbol)
    try {
      await removeUsWatchlistTicker(symbol)
    } catch (e) {
      console.error('Error eliminando el ticker en el backend', e)
    }
  }

  // Primero trae la lista del backend, recién ahí pide los precios en vivo
  // a Finnhub. Después repite el refresh de precios cada REFRESH_MS.
  onMounted(async () => {
    await loadFromBackend()
    refreshAll()
    intervalId = setInterval(refreshAll, REFRESH_MS)
  })

  onUnmounted(() => {
    if (intervalId) clearInterval(intervalId)
  })

  return { stocks, refreshAll, addTicker, removeTicker }
}

/**
 * Watchlist de CEDEARs (BYMA). El precio no viene de Finnhub (no cubre BYMA
 * en el plan gratis): se calcula en vivo como (precio USD ÷ ratio) × CCL.
 * @param {Array<{symbol:string, underlyingSymbol:string, ratio:number, name:string}>} initialList
 * @param {import('vue').Ref<number>} cclRateRef ref reactivo con la cotización actual del CCL
 */
export function useCedears(initialList, cclRateRef) {
  const stocks = ref(
    initialList.map(s => ({ ...s, usdPrice: null, price: null, changePercent: null, loading: true, error: null }))
  )

  let intervalId = null

  async function refreshOne(stock) {
    stock.loading = true
    stock.error = null
    try {
      const q = await fetchQuote(stock.underlyingSymbol)
      stock.usdPrice = q.price
      stock.changePercent = q.changePercent
      stock.price = getTheoreticalCedear(q.price, stock.ratio, cclRateRef.value)
    } catch (e) {
      stock.error = e.message
    } finally {
      stock.loading = false
    }
  }

  async function refreshAll() {
    await Promise.all(stocks.value.map(refreshOne))
  }

  /** Recalcula todos los precios teóricos cuando cambia el CCL, sin re-pedir a Finnhub. */
  function recalcAll() {
    stocks.value.forEach(stock => {
      if (stock.usdPrice) stock.price = getTheoreticalCedear(stock.usdPrice, stock.ratio, cclRateRef.value)
    })
  }

  function updateRatio(symbol, ratio) {
    const stock = stocks.value.find(s => s.symbol === symbol)
    if (!stock) return
    stock.ratio = Number(ratio) || stock.ratio
    if (stock.usdPrice) stock.price = getTheoreticalCedear(stock.usdPrice, stock.ratio, cclRateRef.value)
  }

  function addTicker(underlyingSymbol, ratio = 20) {
    underlyingSymbol = underlyingSymbol.trim().toUpperCase()
    if (!underlyingSymbol) return
    const symbol = underlyingSymbol + '.BA'
    if (stocks.value.some(s => s.symbol === symbol)) return
    const stock = {
      symbol, underlyingSymbol, ratio, name: 'Personalizado',
      usdPrice: null, price: null, changePercent: null, loading: true, error: null,
    }
    stocks.value.unshift(stock)
    refreshOne(stock)
    // TODO (fase 2): POST /api/watchlist { symbol, underlyingSymbol, ratio, type: 'cedear' }
  }

  function removeTicker(symbol) {
    stocks.value = stocks.value.filter(s => s.symbol !== symbol)
    // TODO (fase 2): DELETE /api/watchlist/:id
  }

  // Igual que en useUsStocks: sin esto, la lista inicial de CEDEARs nunca
  // pedía su primer precio y quedaba con price: null.
  onMounted(() => {
    refreshAll()
    intervalId = setInterval(refreshAll, REFRESH_MS)
  })

  onUnmounted(() => {
    if (intervalId) clearInterval(intervalId)
  })

  return { stocks, refreshAll, addTicker, removeTicker, updateRatio, recalcAll }
}