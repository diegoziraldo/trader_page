<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, watch } from 'vue'
import {
  getTrades,
  getTradesSummary,
  createTrade,
  updateTrade,
  deleteTrade,
} from '../services/tradesService'

const emit = defineEmits(['close'])

// =========================================================
// CONFIGURACIÓN — mismas fuentes públicas que usa CclCalculator.vue
// =========================================================
const DOLARAPI_LIST_URL = 'https://dolarapi.com/v1/dolares'
const CCL_REFRESH_MS = 60_000
const CEDEARS_LIVE_URL = 'https://data912.com/live/arg_cedears'
const CEDEARS_REFRESH_MS = 30_000
// --- Precio en vivo de acciones del panel argentino (BYMA), misma fuente
// que ya usamos para CEDEARs. Antes esto no se cargaba y por eso las
// "Acciones argentinas" nunca mostraban precio actual. ---
const ARG_STOCKS_LIVE_URL = 'https://data912.com/live/arg_stocks'
const ARG_STOCKS_REFRESH_MS = 30_000
// api.argentinadatos.com expone el CCL histórico día por día, así no hay
// que tipearlo a mano para operaciones viejas.
const HISTORICAL_CCL_BASE = 'https://api.argentinadatos.com/v1/cotizaciones/dolares/contadoconliqui'
// Timeout defensivo para no dejar el spinner colgado si alguna de estas
// fuentes públicas queda lenta o deja de responder.
const FETCH_TIMEOUT_MS = 10_000

// --- Precio en USD de la acción subyacente (mismo host que ya usamos para
// CEDEARs, así evitamos depender de un tercero nuevo para esto) ---
const USA_STOCKS_LIVE_URL = 'https://data912.com/live/usa_stocks'
const USA_ADRS_LIVE_URL = 'https://data912.com/live/usa_adrs'
const USA_PRICES_REFRESH_MS = 60_000

// --- Ratio CEDEAR / acción subyacente (cuántos CEDEARs equivalen a 1 ---
// acción). Fuente pública, best-effort: si no está disponible o quedó
// desactualizada, el usuario la corrige a mano y el cálculo se ajusta solo.
const CEDEAR_RATIOS_URL = 'https://ferminrp.github.io/google-sheets-argento/api/cedears.json'

const trades = ref([])
const summary = ref({
  bySymbol: [],
  totals: {
    realizedPL: 0, realizedPLUSD: 0, invested: 0, investedUSD: 0,
    openPositions: 0, totalTrades: 0,
  },
})
const loading = ref(true)
const errorMsg = ref('')
const saving = ref(false)

const editingId = ref(null) // null = modo "agregar", si no, id del trade en edición
const viewMode = ref('form') // 'form' = cargar/editar, 'list' = ver todo el detalle

// --- Dólar CCL en vivo (para "hoy" y para valuar posiciones abiertas) ---
const cclActual = ref(null)
let intervaloCclActual = null

// --- Precios de CEDEARs en vivo (data912) ---
const liveCedears = ref([])
let intervaloCedears = null

// --- Precios de acciones argentinas en vivo (data912) ---
const liveArgStocks = ref([])
const argStocksError = ref('')
let intervaloArgStocks = null

// --- Precio en USD de la acción subyacente (data912) ---
const usaPrices = ref({}) // { TICKER: precioUSD }
let intervaloUsaPrices = null

// --- Ratio CEDEAR/acción. cedearRatiosAuto[ticker] === false significa que
// el usuario lo corrigió a mano y no debe pisarse con el autocompletado. ---
const cedearRatios = ref({})     // { TICKER: ratio numérico }
const cedearRatiosAuto = reactive({}) // { TICKER: true | false }

// --- Tablas de resumen: búsqueda + orden por columna, con scroll interno y ---
// header sticky (patrón de terminal de trading) en vez de esconder toda la
// sección. Así, aunque se carguen muchos tickers, la tabla no "se come" la
// pantalla: se desplaza puertas adentro y el encabezado queda fijo.
const openPositionsSearch = ref('')
const bySymbolSearch = ref('')
const openPositionsSort = reactive({ key: null, dir: 'desc' })
const bySymbolSort = reactive({ key: null, dir: 'desc' })

// =========================================================
// UTILIDAD: fetch con timeout + validación básica de la respuesta
// =========================================================
// Todas las fuentes de datos que usa este componente son APIs públicas de
// terceros, sin SLA garantizado. Este helper evita que una request colgada
// deje el spinner girando para siempre, y centraliza el chequeo de
// "respuesta OK + JSON parseable" para no repetirlo en cada función.
async function fetchJson(url, { timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) {
      throw new Error(`${url} respondió ${res.status}`)
    }
    return await res.json()
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error(`Tiempo de espera agotado consultando ${url}`)
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
}

// Valida y normaliza un panel "live" de data912 (array de { symbol, c, ... })
// a un mapa { TICKER: precioNumerico > 0 }, descartando cualquier entrada
// mal formada en lugar de romper toda la carga por un solo item corrupto.
function normalizeLivePanel(list) {
  const map = {}
  if (!Array.isArray(list)) return map
  for (const item of list) {
    const symbol = String(item?.symbol ?? '').trim().toUpperCase()
    const price = Number(item?.c)
    if (symbol && Number.isFinite(price) && price > 0) {
      map[symbol] = price
    }
  }
  return map
}

function toggleSort(state, key) {
  if (state.key !== key) {
    state.key = key
    state.dir = 'desc'
  } else if (state.dir === 'desc') {
    state.dir = 'asc'
  } else {
    state.key = null
  }
}

function applySort(list, state) {
  if (!state.key) return list
  const key = state.key
  const sorted = [...list].sort((a, b) => {
    const va = a[key]
    const vb = b[key]
    if (va == null && vb == null) return 0
    if (va == null) return 1
    if (vb == null) return -1
    if (typeof va === 'string') return va.localeCompare(vb)
    return va - vb
  })
  return state.dir === 'asc' ? sorted : sorted.reverse()
}

// --- Autocompletado del CCL en el formulario ---
const cclLoading = ref(false)
const cclIsAuto = ref(false)
const cclMsg = ref('')

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function emptyForm() {
  return {
    date: todayISO(),
    assetType: 'CEDEAR',
    ticker: '',
    operation: 'COMPRA',
    quantity: '',
    price: '',
    fee: '',
    ccl: '',
    notes: '',
  }
}

const form = reactive(emptyForm())
const formError = ref('')

function formatMoney(n) {
  if (n === null || n === undefined || n === '') return '—'
  const num = Number(n) || 0
  return num.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatNum(n, maxDigits = 4) {
  if (n === null || n === undefined || n === '') return '—'
  return Number(n).toLocaleString('es-AR', { maximumFractionDigits: maxDigits })
}

function formatPct(n) {
  if (n === null || n === undefined) return '—'
  const sign = n >= 0 ? '+' : ''
  return `${sign}${n.toFixed(2)}%`
}

function formatDate(d) {
  if (!d) return '—'
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}

const searchQuery = ref('')
const currentPage = ref(1)
const PAGE_SIZE = 10

const filteredTrades = computed(() => {
  const q = searchQuery.value.trim().toUpperCase()
  if (!q) return trades.value
  return trades.value.filter((t) => t.ticker.toUpperCase().includes(q))
})

const sortedTrades = computed(() =>
  [...filteredTrades.value].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id))
)

// Paginación: 10 por página sobre el resultado ya buscado, así el buscador
// siempre encuentra en TODO el historial, no solo en la página visible.
const totalPages = computed(() => Math.max(1, Math.ceil(sortedTrades.value.length / PAGE_SIZE)))

const paginatedTrades = computed(() => {
  const start = (currentPage.value - 1) * PAGE_SIZE
  return sortedTrades.value.slice(start, start + PAGE_SIZE)
})

// Cada tarjeta necesita "cómo viene este papel" (getTradeVsCurrent, definida
// más abajo) una sola vez por operación visible, no recalcularlo en cada
// interpolación del template.
const paginatedTradesWithLive = computed(() =>
  paginatedTrades.value.map((t) => ({ ...t, vsCurrent: getTradeVsCurrent(t) }))
)

function goToPage(p) {
  currentPage.value = Math.min(Math.max(1, p), totalPages.value)
}

watch(searchQuery, () => {
  currentPage.value = 1
})

// Posiciones abiertas con valor de mercado y rendimiento no realizado, en
// ARS y en USD — como muestran los brokers en su panel de "cartera".
const openPositions = computed(() =>
  summary.value.bySymbol
    .filter((s) => s.quantity > 0)
    .map((s) => {
      const isCedear = s.assetType === 'CEDEAR'
      const livePrice = getLivePrice(s.ticker, s.assetType)
      const marketValueARS = livePrice != null ? s.quantity * livePrice : null
      const unrealizedARS = marketValueARS != null ? marketValueARS - s.invested : null
      const unrealizedARSPct =
        marketValueARS != null && s.invested > 0 ? (unrealizedARS / s.invested) * 100 : null

      // --- Valuación en USD ---
      // Para CEDEARs, el CCL "oficial" (dolarapi) puede diferir bastante del
      // CCL implícito de cada CEDEAR en particular. Para no perder el precio
      // real de ganancia/pérdida, valuamos directamente con la cantidad de
      // acciones equivalentes (según el ratio) y el precio real de la acción
      // en dólares (data912). Si falta el ratio o el precio subyacente,
      // caemos de vuelta al CCL general como aproximación (marcada en la UI).
      const ratio = isCedear ? getRatio(s.ticker) : null
      const underlyingPriceUSD = isCedear ? getUnderlyingPriceUSD(s.ticker) : null
      const usesRatioValuation = isCedear && ratio != null && underlyingPriceUSD != null

      let marketValueUSD = null
      if (usesRatioValuation) {
        marketValueUSD = (s.quantity / ratio) * underlyingPriceUSD
      } else if (marketValueARS != null && cclActual.value) {
        marketValueUSD = marketValueARS / cclActual.value
      }

      // CCL implícito de este CEDEAR puntual, a modo informativo: cuánto
      // "vale" el dólar si valuás por el precio real de la acción.
      const impliedCCL =
        usesRatioValuation && livePrice != null ? (livePrice * ratio) / underlyingPriceUSD : null

      const unrealizedUSD =
        marketValueUSD != null && !s.usdIncomplete && s.investedUSD != null
          ? marketValueUSD - s.investedUSD
          : null
      const unrealizedUSDPct =
        unrealizedUSD != null && s.investedUSD > 0 ? (unrealizedUSD / s.investedUSD) * 100 : null

      // Cuánto tardaste en generar esa ganancia/pérdida: antigüedad promedio
      // ponderada por cantidad, contemplando todas las compras de este ticker.
      const holding = getAvgHoldingDays(s.ticker)
      const holdingDays = holding ? holding.days : null
      const holdingLots = holding ? holding.lots : 0

      return {
        ...s,
        livePrice,
        marketValueARS,
        unrealizedARS,
        unrealizedARSPct,
        ratio,
        underlyingPriceUSD,
        usesRatioValuation,
        impliedCCL,
        marketValueUSD,
        unrealizedUSD,
        unrealizedUSDPct,
        holdingDays,
        holdingLots,
      }
    })
)

// Filtro propio de la tabla "Posiciones abiertas" (no afecta al historial).
const filteredOpenPositions = computed(() => {
  const q = openPositionsSearch.value.trim().toUpperCase()
  const base = q ? openPositions.value.filter((p) => p.ticker.toUpperCase().includes(q)) : openPositions.value
  return applySort(base, openPositionsSort)
})

// Filtro propio de la tabla "Resultado por ticker" (no afecta al historial).
const filteredBySymbol = computed(() => {
  const q = bySymbolSearch.value.trim().toUpperCase()
  const base = q ? summary.value.bySymbol.filter((s) => s.ticker.toUpperCase().includes(q)) : summary.value.bySymbol
  return applySort(base, bySymbolSort)
})

async function loadAll() {
  loading.value = true
  errorMsg.value = ''
  try {
    const [t, s] = await Promise.all([getTrades(), getTradesSummary()])
    trades.value = t
    summary.value = s
  } catch (e) {
    errorMsg.value = e.message
  } finally {
    loading.value = false
  }
}

async function refreshSummary() {
  try {
    summary.value = await getTradesSummary()
  } catch (e) {
    console.error('Error refrescando el resumen', e)
  }
}

// =========================================================
// DÓLAR CCL — en vivo (dolarapi) e histórico (argentinadatos)
// =========================================================
async function fetchLiveCCL() {
  const lista = await fetchJson(DOLARAPI_LIST_URL)
  if (!Array.isArray(lista)) throw new Error('Respuesta inesperada de dolarapi')
  const ccl = lista.find((d) => d?.casa === 'contadoconliqui')
  const value = ccl ? Number(ccl.venta) : null
  return Number.isFinite(value) && value > 0 ? value : null
}

async function fetchHistoricalCCL(dateStr) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null
  const [y, m, d] = dateStr.split('-')
  let data
  try {
    data = await fetchJson(`${HISTORICAL_CCL_BASE}/${y}/${m}/${d}`)
  } catch {
    return null // fin de semana / feriado / fecha sin dato / fuente caída
  }
  const row = Array.isArray(data) ? data[0] : data
  const value = row ? Number(row.venta) : null
  return Number.isFinite(value) && value > 0 ? value : null
}

async function refreshLiveCCL() {
  try {
    const value = await fetchLiveCCL()
    if (value) cclActual.value = value
  } catch (e) {
    console.error('No se pudo actualizar el CCL en vivo', e)
  }
}

// Autocompleta el campo CCL del formulario: usa el valor en vivo si la
// fecha es hoy, o el histórico de argentinadatos si es una fecha pasada.
// Si el usuario ya lo editó a mano, no lo pisa hasta que cambie la fecha.
async function autofillCCL() {
  if (!cclIsAuto.value) return
  cclLoading.value = true
  cclMsg.value = ''
  try {
    let value = null
    if (form.date === todayISO()) {
      value = cclActual.value ?? (await fetchLiveCCL())
    } else {
      value = await fetchHistoricalCCL(form.date)
    }
    if (value) {
      form.ccl = value
    } else {
      cclMsg.value = 'No hay cotización para esa fecha (fin de semana/feriado). Cargala a mano.'
    }
  } catch (e) {
    cclMsg.value = 'No se pudo traer el CCL automáticamente. Cargalo a mano.'
  } finally {
    cclLoading.value = false
  }
}

function onCclManualInput() {
  cclIsAuto.value = false
  cclMsg.value = ''
}

function refetchCCL() {
  cclIsAuto.value = true
  autofillCCL()
}

watch(
  () => form.date,
  () => {
    cclIsAuto.value = true
    autofillCCL()
  }
)

// =========================================================
// PRECIOS DE CEDEARs EN VIVO (data912.com, sin API key)
// =========================================================
async function loadLiveCedears() {
  try {
    const data = await fetchJson(CEDEARS_LIVE_URL)
    if (!Array.isArray(data)) throw new Error('Respuesta inesperada de data912 (CEDEARs)')
    liveCedears.value = data
  } catch (e) {
    console.error('No se pudo cargar el precio en vivo de CEDEARs', e)
  }
}

// =========================================================
// PRECIOS DE ACCIONES ARGENTINAS EN VIVO (data912.com, panel BYMA)
// =========================================================
async function loadLiveArgStocks() {
  try {
    const data = await fetchJson(ARG_STOCKS_LIVE_URL)
    if (!Array.isArray(data)) throw new Error('Respuesta inesperada de data912 (acciones AR)')
    liveArgStocks.value = data
    argStocksError.value = ''
  } catch (e) {
    console.error('No se pudo cargar el precio en vivo de acciones argentinas', e)
    // Solo mostramos el error si todavía no tenemos ningún dato cargado;
    // si ya había un precio previo, preferimos seguir mostrándolo (levemente
    // desactualizado) antes que taparlo con un mensaje de error.
    if (!liveArgStocks.value.length) {
      argStocksError.value = 'No se pudo obtener la cotización de acciones argentinas.'
    }
  }
}

// Precio en vivo de un ticker, según el panel que le corresponda a su
// assetType. CEDEAR -> panel de CEDEARs; ACCION_AR -> panel de acciones
// del Merval/BYMA. Cualquier otro tipo (o ticker no encontrado) da null,
// y toda la UI ya está preparada para mostrar "—" en ese caso.
function getLivePrice(ticker, assetType) {
  const symbol = String(ticker ?? '').trim().toUpperCase()
  if (!symbol) return null

  const panel = assetType === 'ACCION_AR' ? liveArgStocks.value : liveCedears.value
  const found = panel.find((item) => String(item?.symbol ?? '').toUpperCase() === symbol)
  const price = found ? Number(found.c) : null
  return Number.isFinite(price) && price > 0 ? price : null
}

// =========================================================
// DÍAS TRANSCURRIDOS (para saber cuánto tardaste en hacer la ganancia)
// =========================================================
// Comparamos por fecha calendario (no por hora exacta) para evitar que un
// desfasaje de husos horarios sume o reste un día de más.
function daysSince(dateStr) {
  if (!dateStr) return null
  const then = new Date(dateStr)
  if (Number.isNaN(then.getTime())) return null
  const startOfThen = Date.UTC(then.getUTCFullYear(), then.getUTCMonth(), then.getUTCDate())
  const now = new Date()
  const startOfNow = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.max(0, Math.round((startOfNow - startOfThen) / 86_400_000))
}

function formatDays(n) {
  if (n == null) return '—'
  if (n === 0) return 'hoy'
  if (n === 1) return '1 día'
  return `${n} días`
}

// Antigüedad de una posición abierta: como puede estar armada con varias
// compras en fechas distintas, usamos el promedio ponderado por cantidad
// (mismo criterio que el costo promedio) en vez de una sola fecha. Si hubo
// ventas parciales no sabemos qué lote puntual quedó (no hay tracking FIFO),
// así que esto es una aproximación razonable, no un dato exacto.
function getAvgHoldingDays(ticker) {
  const buys = trades.value.filter((t) => t.ticker === ticker && t.operation === 'COMPRA' && t.quantity > 0)
  if (!buys.length) return null
  let totalQty = 0
  let weightedDays = 0
  for (const b of buys) {
    const d = daysSince(b.date)
    if (d == null) continue
    totalQty += b.quantity
    weightedDays += d * b.quantity
  }
  if (totalQty <= 0) return null
  return { days: Math.round(weightedDays / totalQty), lots: buys.length }
}

// Días de calendario entre dos fechas "YYYY-MM-DD" (no contra hoy). Se usa
// para saber cuánto duró abierta una posición ya cerrada (de la compra a la
// última venta), en vez de contar días hasta hoy como si siguiera abierta.
function daysBetween(dateAStr, dateBStr) {
  if (!dateAStr || !dateBStr) return null
  const a = new Date(dateAStr)
  const b = new Date(dateBStr)
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null
  const ua = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate())
  const ub = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate())
  return Math.max(0, Math.round((ub - ua) / 86_400_000))
}

// Precio promedio de venta y fecha de la última venta de un ticker, para
// mostrar "hasta dónde llegó" una posición ya cerrada en vez de compararla
// contra el precio de hoy (que ya no tiene nada que ver con esa plata).
function getTickerSaleInfo(ticker) {
  const sales = trades.value.filter((t) => t.ticker === ticker && t.operation === 'VENTA' && t.quantity > 0)
  if (!sales.length) return null
  let totalQty = 0
  let totalValue = 0
  let lastDate = null
  for (const s of sales) {
    totalQty += s.quantity
    totalValue += s.quantity * s.price
    if (!lastDate || s.date > lastDate) lastDate = s.date
  }
  if (totalQty <= 0) return null
  return { avgSellPrice: totalValue / totalQty, lastDate }
}

// =========================================================
// CÓMO VIENE ESTE PAPEL, PARA UNA OPERACIÓN PUNTUAL
// =========================================================
// Igual que en "Posiciones abiertas" (que compara contra el costo promedio
// agregado), pero acá comparamos el precio de ESA operación en particular
// contra el precio actual. Para compras es directamente el rendimiento no
// realizado de ese lote; para ventas es solo informativo (cómo se movió el
// papel después de que lo vendiste, no es plata que tengas).
//
// Si el ticker ya está totalmente cerrado (se vendió todo lo que había),
// mostrar el precio de HOY no tiene sentido: esas acciones ya no existen en
// la cartera y comparar contra la cotización actual solo desvirtúa la
// ganancia real. En ese caso, en vez de precio en vivo, se muestra el
// resultado neto ya realizado de ese ticker (que es el número correcto) y
// el precio promedio al que efectivamente se vendió.
function getTradeVsCurrent(t) {
  const tickerSummary = summary.value.bySymbol.find((s) => s.ticker === t.ticker)
  const isClosed = !!tickerSummary && tickerSummary.quantity <= 0

  if (isClosed) {
    const saleInfo = getTickerSaleInfo(t.ticker)
    return {
      available: true,
      isClosed: true,
      isSale: t.operation === 'VENTA',
      avgSellPrice: saleInfo?.avgSellPrice ?? null,
      daysHeld: saleInfo ? daysBetween(t.date, saleInfo.lastDate) : null,
      realizedPL: tickerSummary.realizedPL,
      realizedPLUSD: tickerSummary.usdIncomplete ? null : tickerSummary.realizedPLUSD,
    }
  }

  const isCedear = t.assetType === 'CEDEAR'
  const livePrice = getLivePrice(t.ticker, t.assetType)
  const daysElapsed = daysSince(t.date)

  if (livePrice == null || !t.price) return { available: false, daysElapsed }

  const pctChange = ((livePrice - t.price) / t.price) * 100
  const currentValueARS = t.quantity * livePrice

  if (t.operation === 'VENTA') {
    return { available: true, isSale: true, livePrice, pctChange, daysElapsed }
  }

  // Costo real de esta compra puntual (incluye comisión).
  const costBasisARS = t.total
  const gainARS = currentValueARS - costBasisARS
  const gainARSPct = costBasisARS > 0 ? (gainARS / costBasisARS) * 100 : null

  // Mismo criterio que en Posiciones abiertas: para CEDEARs, valuar en USD
  // con el ratio real + precio de la acción, no con el CCL general.
  const ratio = isCedear ? getRatio(t.ticker) : null
  const underlyingPriceUSD = isCedear ? getUnderlyingPriceUSD(t.ticker) : null
  const usesRatioValuation = isCedear && ratio != null && underlyingPriceUSD != null

  let currentValueUSD = null
  if (usesRatioValuation) {
    currentValueUSD = (t.quantity / ratio) * underlyingPriceUSD
  } else if (cclActual.value) {
    currentValueUSD = currentValueARS / cclActual.value
  }

  const costBasisUSD = t.priceUSD != null ? t.quantity * t.priceUSD : null
  const gainUSD = currentValueUSD != null && costBasisUSD != null ? currentValueUSD - costBasisUSD : null
  const gainUSDPct = gainUSD != null && costBasisUSD > 0 ? (gainUSD / costBasisUSD) * 100 : null

  return {
    available: true,
    isSale: false,
    livePrice,
    pctChange,
    currentValueARS,
    gainARS,
    gainARSPct,
    currentValueUSD,
    gainUSD,
    gainUSDPct,
    usesRatioValuation,
    daysElapsed,
  }
}

// =========================================================
// PRECIO EN USD DE LA ACCIÓN SUBYACENTE (data912)
// =========================================================
async function loadUsaPrices() {
  const results = await Promise.allSettled([
    fetchJson(USA_STOCKS_LIVE_URL),
    fetchJson(USA_ADRS_LIVE_URL),
  ])
  const merged = {}
  let anyOk = false
  for (const settled of results) {
    if (settled.status !== 'fulfilled') {
      console.error('No se pudo cargar un panel de precios en USD', settled.reason)
      continue
    }
    anyOk = true
    Object.assign(merged, normalizeLivePanel(settled.value))
  }
  // Si ambas fuentes fallaron, preferimos conservar los precios anteriores
  // (mejor un dato levemente viejo que perder toda la valuación en USD).
  if (anyOk) usaPrices.value = merged
}

function getUnderlyingPriceUSD(ticker) {
  return usaPrices.value[ticker] ?? null
}

// =========================================================
// RATIO CEDEAR / ACCIÓN SUBYACENTE
// =========================================================
// Acepta tanto "20" (20 CEDEARs = 1 acción) como formato "20:1" o, para
// ratios inversos, "1:2" (1 CEDEAR = 2 acciones).
function parseRatio(raw) {
  if (raw === null || raw === undefined) return null
  const str = String(raw).trim()
  if (!str) return null
  if (str.includes(':')) {
    const [a, b] = str.split(':').map(Number)
    if (!a || !b) return null
    return a / b
  }
  const n = Number(str)
  return n > 0 ? n : null
}

async function loadCedearRatios() {
  try {
    const data = await fetchJson(CEDEAR_RATIOS_URL)
    const items = Array.isArray(data) ? data : data?.items || []
    for (const item of items) {
      const ticker = String(item.Cedears || item.ticker || '').toUpperCase()
      const ratio = parseRatio(item.Ratio ?? item.ratio)
      if (!ticker || !ratio) continue
      // No pisamos un ratio que el usuario ya haya corregido a mano.
      if (cedearRatiosAuto[ticker] === false) continue
      cedearRatios.value[ticker] = ratio
      cedearRatiosAuto[ticker] = true
    }
  } catch (e) {
    // No es crítico: si falla, cada CEDEAR se puede cargar a mano.
    console.error('No se pudo cargar la tabla de ratios de CEDEARs', e)
  }
}

function getRatio(ticker) {
  return cedearRatios.value[ticker] ?? null
}

// Permite al usuario corregir el ratio a mano (por ticker faltante o
// desactualizado). Queda marcado como "manual" para no perderlo si
// después se refresca la tabla automática.
function setManualRatio(ticker, rawValue) {
  const n = Number(rawValue)
  if (n > 0) {
    cedearRatios.value = { ...cedearRatios.value, [ticker]: n }
  } else {
    const { [ticker]: _omit, ...rest } = cedearRatios.value
    cedearRatios.value = rest
  }
  cedearRatiosAuto[ticker] = false
}

// =========================================================
// FORMULARIO
// =========================================================
function startEdit(trade) {
  editingId.value = trade.id
  viewMode.value = 'form'
  form.date = trade.date
  form.assetType = trade.assetType
  form.ticker = trade.ticker
  form.operation = trade.operation
  form.quantity = trade.quantity
  form.price = trade.price
  form.fee = trade.fee
  form.ccl = trade.ccl ?? ''
  form.notes = trade.notes
  // Al editar no pisamos el CCL ya cargado; si cambian la fecha, ahí sí
  // se vuelve a buscar automáticamente.
  cclIsAuto.value = false
  cclMsg.value = ''
  formError.value = ''
}

function cancelEdit() {
  editingId.value = null
  Object.assign(form, emptyForm())
  formError.value = ''
  cclMsg.value = ''
  cclIsAuto.value = true
  autofillCCL()
}

const ASSET_TYPES = ['CEDEAR', 'ACCION_AR']
const OPERATIONS = ['COMPRA', 'VENTA']

async function submitForm() {
  formError.value = ''
  const ticker = form.ticker.trim().toUpperCase()

  if (!form.date || Number.isNaN(new Date(form.date).getTime())) {
    return (formError.value = 'Ingresá una fecha válida')
  }
  if (!ASSET_TYPES.includes(form.assetType)) {
    return (formError.value = 'Seleccioná un tipo de activo válido')
  }
  if (!ticker) return (formError.value = 'Ingresá un ticker')
  if (!OPERATIONS.includes(form.operation)) {
    return (formError.value = 'Seleccioná una operación válida')
  }
  if (!(Number(form.quantity) > 0)) return (formError.value = 'La cantidad debe ser mayor a 0')
  if (!(Number(form.price) > 0)) return (formError.value = 'El precio debe ser mayor a 0')
  if (form.fee !== '' && Number(form.fee) < 0) {
    return (formError.value = 'La comisión no puede ser negativa')
  }
  if (form.ccl !== '' && !(Number(form.ccl) > 0)) {
    return (formError.value = 'El dólar CCL debe ser mayor a 0 (o dejalo vacío)')
  }

  const payload = {
    date: form.date,
    assetType: form.assetType,
    ticker,
    operation: form.operation,
    quantity: Number(form.quantity),
    price: Number(form.price),
    fee: Number(form.fee) || 0,
    ccl: form.ccl === '' ? null : Number(form.ccl),
    notes: form.notes.trim(),
  }

  saving.value = true
  try {
    if (editingId.value) {
      const updated = await updateTrade(editingId.value, payload)
      const idx = trades.value.findIndex((t) => t.id === editingId.value)
      if (idx !== -1) trades.value[idx] = updated
    } else {
      const created = await createTrade(payload)
      trades.value.push(created)
    }
    cancelEdit()
    await refreshSummary()
  } catch (e) {
    formError.value = e.message
  } finally {
    saving.value = false
  }
}

async function removeTrade(trade) {
  const ok = window.confirm(`¿Borrar la operación de ${trade.ticker} del ${formatDate(trade.date)}?`)
  if (!ok) return
  try {
    await deleteTrade(trade.id)
    trades.value = trades.value.filter((t) => t.id !== trade.id)
    if (editingId.value === trade.id) cancelEdit()
    await refreshSummary()
  } catch (e) {
    errorMsg.value = e.message
  }
}

function close() {
  emit('close')
}

function onOverlayClick(e) {
  if (e.target === e.currentTarget) close()
}

onMounted(() => {
  loadAll()

  refreshLiveCCL()
  intervaloCclActual = setInterval(refreshLiveCCL, CCL_REFRESH_MS)

  loadLiveCedears()
  intervaloCedears = setInterval(loadLiveCedears, CEDEARS_REFRESH_MS)

  loadLiveArgStocks()
  intervaloArgStocks = setInterval(loadLiveArgStocks, ARG_STOCKS_REFRESH_MS)

  loadUsaPrices()
  intervaloUsaPrices = setInterval(loadUsaPrices, USA_PRICES_REFRESH_MS)

  // Los ratios casi no cambian en el día a día, alcanza con cargarlos una vez.
  loadCedearRatios()

  // Primer autocompletado del CCL para el formulario "hoy" en blanco.
  cclIsAuto.value = true
  autofillCCL()
})

onUnmounted(() => {
  if (intervaloCclActual) clearInterval(intervaloCclActual)
  if (intervaloCedears) clearInterval(intervaloCedears)
  if (intervaloArgStocks) clearInterval(intervaloArgStocks)
  if (intervaloUsaPrices) clearInterval(intervaloUsaPrices)
})
</script>

<template>
  <div class="trades-overlay" @click="onOverlayClick">
    <div class="trades-modal">
      <div class="trades-header">
        <div class="trades-title">
          <span class="trades-icon">📒</span>
          Bitácora de Trades
        </div>
        <button class="close-btn" @click="close" title="Cerrar">✕</button>
      </div>

      <div v-if="loading" class="trades-loading">Cargando bitácora...</div>

      <template v-else>
        <div v-if="errorMsg" class="trades-error">{{ errorMsg }}</div>

        <!-- Resumen general -->
        <div class="summary-bar">
          <div class="summary-card">
            <span class="summary-label">Resultado realizado (ARS)</span>
            <strong :class="summary.totals.realizedPL >= 0 ? 'pl-pos' : 'pl-neg'">
              {{ summary.totals.realizedPL >= 0 ? '+' : '' }}${{ formatMoney(summary.totals.realizedPL) }}
            </strong>
          </div>
          <div class="summary-card">
            <span class="summary-label">Resultado realizado (USD)</span>
            <strong :class="summary.totals.realizedPLUSD >= 0 ? 'pl-pos' : 'pl-neg'">
              {{ summary.totals.realizedPLUSD >= 0 ? '+' : '' }}US${{ formatMoney(summary.totals.realizedPLUSD) }}
            </strong>
          </div>
          <div class="summary-card">
            <span class="summary-label">Invertido (posiciones abiertas)</span>
            <strong>${{ formatMoney(summary.totals.invested) }}</strong>
          </div>
          <div class="summary-card">
            <span class="summary-label">Posiciones abiertas</span>
            <strong>{{ summary.totals.openPositions }}</strong>
          </div>
          <div class="summary-card">
            <span class="summary-label">Operaciones cargadas</span>
            <strong>{{ summary.totals.totalTrades }}</strong>
          </div>
          <div class="summary-card">
            <span class="summary-label">CCL actual (referencia)</span>
            <strong>{{ cclActual ? `$${formatMoney(cclActual)}` : '—' }}</strong>
          </div>
        </div>

        <!-- Selector de pantalla: cargar/editar vs. ver todo el detalle -->
        <div class="view-tabs">
          <button
            type="button"
            class="view-tab"
            :class="{ active: viewMode === 'form' }"
            @click="viewMode = 'form'"
          >
            📝 Cargar / Editar
          </button>
          <button
            type="button"
            class="view-tab"
            :class="{ active: viewMode === 'list' }"
            @click="viewMode = 'list'"
          >
            📋 Ver todo el detalle ({{ trades.length }})
          </button>
        </div>

        <!-- ============================================================ -->
        <!-- PANTALLA: VER TODO EL DETALLE (solo lectura, una tarjeta por  -->
        <!-- operación, sin formulario de por medio)                      -->
        <!-- ============================================================ -->
        <div v-if="viewMode === 'list'" class="full-detail-screen">
          <div class="table-header-row">
            <div class="section-title">Todas las operaciones ({{ filteredTrades.length }})</div>
            <div class="search-box">
              <input
                type="text"
                v-model="searchQuery"
                placeholder="Buscar por ticker..."
                style="text-transform:uppercase"
              >
              <button v-if="searchQuery" type="button" class="search-clear" @click="searchQuery = ''">✕</button>
            </div>
          </div>

          <div v-if="!sortedTrades.length" class="empty-state">
            {{ searchQuery ? `No hay operaciones que coincidan con "${searchQuery}".` : 'Todavía no cargaste ninguna operación.' }}
          </div>

          <div v-else class="entry-cards">
            <div v-for="t in paginatedTradesWithLive" :key="t.id" class="entry-card">
              <div class="entry-card-header">
                <div class="entry-card-title">
                  <span class="ticker-cell">{{ t.ticker }}</span>
                  <span class="badge" :class="t.assetType === 'CEDEAR' ? 'badge-cedear' : 'badge-ar'">{{ t.assetType === 'CEDEAR' ? 'CEDEAR' : 'Acción AR' }}</span>
                  <span class="badge" :class="t.operation === 'COMPRA' ? 'badge-buy' : 'badge-sell'">{{ t.operation === 'COMPRA' ? 'Compra' : 'Venta' }}</span>
                </div>
                <div class="entry-card-actions">
                  <button class="icon-btn" title="Editar" @click="startEdit(t)">✎</button>
                  <button class="icon-btn icon-btn-danger" title="Eliminar" @click="removeTrade(t)">🗑</button>
                </div>
              </div>

              <div class="entry-card-dates">{{ formatDate(t.date) }}</div>

              <div class="entry-card-grid">
                <div class="detail-item">
                  <span class="detail-label">Cantidad</span>
                  <span class="detail-value">{{ formatNum(t.quantity) }}</span>
                </div>
                <div class="detail-item">
                  <span class="detail-label">Precio (ARS)</span>
                  <span class="detail-value">${{ formatMoney(t.price) }}</span>
                </div>
                <div class="detail-item">
                  <span class="detail-label">CCL del día</span>
                  <span class="detail-value">{{ t.ccl ? `$${formatMoney(t.ccl)}` : '—' }}</span>
                </div>
                <div class="detail-item">
                  <span class="detail-label">Precio (USD)</span>
                  <span class="detail-value">{{ t.priceUSD != null ? `US$${formatMoney(t.priceUSD)}` : '—' }}</span>
                </div>
                <div class="detail-item">
                  <span class="detail-label">Comisión</span>
                  <span class="detail-value">${{ formatMoney(t.fee) }}</span>
                </div>
                <div class="detail-item">
                  <span class="detail-label">Total operación</span>
                  <span class="detail-value">${{ formatMoney(t.total) }}</span>
                </div>
              </div>

              <!-- Cómo viene este papel: si el ticker ya está totalmente cerrado (se
                   vendió todo), no tiene sentido compararlo contra el precio de hoy
                   -esas acciones ya no las tenés-, así que se muestra el resultado
                   neto ya realizado y el precio promedio al que se vendió. Solo si
                   todavía queda posición abierta se compara contra el precio en vivo. -->
              <div class="vs-current-row">
                <template v-if="t.vsCurrent.available">
                  <template v-if="t.vsCurrent.isClosed">
                    <span class="vs-current-label">🔒 Posición de {{ t.ticker }} cerrada</span>
                    <template v-if="t.vsCurrent.avgSellPrice != null">
                      <span class="vs-current-sep">·</span>
                      <span class="vs-current-label">vendida en promedio a</span>
                      <span class="vs-current-price">${{ formatMoney(t.vsCurrent.avgSellPrice) }}</span>
                      <span v-if="t.vsCurrent.daysHeld != null" class="vs-current-note">(mantenida {{ formatDays(t.vsCurrent.daysHeld) }})</span>
                    </template>
                    <span class="vs-current-sep">·</span>
                    <span class="vs-current-label">resultado neto del ticker</span>
                    <span :class="t.vsCurrent.realizedPL >= 0 ? 'pl-pos' : 'pl-neg'">
                      {{ t.vsCurrent.realizedPL >= 0 ? '+' : '' }}${{ formatMoney(t.vsCurrent.realizedPL) }}
                    </span>
                    <template v-if="t.vsCurrent.realizedPLUSD != null">
                      <span class="vs-current-sep">/</span>
                      <span class="stacked-line-dim" :class="t.vsCurrent.realizedPLUSD >= 0 ? 'pl-pos' : 'pl-neg'">
                        {{ t.vsCurrent.realizedPLUSD >= 0 ? '+' : '' }}US${{ formatMoney(t.vsCurrent.realizedPLUSD) }}
                      </span>
                    </template>
                  </template>
                  <template v-else-if="t.vsCurrent.isSale">
                    <span class="vs-current-days" title="Días desde la fecha de esta venta hasta hoy">Hace {{ formatDays(t.vsCurrent.daysElapsed) }}</span>
                    <span class="vs-current-sep">·</span>
                    <span class="vs-current-label">desde que la vendiste, cotiza</span>
                    <span class="vs-current-price">${{ formatMoney(t.vsCurrent.livePrice) }}</span>
                    <span class="pct-tag" :class="t.vsCurrent.pctChange >= 0 ? 'pl-pos' : 'pl-neg'">
                      ({{ t.vsCurrent.pctChange >= 0 ? '+' : '' }}{{ formatPct(t.vsCurrent.pctChange) }})
                    </span>
                    <span class="vs-current-note">— no es tu ganancia/pérdida, todavía te queda posición abierta en este ticker</span>
                  </template>
                  <template v-else>
                    <span class="vs-current-days" title="Días desde la fecha de esta compra hasta hoy">Hace {{ formatDays(t.vsCurrent.daysElapsed) }}</span>
                    <span class="vs-current-sep">·</span>
                    <span class="vs-current-label">hoy cotiza</span>
                    <span class="vs-current-price">${{ formatMoney(t.vsCurrent.livePrice) }}</span>
                    <span class="pct-tag" :class="t.vsCurrent.pctChange >= 0 ? 'pl-pos' : 'pl-neg'">
                      ({{ t.vsCurrent.pctChange >= 0 ? '+' : '' }}{{ formatPct(t.vsCurrent.pctChange) }})
                    </span>
                    <span class="vs-current-sep">·</span>
                    <span :class="t.vsCurrent.gainARS >= 0 ? 'pl-pos' : 'pl-neg'">
                      {{ t.vsCurrent.gainARS >= 0 ? '+' : '' }}${{ formatMoney(t.vsCurrent.gainARS) }}
                    </span>
                    <template v-if="t.vsCurrent.gainUSD != null">
                      <span class="vs-current-sep">/</span>
                      <span
                        class="stacked-line-dim"
                        :class="t.vsCurrent.gainUSD >= 0 ? 'pl-pos' : 'pl-neg'"
                        :title="t.vsCurrent.usesRatioValuation ? 'Calculado con ratio + precio real de la acción' : 'Aproximado con el CCL general'"
                      >
                        {{ t.vsCurrent.gainUSD >= 0 ? '+' : '' }}US${{ formatMoney(t.vsCurrent.gainUSD) }}
                        {{ t.vsCurrent.usesRatioValuation ? '✓' : '≈' }}
                      </span>
                    </template>
                  </template>
                </template>
                <template v-else>
                  <span class="vs-current-days">Hace {{ formatDays(t.vsCurrent.daysElapsed) }}</span>
                  <span class="vs-current-sep">·</span>
                  <span class="vs-current-label">sin cotización en vivo disponible para este papel.</span>
                </template>
              </div>

              <div class="entry-card-notes">
                <div class="detail-item">
                  <span class="detail-label">Notas</span>
                  <p class="detail-text">{{ t.notes || 'Sin notas cargadas.' }}</p>
                </div>
              </div>
            </div>
          </div>

          <div v-if="sortedTrades.length" class="pagination-bar">
            <button type="button" class="page-btn" :disabled="currentPage === 1" @click="goToPage(currentPage - 1)">← Anterior</button>
            <span class="page-info">Página {{ currentPage }} de {{ totalPages }} · mostrando {{ paginatedTrades.length }} de {{ sortedTrades.length }}</span>
            <button type="button" class="page-btn" :disabled="currentPage === totalPages" @click="goToPage(currentPage + 1)">Siguiente →</button>
          </div>
        </div>

        <template v-if="viewMode === 'form'">
        <!-- Formulario alta / edición -->
        <form class="trade-form" @submit.prevent="submitForm">
          <div class="section-title">{{ editingId ? 'Editar operación' : 'Nueva operación' }}</div>
          <div class="form-grid">
            <div class="form-field">
              <label>Fecha</label>
              <input type="date" v-model="form.date" required>
            </div>
            <div class="form-field">
              <label>Activo</label>
              <select v-model="form.assetType">
                <option value="CEDEAR">CEDEAR</option>
                <option value="ACCION_AR">Acción argentina</option>
              </select>
            </div>
            <div class="form-field">
              <label>Ticker</label>
              <input type="text" v-model="form.ticker" placeholder="Ej: KO, GGAL" style="text-transform:uppercase" required>
            </div>
            <div class="form-field">
              <label>Operación</label>
              <select v-model="form.operation">
                <option value="COMPRA">Compra</option>
                <option value="VENTA">Venta</option>
              </select>
            </div>
            <div class="form-field">
              <label>Cantidad</label>
              <input type="number" min="0" step="any" v-model="form.quantity" placeholder="Ej: 100" required>
            </div>
            <div class="form-field">
              <label>Precio unitario ($)</label>
              <input type="number" min="0" step="any" v-model="form.price" placeholder="Ej: 5230" required>
            </div>
            <div class="form-field">
              <label>Comisión ($)</label>
              <input type="number" min="0" step="any" v-model="form.fee" placeholder="Opcional">
            </div>
            <div class="form-field">
              <label>
                Dólar CCL del día
                <span v-if="cclLoading" class="auto-tag">(buscando...)</span>
                <span v-else-if="cclIsAuto && form.ccl" class="auto-tag">(automático)</span>
              </label>
              <div class="ccl-input-row">
                <input
                  type="number" min="0" step="any"
                  v-model="form.ccl"
                  @input="onCclManualInput"
                  placeholder="Ej: 1320.50"
                >
                <button type="button" class="icon-btn" title="Volver a buscar el CCL de esta fecha" @click="refetchCCL">🔄</button>
              </div>
              <div v-if="cclMsg" class="ccl-hint">{{ cclMsg }}</div>
            </div>
            <div class="form-field form-field-wide">
              <label>Notas</label>
              <input type="text" v-model="form.notes" placeholder="Opcional">
            </div>
          </div>

          <div v-if="formError" class="form-error">{{ formError }}</div>

          <div class="form-actions">
            <button type="submit" class="btn-primary" :disabled="saving">
              {{ saving ? 'Guardando...' : editingId ? 'Guardar cambios' : 'Agregar operación' }}
            </button>
            <button v-if="editingId" type="button" class="btn-secondary" @click="cancelEdit">Cancelar</button>
          </div>
        </form>

        <!-- Posiciones abiertas: valor de mercado y rendimiento no realizado -->
        <div v-if="openPositions.length" class="by-symbol-section">
          <div class="table-header-row">
            <div class="section-title">Posiciones abiertas — valor de mercado ({{ openPositions.length }})</div>
            <div class="search-box">
              <input
                type="text"
                v-model="openPositionsSearch"
                placeholder="Buscar ticker..."
                style="text-transform:uppercase"
              >
              <button v-if="openPositionsSearch" type="button" class="search-clear" @click="openPositionsSearch = ''">✕</button>
            </div>
          </div>
          <div class="by-symbol-table-wrap">
            <table class="by-symbol-table" v-if="filteredOpenPositions.length">
              <thead>
                <tr>
                  <th class="sortable-th" @click="toggleSort(openPositionsSort, 'ticker')">
                    Ticker
                    <span v-if="openPositionsSort.key === 'ticker'" class="sort-arrow">{{ openPositionsSort.dir === 'asc' ? '▲' : '▼' }}</span>
                  </th>
                  <th class="num sortable-th" @click="toggleSort(openPositionsSort, 'quantity')">
                    Cantidad
                    <span v-if="openPositionsSort.key === 'quantity'" class="sort-arrow">{{ openPositionsSort.dir === 'asc' ? '▲' : '▼' }}</span>
                  </th>
                  <th class="num sortable-th" title="Precio en vivo: CEDEARs y Acciones argentinas (data912)" @click="toggleSort(openPositionsSort, 'livePrice')">
                    Precio (ARS)
                    <span v-if="openPositionsSort.key === 'livePrice'" class="sort-arrow">{{ openPositionsSort.dir === 'asc' ? '▲' : '▼' }}</span>
                  </th>
                  <th class="num sortable-th" title="Con ratio conocido, el USD se calcula con el precio real de la acción. Sin ratio, se aproxima con el CCL general (≈)." @click="toggleSort(openPositionsSort, 'marketValueARS')">
                    Valor actual
                    <span v-if="openPositionsSort.key === 'marketValueARS'" class="sort-arrow">{{ openPositionsSort.dir === 'asc' ? '▲' : '▼' }}</span>
                  </th>
                  <th class="num sortable-th" title="Con ratio conocido, el USD se calcula con el precio real de la acción. Sin ratio, se aproxima con el CCL general (≈)." @click="toggleSort(openPositionsSort, 'unrealizedARS')">
                    Rendimiento
                    <span v-if="openPositionsSort.key === 'unrealizedARS'" class="sort-arrow">{{ openPositionsSort.dir === 'asc' ? '▲' : '▼' }}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="p in filteredOpenPositions"
                  :key="p.ticker"
                  :class="p.unrealizedARS == null ? '' : (p.unrealizedARS >= 0 ? 'row-pos' : 'row-neg')"
                >
                  <td>
                    <div class="ticker-cell">{{ p.ticker }}</div>
                    <div v-if="p.holdingDays != null" class="ratio-subrow" :title="p.holdingLots > 1 ? `Promedio ponderado por cantidad entre ${p.holdingLots} compras. No contempla ventas parciales (sin tracking de lotes).` : ''">
                      <span>📅 Hace {{ formatDays(p.holdingDays) }}</span>
                      <span v-if="p.holdingLots > 1" class="stacked-line-dim">(promedio, {{ p.holdingLots }} compras)</span>
                    </div>
                    <div v-if="p.assetType === 'CEDEAR'" class="ratio-subrow">
                      <span>Ratio:</span>
                      <input
                        type="number" min="0" step="any"
                        :value="p.ratio ?? ''"
                        @change="setManualRatio(p.ticker, $event.target.value)"
                        placeholder="ej: 10"
                        class="ratio-input"
                        title="Cantidad de CEDEARs por 1 acción"
                      >
                      <span v-if="p.ratio != null && cedearRatiosAuto[p.ticker] !== false" class="auto-tag">auto</span>
                    </div>
                  </td>
                  <td class="num">{{ formatNum(p.quantity) }}</td>
                  <td class="num">
                    <div class="stacked-cell">
                      <span class="stacked-line-dim">Costo ${{ formatMoney(p.avgCost) }}</span>
                      <span>{{ p.livePrice != null ? `Actual $${formatMoney(p.livePrice)}` : 'Actual —' }}</span>
                    </div>
                  </td>
                  <td class="num">
                    <div class="stacked-cell">
                      <span>{{ p.marketValueARS != null ? `$${formatMoney(p.marketValueARS)}` : '—' }}</span>
                      <span class="stacked-line-dim">
                        <template v-if="p.marketValueUSD != null">
                          US${{ formatMoney(p.marketValueUSD) }}
                          <span
                            v-if="p.assetType === 'CEDEAR'"
                            :title="p.usesRatioValuation ? 'Valor real: calculado con ratio + precio de la acción' : 'Aproximado con el CCL general (falta ratio o precio de la acción)'"
                          >{{ p.usesRatioValuation ? '✓' : '≈' }}</span>
                        </template>
                        <template v-else>—</template>
                      </span>
                    </div>
                  </td>
                  <td class="num">
                    <div class="stacked-cell">
                      <span v-if="p.unrealizedARS === null">—</span>
                      <span v-else :class="p.unrealizedARS >= 0 ? 'pl-pos' : 'pl-neg'">
                        {{ p.unrealizedARS >= 0 ? '+' : '' }}${{ formatMoney(p.unrealizedARS) }}
                        <span class="pct-tag">({{ formatPct(p.unrealizedARSPct) }})</span>
                      </span>
                      <span v-if="p.unrealizedUSD === null" class="stacked-line-dim">—</span>
                      <span v-else class="stacked-line-dim" :class="p.unrealizedUSD >= 0 ? 'pl-pos' : 'pl-neg'">
                        {{ p.unrealizedUSD >= 0 ? '+' : '' }}US${{ formatMoney(p.unrealizedUSD) }}
                        <span class="pct-tag">({{ formatPct(p.unrealizedUSDPct) }})</span>
                      </span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
            <div v-else class="empty-state">Ningún ticker coincide con "{{ openPositionsSearch }}".</div>
          </div>
          <div class="table-hint">
            Precio en vivo para CEDEARs y Acciones argentinas (fuente: data912.com, cada 30s). En
            "Valor actual" y "Rendimiento", la línea de arriba es en pesos y la de abajo en dólares.
            Para CEDEARs, el dólar se calcula con el ratio real contra la acción (✓); sin ratio (o
            para acciones argentinas) se aproxima con el CCL general (≈). Hacé click en un
            encabezado para ordenar.
          </div>
          <div v-if="argStocksError" class="ccl-hint">⚠️ {{ argStocksError }}</div>
        </div>

        <!-- Resumen por ticker (histórico, incluye posiciones cerradas) -->
        <div v-if="summary.bySymbol.length" class="by-symbol-section">
          <div class="table-header-row">
            <div class="section-title">Resultado por ticker (histórico) ({{ summary.bySymbol.length }})</div>
            <div class="search-box">
              <input
                type="text"
                v-model="bySymbolSearch"
                placeholder="Buscar ticker..."
                style="text-transform:uppercase"
              >
              <button v-if="bySymbolSearch" type="button" class="search-clear" @click="bySymbolSearch = ''">✕</button>
            </div>
          </div>
          <div class="by-symbol-table-wrap">
            <table class="by-symbol-table" v-if="filteredBySymbol.length">
              <thead>
                <tr>
                  <th class="sortable-th" @click="toggleSort(bySymbolSort, 'ticker')">
                    Ticker
                    <span v-if="bySymbolSort.key === 'ticker'" class="sort-arrow">{{ bySymbolSort.dir === 'asc' ? '▲' : '▼' }}</span>
                  </th>
                  <th class="num sortable-th" @click="toggleSort(bySymbolSort, 'quantity')">
                    Cantidad
                    <span v-if="bySymbolSort.key === 'quantity'" class="sort-arrow">{{ bySymbolSort.dir === 'asc' ? '▲' : '▼' }}</span>
                  </th>
                  <th class="num sortable-th" @click="toggleSort(bySymbolSort, 'avgCost')">
                    Costo promedio
                    <span v-if="bySymbolSort.key === 'avgCost'" class="sort-arrow">{{ bySymbolSort.dir === 'asc' ? '▲' : '▼' }}</span>
                  </th>
                  <th class="num sortable-th" @click="toggleSort(bySymbolSort, 'realizedPL')">
                    P&L realizado
                    <span v-if="bySymbolSort.key === 'realizedPL'" class="sort-arrow">{{ bySymbolSort.dir === 'asc' ? '▲' : '▼' }}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="s in filteredBySymbol"
                  :key="s.ticker"
                  :class="s.realizedPL >= 0 ? 'row-pos' : 'row-neg'"
                >
                  <td>
                    <div class="ticker-cell">{{ s.ticker }}</div>
                    <span class="badge" :class="s.assetType === 'CEDEAR' ? 'badge-cedear' : 'badge-ar'">{{ s.assetType === 'CEDEAR' ? 'CEDEAR' : 'Acción AR' }}</span>
                  </td>
                  <td class="num">{{ formatNum(s.quantity) }}</td>
                  <td class="num">
                    <div class="stacked-cell">
                      <span>${{ formatMoney(s.avgCost) }}</span>
                      <span class="stacked-line-dim" :title="s.usdIncomplete ? 'Faltan cargar CCL en alguna operación de este ticker' : ''">
                        {{ s.usdIncomplete ? '—' : `US$${formatMoney(s.avgCostUSD)}` }}
                      </span>
                    </div>
                  </td>
                  <td class="num">
                    <div class="stacked-cell">
                      <span :class="s.realizedPL >= 0 ? 'pl-pos' : 'pl-neg'">
                        {{ s.realizedPL >= 0 ? '+' : '' }}${{ formatMoney(s.realizedPL) }}
                      </span>
                      <span v-if="s.usdIncomplete" class="stacked-line-dim" title="Faltan cargar CCL en alguna operación de este ticker">—</span>
                      <span v-else class="stacked-line-dim" :class="s.realizedPLUSD >= 0 ? 'pl-pos' : 'pl-neg'">
                        {{ s.realizedPLUSD >= 0 ? '+' : '' }}US${{ formatMoney(s.realizedPLUSD) }}
                      </span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
            <div v-else class="empty-state">Ningún ticker coincide con "{{ bySymbolSearch }}".</div>
          </div>
        </div>

        </template>
      </template>
    </div>
  </div>
</template>

<style scoped>
.trades-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 24px;
}

.trades-modal {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 14px;
  width: 100%;
  max-width: 1180px;
  max-height: 90vh;
  overflow-y: auto;
  padding: 24px 28px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  font-size: 14.5px;
  line-height: 1.5;
}

.trades-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--border);
  padding-bottom: 16px;
}

.trades-title {
  font-size: 19px;
  font-weight: 700;
  color: var(--text);
  display: flex;
  align-items: center;
  gap: 10px;
}

.close-btn {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text-dim);
  width: 38px;
  height: 38px;
  cursor: pointer;
  font-size: 17px;
}

.close-btn:hover {
  color: var(--text);
  border-color: var(--text-dim);
}

.trades-loading,
.empty-state {
  text-align: center;
  color: var(--text-dim);
  font-size: 14px;
  padding: 32px 0;
}

.trades-error,
.form-error {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.4);
  color: #ef4444;
  padding: 12px 14px;
  border-radius: 8px;
  font-size: 13px;
}

.summary-bar {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 14px;
}

.summary-card {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.summary-label {
  font-size: 11.5px;
  color: var(--text-dim);
}

.summary-card strong {
  font-size: 20px;
  color: var(--text);
  font-family: var(--font-num, inherit);
}

.sortable-th {
  cursor: pointer;
  user-select: none;
}

.sortable-th:hover {
  color: var(--text);
}

.sort-arrow {
  font-size: 9px;
  margin-left: 5px;
  color: var(--blue, #2563eb);
}

.section-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--text);
}

.table-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
}

.search-box {
  position: relative;
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 200px;
  max-width: 320px;
}

.search-box input {
  width: 100%;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 32px 10px 14px;
  color: var(--text);
  font-size: 14px;
  font-family: inherit;
}

.search-box input:focus {
  outline: none;
  border-color: var(--blue, #2563eb);
}

.search-clear {
  position: absolute;
  right: 8px;
  background: none;
  border: none;
  color: var(--text-dim);
  cursor: pointer;
  font-size: 13px;
  padding: 4px;
}

.search-clear:hover {
  color: var(--text);
}

.pagination-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 18px;
  padding-top: 6px;
}

.page-btn {
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text-dim);
  border-radius: 8px;
  padding: 9px 16px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.page-btn:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--text-dim);
}

.page-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.page-info {
  font-size: 13px;
  color: var(--text-dim);
  white-space: nowrap;
}

.view-tabs {
  display: flex;
  gap: 12px;
  border-bottom: 1px solid var(--border);
  padding-bottom: 20px;
}

.view-tab {
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text-dim);
  border-radius: 10px;
  padding: 12px 20px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}

.view-tab:hover {
  color: var(--text);
  border-color: var(--text-dim);
}

.view-tab.active {
  background: rgba(37, 99, 235, 0.15);
  border-color: #2563eb;
  color: var(--blue);
}

.full-detail-screen {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.entry-cards {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.entry-card {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 22px 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.entry-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
}

.entry-card-title {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.entry-card-title .ticker-cell {
  font-size: 18px;
}

.entry-card-actions {
  display: flex;
  gap: 8px;
}

.entry-card-dates {
  font-size: 13px;
  color: var(--text-dim);
  font-family: var(--font-num, inherit);
}

.entry-card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 16px;
  padding: 16px 0;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}

.entry-card-notes {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 14px;
}

.vs-current-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
  padding: 10px 14px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 13.5px;
  font-variant-numeric: tabular-nums;
}

.vs-current-label {
  color: var(--text-dim);
}

.vs-current-price {
  font-weight: 700;
  color: var(--text);
  font-family: var(--font-num, inherit);
}

.vs-current-days {
  font-weight: 700;
  color: var(--blue, #2563eb);
  font-family: var(--font-num, inherit);
}

.vs-current-sep {
  color: var(--text-dim);
}

.vs-current-note {
  color: var(--text-dim);
  font-size: 12px;
}

.detail-item {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}

.detail-label {
  font-size: 12px;
  color: var(--text-dim);
}

.detail-value {
  font-size: 15px;
  color: var(--text);
  font-family: var(--font-num, inherit);
}

.detail-text {
  font-size: 14px;
  color: var(--text);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  margin: 0;
}

.by-symbol-table-wrap {
  overflow: auto;
  max-height: 360px;
  border: 1px solid var(--border);
  border-radius: 10px;
}

.trades-table-wrap {
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: 10px;
}

.by-symbol-table,
.trades-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13.5px;
  font-variant-numeric: tabular-nums;
}

.by-symbol-table th,
.trades-table th {
  text-align: left;
  padding: 10px 14px;
  background: var(--bg);
  color: var(--text-dim);
  font-weight: 600;
  font-size: 12px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}

.by-symbol-table thead th {
  position: sticky;
  top: 0;
  z-index: 2;
}

.by-symbol-table th.num,
.by-symbol-table td.num {
  text-align: right;
}

.by-symbol-table td,
.trades-table td {
  padding: 9px 14px;
  border-bottom: 1px solid var(--border);
  color: var(--text);
  white-space: nowrap;
  font-family: var(--font-num, inherit);
}

.trades-table tbody tr:last-child td,
.by-symbol-table tbody tr:last-child td {
  border-bottom: none;
}

.trades-table tbody tr:hover {
  background: var(--bg);
}

.by-symbol-table tbody tr.row-pos {
  background: rgba(34, 197, 94, 0.055);
}

.by-symbol-table tbody tr.row-neg {
  background: rgba(239, 68, 68, 0.055);
}

.by-symbol-table tbody tr.row-pos:hover {
  background: rgba(34, 197, 94, 0.1);
}

.by-symbol-table tbody tr.row-neg:hover {
  background: rgba(239, 68, 68, 0.1);
}

.table-hint {
  font-size: 12.5px;
  color: var(--text-dim);
  line-height: 1.6;
  padding: 4px 2px 0;
}

.pct-tag {
  font-size: 12px;
  opacity: 0.85;
}

.row-editing {
  background: rgba(37, 99, 235, 0.08);
}

.stacked-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  white-space: nowrap;
}

.by-symbol-table td.num .stacked-cell {
  align-items: flex-end;
}

.stacked-line-dim {
  color: var(--text-dim);
  font-size: 0.88em;
}

.ticker-cell {
  font-weight: 700;
  font-size: 15px;
}

.notes-cell {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: inherit;
  color: var(--text-dim);
}

.badge {
  display: inline-block;
  padding: 4px 11px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 700;
}

.badge-cedear {
  background: rgba(59, 130, 246, 0.15);
  color: #60a5fa;
}

.badge-ar {
  background: rgba(168, 85, 247, 0.15);
  color: #c084fc;
}

.badge-buy {
  background: rgba(34, 197, 94, 0.15);
  color: #22c55e;
}

.badge-sell {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

.pl-pos {
  color: #22c55e !important;
}

.pl-neg {
  color: #ef4444 !important;
}

.actions-cell {
  display: flex;
  gap: 8px;
}

.icon-btn {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 7px;
  width: 32px;
  height: 32px;
  cursor: pointer;
  color: var(--text-dim);
  font-size: 14px;
}

.icon-btn:hover {
  color: var(--text);
  border-color: var(--text-dim);
}

.icon-btn-danger:hover {
  color: #ef4444;
  border-color: #ef4444;
}

.trade-form {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 24px 26px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 18px;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-width: 0;
}

.form-field-wide {
  grid-column: span 2;
}

.form-field label {
  font-size: 13px;
  color: var(--text-dim);
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
}

.auto-tag {
  color: #22c55e;
  font-weight: 600;
}

.ccl-input-row {
  display: flex;
  gap: 8px;
}

.ccl-input-row input {
  flex: 1;
  min-width: 0;
}

.ccl-hint {
  font-size: 12px;
  color: #fbbf24;
  line-height: 1.5;
}

.ratio-subrow {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: 6px;
  font-size: 13px;
  color: var(--text-dim);
  white-space: nowrap;
}

.ratio-subrow-ccl {
  color: var(--text-dim);
}

.ratio-input {
  width: 64px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 5px 8px;
  color: var(--text);
  font-size: 13px;
  font-family: inherit;
}

.ratio-input:focus {
  outline: none;
  border-color: var(--blue, #2563eb);
}

.form-field input,
.form-field select {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 14px;
  color: var(--text);
  font-size: 15px;
  font-family: inherit;
  min-width: 0;
}

.form-field input:focus,
.form-field select:focus {
  outline: none;
  border-color: var(--blue, #2563eb);
}

.form-actions {
  display: flex;
  gap: 12px;
}

.btn-primary {
  background: #2563eb;
  border: 1px solid #2563eb;
  color: white;
  border-radius: 9px;
  padding: 13px 24px;
  font-weight: 600;
  font-size: 15px;
  cursor: pointer;
}

.btn-primary:hover {
  background: #1d4ed8;
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-secondary {
  background: var(--panel);
  border: 1px solid var(--border);
  color: var(--text-dim);
  border-radius: 9px;
  padding: 13px 24px;
  font-weight: 600;
  font-size: 15px;
  cursor: pointer;
}

.btn-secondary:hover {
  color: var(--text);
  border-color: var(--text-dim);
}

@media (max-width: 760px) {
  .trades-overlay {
    padding: 0;
  }
  .trades-modal {
    max-width: 100%;
    height: 100vh;
    height: 100dvh;
    border-radius: 0;
    padding: 16px 12px;
    gap: 14px;
    font-size: 14px;
  }
  .trades-title {
    font-size: 16px;
  }
  .form-field-wide {
    grid-column: span 1;
  }
  .summary-bar {
    gap: 10px;
  }
  .summary-card {
    padding: 12px;
  }
  .summary-card strong {
    font-size: 18px;
  }
  .view-tabs {
    gap: 8px;
    padding-bottom: 14px;
  }
  .view-tab {
    flex: 1;
    padding: 10px 8px;
    font-size: 12.5px;
    text-align: center;
  }
  .trade-form {
    padding: 16px;
  }
  /* 16px evita que iOS haga zoom automático al enfocar el campo */
  .form-field input,
  .form-field select,
  .ratio-input,
  .ccl-input-row input {
    font-size: 16px;
  }
  .entry-card {
    padding: 16px;
  }
  .entry-card-grid {
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 12px;
  }
  .form-actions {
    flex-direction: column;
  }
  .form-actions button {
    width: 100%;
  }
  .table-header-row {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }
  .search-box {
    width: 100%;
    max-width: none;
    min-width: 0;
  }
  .search-box input {
    width: 100%;
    font-size: 16px;
  }
  .pagination-bar {
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
  }
}
</style>