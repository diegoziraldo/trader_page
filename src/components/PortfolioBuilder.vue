<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import {
  getPortfolios,
  createPortfolio,
  updatePortfolio,
  deletePortfolio,
  getPositions,
  createPosition,
  updatePosition,
  deletePosition,
} from '../services/portfoliosService'
import { fetchQuote, getTheoreticalCedear } from '../services/stockService'
import { useDolar } from '../composables/useDolar'
import { PORTFOLIO_ASSET_BY_TICKER } from '../data/argentinePortfolioAssets'
import { recordSnapshot, seedFromInception, getDailySeries, getMonthlySeries } from '../services/local/portfolioHistoryLocal'
import Chart from 'chart.js/auto'
import { getTrades } from '../services/tradesService'

const emit = defineEmits(['close'])

// --- Dólar CCL en vivo, para valuar en USD las posiciones sin ratio ---
const { dolares } = useDolar()
const ccl = computed(() => dolares.value?.contadoconliqui?.venta ?? null)

const portfolios = ref([])
const selectedId = ref(null)
const positions = ref([])
const loading = ref(true)
const loadingPositions = ref(false)
const errorMsg = ref('')
const saving = ref(false)

const newPortfolioName = ref('')
const renamingId = ref(null)
const renameValue = ref('')

// --- Precios en vivo del subyacente (Finnhub), por ticker underlying ---
const livePrices = ref({}) // { TICKER: { price, loading, error } }
const REFRESH_MS = 30_000
let refreshTimer = null

const selectedPortfolio = computed(() => portfolios.value.find((p) => p.id === selectedId.value) || null)

async function loadPortfolios() {
  loading.value = true
  errorMsg.value = ''
  try {
    portfolios.value = await getPortfolios()
    if (!selectedId.value && portfolios.value.length) {
      selectedId.value = portfolios.value[0].id
    }
  } catch (e) {
    errorMsg.value = e.message
  } finally {
    loading.value = false
  }
}

async function loadPositions() {
  if (!selectedId.value) {
    positions.value = []
    return
  }
  loadingPositions.value = true
  try {
    positions.value = await getPositions(selectedId.value)
    await refreshLivePrices()
  } catch (e) {
    errorMsg.value = e.message
  } finally {
    loadingPositions.value = false
  }
}

async function selectPortfolio(id) {
  selectedId.value = id
  selectedTicker.value = null
  await loadPositions()
  recordTodaySnapshot()
}

async function addPortfolio() {
  const name = newPortfolioName.value.trim()
  if (!name) return
  try {
    const created = await createPortfolio({ name })
    portfolios.value.push(created)
    newPortfolioName.value = ''
    await selectPortfolio(created.id)
  } catch (e) {
    errorMsg.value = e.message
  }
}

function startRename(portfolio) {
  renamingId.value = portfolio.id
  renameValue.value = portfolio.name
}

async function confirmRename() {
  const name = renameValue.value.trim()
  if (!name) return (renamingId.value = null)
  try {
    const updated = await updatePortfolio(renamingId.value, { name })
    const idx = portfolios.value.findIndex((p) => p.id === renamingId.value)
    if (idx !== -1) portfolios.value[idx] = updated
  } catch (e) {
    errorMsg.value = e.message
  } finally {
    renamingId.value = null
  }
}

async function removePortfolio(portfolio) {
  const ok = window.confirm(`¿Borrar la cartera "${portfolio.name}" y todas sus posiciones?`)
  if (!ok) return
  try {
    await deletePortfolio(portfolio.id)
    portfolios.value = portfolios.value.filter((p) => p.id !== portfolio.id)
    if (selectedId.value === portfolio.id) {
      selectedId.value = portfolios.value[0]?.id ?? null
      await loadPositions()
    }
  } catch (e) {
    errorMsg.value = e.message
  }
}

// =========================================================
// FORMULARIO DE POSICIÓN
// =========================================================
function emptyForm() {
  return {
    assetType: 'CEDEAR',
    ticker: '',
    underlyingTicker: '',
    ratio: '',
    sector: 'General',
    quantity: '',
    avgPrice: '',
    targetWeight: '',
    manualPrice: '',
  }
}

const form = reactive(emptyForm())
const formError = ref('')
const editingPositionId = ref(null)

// Detección automática de beta: si el ticker que escribiste a mano coincide
// con uno del catálogo (src/data/argentinePortfolioAssets.js), se muestra
// como referencia junto al campo. No fuerza nada — el resto de los campos
// (tipo de activo, sector, subyacente, ratio) siempre se cargan a mano.
const detectedAsset = computed(() => PORTFOLIO_ASSET_BY_TICKER[form.ticker.trim().toUpperCase()] || null)

const SECTORS = [
  'General', 'Tecnología', 'Financiero', 'Energía', 'Consumo', 'Salud',
  'Industrial', 'Materiales', 'Utilities', 'Comunicación', 'Real Estate',
]

function startEditPosition(pos) {
  editingPositionId.value = pos.id
  form.assetType = pos.assetType
  form.ticker = pos.ticker
  form.underlyingTicker = pos.underlyingTicker
  form.ratio = pos.ratio ?? ''
  form.sector = pos.sector
  form.quantity = pos.quantity
  form.avgPrice = pos.avgPrice
  form.targetWeight = pos.targetWeight ?? ''
  form.manualPrice = pos.manualPrice ?? ''
  formError.value = ''
}

function cancelEditPosition() {
  editingPositionId.value = null
  Object.assign(form, emptyForm())
  formError.value = ''
}

async function submitPosition() {
  formError.value = ''
  const ticker = form.ticker.trim().toUpperCase()

  if (!ticker) return (formError.value = 'Ingresá un ticker')
  if (!(Number(form.quantity) > 0)) return (formError.value = 'La cantidad debe ser mayor a 0')
  if (!(Number(form.avgPrice) > 0)) return (formError.value = 'El precio promedio debe ser mayor a 0')
  if (form.ratio !== '' && !(Number(form.ratio) > 0)) return (formError.value = 'El ratio debe ser mayor a 0')
  if (form.targetWeight !== '' && (Number(form.targetWeight) < 0 || Number(form.targetWeight) > 100)) {
    return (formError.value = 'El peso objetivo debe estar entre 0 y 100')
  }

  const payload = {
    assetType: form.assetType,
    ticker,
    underlyingTicker: form.assetType === 'CEDEAR' ? form.underlyingTicker.trim().toUpperCase() || ticker : '',
    ratio: form.assetType === 'CEDEAR' && form.ratio !== '' ? Number(form.ratio) : null,
    sector: form.sector || 'General',
    quantity: Number(form.quantity),
    avgPrice: Number(form.avgPrice),
    targetWeight: form.targetWeight !== '' ? Number(form.targetWeight) : null,
    manualPrice: form.manualPrice !== '' ? Number(form.manualPrice) : null,
  }

  saving.value = true
  try {
    if (editingPositionId.value) {
      const updated = await updatePosition(editingPositionId.value, payload)
      const idx = positions.value.findIndex((p) => p.id === editingPositionId.value)
      if (idx !== -1) positions.value[idx] = updated
    } else {
      const created = await createPosition(selectedId.value, payload)
      positions.value.push(created)
    }
    cancelEditPosition()
    await refreshLivePrices()
  } catch (e) {
    formError.value = e.message
  } finally {
    saving.value = false
  }
}

async function removePositionRow(pos) {
  const ok = window.confirm(`¿Borrar la posición de ${pos.ticker}?`)
  if (!ok) return
  try {
    await deletePosition(pos.id)
    positions.value = positions.value.filter((p) => p.id !== pos.id)
    if (editingPositionId.value === pos.id) cancelEditPosition()
  } catch (e) {
    errorMsg.value = e.message
  }
}

// =========================================================
// IMPORTAR DESDE "MIS TRADES": arma una posición por cada ticker con
// tenencia neta positiva (COMPRAs - VENTAs > 0), usando la fecha de la
// compra MÁS ANTIGUA de ese ticker como fecha de alta de la posición (así
// el gráfico de evolución arranca desde ahí, no desde hoy) y el costo
// promedio ponderado de las compras como precio promedio.
const importing = ref(false)
const importResult = ref(null)

// =========================================================
// CORREGIR SECTORES YA CARGADOS: para posiciones que quedaron en "General"
// (por ejemplo, las que ya importaste antes de este fix), busca el sector
// real en el catálogo por ticker y lo actualiza. No toca posiciones cuyo
// sector ya fue cambiado a mano a otra cosa distinta de "General".
const fixingSectors = ref(false)
const fixSectorsResult = ref(null)

async function fixSectorsFromCatalog() {
  if (!selectedId.value) return
  fixingSectors.value = true
  errorMsg.value = ''
  fixSectorsResult.value = null
  try {
    let fixed = 0
    let noMatch = 0
    for (const p of positions.value) {
      if (p.sector !== 'General') continue
      const catalogSector = PORTFOLIO_ASSET_BY_TICKER[p.ticker]?.sector
      if (!catalogSector) {
        noMatch++
        continue
      }
      const updatedPos = await updatePosition(p.id, { sector: catalogSector })
      const idx = positions.value.findIndex((pos) => pos.id === p.id)
      if (idx !== -1) positions.value[idx] = updatedPos
      fixed++
    }
    fixSectorsResult.value = { fixed, noMatch }
  } catch (e) {
    errorMsg.value = e.message
  } finally {
    fixingSectors.value = false
  }
}

async function importFromTrades() {
  if (!selectedId.value || !selectedPortfolio.value) return
  const ok = window.confirm(
    `Esto va a sincronizar la cartera "${selectedPortfolio.value.name}" con "Mis Trades": crea una posición ` +
    `nueva por cada ticker que todavía no tenga (con la fecha de tu primera compra), actualiza cantidad/precio ` +
    `promedio si compraste o vendiste algo más, y BORRA la posición si vendiste el ticker por completo (tenencia ` +
    `neta cero). ¿Continuar?`
  )
  if (!ok) return

  importing.value = true
  errorMsg.value = ''
  importResult.value = null
  try {
    const trades = await getTrades()

    // Agrupar por ticker: tenencia neta, y lista de compras (fecha, cantidad, precio).
    const byTicker = {}
    for (const t of trades) {
      if (!byTicker[t.ticker]) byTicker[t.ticker] = { assetType: t.assetType, buys: [], netQty: 0 }
      const entry = byTicker[t.ticker]
      const qty = Number(t.quantity)
      if (t.operation === 'COMPRA') {
        entry.buys.push({ date: t.date, qty, price: Number(t.price) })
        entry.netQty += qty
      } else {
        entry.netQty -= qty
      }
    }

    const existingByTicker = new Map(positions.value.map((p) => [p.ticker, p]))
    let created = 0
    let updated = 0
    let removed = 0
    let skippedClosed = 0

    for (const [ticker, data] of Object.entries(byTicker)) {
      const existing = existingByTicker.get(ticker)
      const totalCost = data.buys.reduce((acc, b) => acc + b.qty * b.price, 0)
      const totalQtyBought = data.buys.reduce((acc, b) => acc + b.qty, 0)
      const avgPrice = totalQtyBought > 0 ? totalCost / totalQtyBought : null

      if (existing) {
        if (data.netQty > 0) {
          // Ya existía: actualizamos cantidad/precio (mantiene su fecha de alta original).
          const payload = { quantity: data.netQty }
          if (avgPrice != null) payload.avgPrice = avgPrice
          const updatedPos = await updatePosition(existing.id, payload)
          const idx = positions.value.findIndex((p) => p.id === existing.id)
          if (idx !== -1) positions.value[idx] = updatedPos
          updated++
        } else {
          // Vendida por completo: se borra la posición de la cartera.
          await deletePosition(existing.id)
          positions.value = positions.value.filter((p) => p.id !== existing.id)
          removed++
        }
        continue
      }

      if (!(data.netQty > 0) || !data.buys.length) {
        skippedClosed++
        continue
      }

      const earliestBuyDate = data.buys.reduce((min, b) => (b.date < min ? b.date : min), data.buys[0].date)
      // "Mis Trades" no guarda sector, pero si el ticker está en nuestro
      // catálogo (src/data/argentinePortfolioAssets.js) lo tomamos de ahí
      // en vez de dejarlo en "General".
      const catalogSector = PORTFOLIO_ASSET_BY_TICKER[ticker]?.sector
      const createdPos = await createPosition(selectedId.value, {
        assetType: data.assetType,
        ticker,
        quantity: data.netQty,
        avgPrice,
        createdAt: earliestBuyDate,
        sector: catalogSector,
      })
      positions.value.push(createdPos)
      created++
    }

    await refreshLivePrices()
    recordTodaySnapshot()
    importResult.value = { created, updated, removed, skippedClosed }
  } catch (e) {
    errorMsg.value = e.message
  } finally {
    importing.value = false
  }
}

// =========================================================
// PRECIOS EN VIVO (Finnhub, vía stockService — solo para el subyacente de
// los CEDEARs; las acciones argentinas usan el precio manual porque
// Finnhub free tier no cubre BYMA).
// =========================================================
async function refreshLivePrices() {
  const underlyings = [
    ...new Set(
      positions.value
        .filter((p) => p.assetType === 'CEDEAR' && p.underlyingTicker)
        .map((p) => p.underlyingTicker)
    ),
  ]
  await Promise.all(
    underlyings.map(async (symbol) => {
      livePrices.value[symbol] = { ...(livePrices.value[symbol] || {}), loading: true, error: null }
      try {
        const q = await fetchQuote(symbol)
        livePrices.value[symbol] = { price: q.price, loading: false, error: null }
      } catch (e) {
        livePrices.value[symbol] = { price: livePrices.value[symbol]?.price ?? null, loading: false, error: e.message }
      }
    })
  )
}

// =========================================================
// CÁLCULOS DE LA CARTERA: valuación, peso, P&L, diversificación
// =========================================================
function formatMoney(n) {
  if (n === null || n === undefined) return '—'
  return (Number(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatPct(n) {
  if (n === null || n === undefined) return '—'
  const sign = n >= 0 ? '+' : ''
  return `${sign}${n.toFixed(2)}%`
}

function formatDateShort(dateISO) {
  if (!dateISO) return '—'
  const [y, m, d] = dateISO.split('-')
  return `${d}/${m}/${y}`
}

const positionsComputed = computed(() =>
  positions.value.map((p) => {
    const isCedear = p.assetType === 'CEDEAR'
    const invested = p.quantity * p.avgPrice

    // Precio real de la acción subyacente en USD (Finnhub), si se cargó.
    const underlyingLive = isCedear && p.underlyingTicker ? livePrices.value[p.underlyingTicker] : null
    const underlyingPriceUSD = underlyingLive?.price ?? null
    const usesRatioValuation = isCedear && p.ratio != null && underlyingPriceUSD != null

    let currentPriceARS = null
    let marketValueUSD = null

    if (usesRatioValuation) {
      currentPriceARS = ccl.value ? getTheoreticalCedear(underlyingPriceUSD, p.ratio, ccl.value) : null
      marketValueUSD = (p.quantity / p.ratio) * underlyingPriceUSD
    } else if (p.manualPrice != null) {
      currentPriceARS = p.manualPrice
      marketValueUSD = ccl.value ? (p.quantity * p.manualPrice) / ccl.value : null
    }

    const marketValueARS = currentPriceARS != null ? p.quantity * currentPriceARS : null
    const unrealizedARS = marketValueARS != null ? marketValueARS - invested : null
    const unrealizedARSPct = marketValueARS != null && invested > 0 ? (unrealizedARS / invested) * 100 : null

    return {
      ...p,
      invested,
      currentPriceARS,
      marketValueARS,
      marketValueUSD,
      unrealizedARS,
      unrealizedARSPct,
      usesRatioValuation,
      hasLivePrice: currentPriceARS != null,
      underlyingLoading: underlyingLive?.loading ?? false,
      underlyingError: underlyingLive?.error ?? null,
      beta: PORTFOLIO_ASSET_BY_TICKER[p.ticker]?.beta ?? null,
    }
  })
)

// Valor de cada posición para calcular pesos: valor de mercado si se conoce,
// si no, el costo (avgPrice × cantidad) como mejor aproximación disponible.
function displayValue(p) {
  return p.marketValueARS ?? p.invested
}

const totalValueARS = computed(() => positionsComputed.value.reduce((acc, p) => acc + displayValue(p), 0))
const totalInvestedARS = computed(() => positionsComputed.value.reduce((acc, p) => acc + p.invested, 0))
const totalValueUSD = computed(() => {
  const known = positionsComputed.value.filter((p) => p.marketValueUSD != null)
  if (!known.length) return null
  return known.reduce((acc, p) => acc + p.marketValueUSD, 0)
})
const totalUnrealizedARS = computed(() => totalValueARS.value - totalInvestedARS.value)
const totalUnrealizedARSPct = computed(() =>
  totalInvestedARS.value > 0 ? (totalUnrealizedARS.value / totalInvestedARS.value) * 100 : null
)
const allPricesKnown = computed(() => positionsComputed.value.every((p) => p.hasLivePrice))

const positionsWithWeight = computed(() =>
  positionsComputed.value.map((p) => {
    const value = displayValue(p)
    const weight = totalValueARS.value > 0 ? (value / totalValueARS.value) * 100 : 0
    const weightDelta = p.targetWeight != null ? weight - p.targetWeight : null
    return { ...p, weight, weightDelta }
  }).sort((a, b) => b.weight - a.weight)
)

// Índice de concentración (Herfindahl-Hirschman, sobre pesos 0-100),
// normalizado a una escala de 0 (perfectamente diversificada) a 100
// (una sola posición concentra toda la cartera).
const concentrationIndex = computed(() => {
  if (!positionsWithWeight.value.length) return 0
  return positionsWithWeight.value.reduce((acc, p) => acc + Math.pow(p.weight / 100, 2), 0) * 100
})

function concentrationLabel(idx) {
  if (idx <= 20) return 'Bien diversificada'
  if (idx <= 40) return 'Moderadamente concentrada'
  return 'Muy concentrada'
}

// Paleta fija por sector, para que una empresa y su sector se vean siempre
// con el mismo color entre los tres desgloses (tipo, sector y empresa).
const SECTOR_COLORS = {
  'Tecnología': '#3b82f6',
  'Financiero': '#22c55e',
  'Energía': '#f97316',
  'Consumo': '#eab308',
  'Salud': '#ec4899',
  'Industrial': '#94a3b8',
  'Materiales': '#a16207',
  'Utilities': '#06b6d4',
  'Comunicación': '#8b5cf6',
  'Real Estate': '#14b8a6',
  'General': '#6b7280',
}
function sectorColor(sector) {
  return SECTOR_COLORS[sector] || SECTOR_COLORS.General
}

function breakdownBy(keyFn, sectorFn = null) {
  const map = {}
  for (const p of positionsWithWeight.value) {
    const key = keyFn(p) || 'Sin clasificar'
    if (!map[key]) map[key] = { value: 0, sector: sectorFn ? sectorFn(p) : null }
    map[key].value += displayValue(p)
  }
  const total = totalValueARS.value
  return Object.entries(map)
    .map(([label, { value, sector }]) => ({
      label,
      value,
      sector,
      pct: total > 0 ? (value / total) * 100 : 0,
    }))
    .sort((a, b) => b.pct - a.pct)
}

const breakdownByType = computed(() =>
  breakdownBy((p) => (p.assetType === 'CEDEAR' ? 'CEDEARs' : 'Acciones argentinas'))
)
const breakdownBySector = computed(() => breakdownBy((p) => p.sector))
const breakdownByCompany = computed(() => breakdownBy((p) => p.ticker, (p) => p.sector))

// =========================================================
// BETA PONDERADA DE LA CARTERA Y PERFIL DE INVERSOR
// =========================================================
// Beta ponderado = Σ(peso_i × beta_i) de las posiciones con beta conocido
// (papeles del catálogo). Se renormaliza sobre el peso de esas posiciones,
// para que los papeles sin beta cargado (tickers manuales, fuera del
// catálogo) no distorsionen el promedio en lugar de simplemente quedar
// afuera del cálculo.
const positionsWithKnownBeta = computed(() => positionsWithWeight.value.filter((p) => p.beta != null))
const knownBetaWeightSum = computed(() => positionsWithKnownBeta.value.reduce((acc, p) => acc + p.weight, 0))
const betaCoveragePct = computed(() => knownBetaWeightSum.value) // % de la cartera con beta conocido

const portfolioBeta = computed(() => {
  if (!positionsWithKnownBeta.value.length || knownBetaWeightSum.value <= 0) return null
  const weighted = positionsWithKnownBeta.value.reduce((acc, p) => acc + p.beta * p.weight, 0)
  return weighted / knownBetaWeightSum.value
})

// Clasificación orientativa: beta < 1 implica menor volatilidad que el
// mercado de referencia, beta > 1 implica mayor volatilidad. Son umbrales
// de uso común en educación financiera, no una regla universal.
function investorProfileFromBeta(beta) {
  if (beta == null) return null
  if (beta < 0.85) return { label: 'Conservador', detail: 'la cartera se mueve menos que el mercado de referencia' }
  if (beta <= 1.15) return { label: 'Moderado', detail: 'la cartera se mueve en línea con el mercado de referencia' }
  return { label: 'Agresivo', detail: 'la cartera se mueve más que el mercado de referencia' }
}
const investorProfile = computed(() => investorProfileFromBeta(portfolioBeta.value))

// Diagnóstico de diversificación: combina el índice de concentración (HHI)
// con la cantidad de sectores distintos representados.
const diversificationVerdict = computed(() => {
  const hhi = concentrationIndex.value
  const sectorCount = breakdownBySector.value.length
  if (!positionsWithWeight.value.length) return null
  if (hhi <= 20 && sectorCount >= 4) {
    return { label: 'Bien diversificada', detail: `repartida en ${sectorCount} sectores, sin posiciones dominantes` }
  }
  if (hhi <= 40 && sectorCount >= 3) {
    return { label: 'Moderadamente diversificada', detail: `${sectorCount} sectores, pero con algo de concentración` }
  }
  return { label: 'Poco diversificada', detail: sectorCount <= 2 ? `solo ${sectorCount} sector(es) representado(s)` : 'hay posiciones que concentran gran parte del valor' }
})

// =========================================================
// GRÁFICOS: evolución por papel (clic en "Por empresa") + línea general
// =========================================================
const positionCanvas = ref(null)
const lineCanvas = ref(null)
let positionChart = null
let lineChart = null

const performanceView = ref('DIARIO') // 'DIARIO' | 'MENSUAL', comparte ambos gráficos
const historyTick = ref(0) // se incrementa cada vez que grabamos un snapshot, para recalcular las series
const showDebug = ref(false)
const selectedTicker = ref(null) // ticker elegido en "Por empresa" para el gráfico de evolución

function positionHistoryKey(ticker) {
  return `pos:${selectedId.value}:${ticker}`
}

function positionsForTicker(ticker) {
  return positionsComputed.value.filter((p) => p.ticker === ticker)
}

function tickerInceptionDate(ticker) {
  const dates = positionsForTicker(ticker).map((p) => p.createdAt).filter(Boolean)
  if (!dates.length) return null
  return dates.reduce((earliest, d) => (d < earliest ? d : earliest)).slice(0, 10)
}

const debugInfo = computed(() => {
  historyTick.value
  if (!selectedId.value) return ''
  let rawHistory = null
  try { rawHistory = localStorage.getItem('pf-history:' + selectedId.value) } catch { rawHistory = '(error leyendo localStorage)' }
  let rawPosition = null
  if (selectedTicker.value) {
    try { rawPosition = localStorage.getItem('pf-history:' + positionHistoryKey(selectedTicker.value)) } catch { rawPosition = '(error leyendo localStorage)' }
  }
  return JSON.stringify({
    portfolioId: selectedId.value,
    inceptionDate: inceptionDate.value,
    totalValueARS: totalValueARS.value,
    totalInvestedARS: totalInvestedARS.value,
    history: rawHistory ? JSON.parse(rawHistory) : null,
    selectedTicker: selectedTicker.value,
    tickerHistory: rawPosition ? JSON.parse(rawPosition) : null,
  }, null, 2)
})

// Grabar el snapshot de hoy: el total de la cartera Y, por separado, el
// valor de cada papel (agrupado por ticker, por si hay más de una posición
// del mismo ticker), para poder graficar la evolución individual de cada
// uno con la misma lógica que el gráfico general.
function recordTodaySnapshot() {
  if (!selectedId.value) return
  if (totalValueARS.value > 0) {
    seedFromInception(selectedId.value, inceptionDate.value, totalInvestedARS.value)
    recordSnapshot(selectedId.value, totalValueARS.value)
  }
  const tickers = [...new Set(positionsComputed.value.map((p) => p.ticker))]
  for (const ticker of tickers) {
    const rows = positionsForTicker(ticker)
    const invested = rows.reduce((acc, p) => acc + p.invested, 0)
    const current = rows.reduce((acc, p) => acc + (p.marketValueARS ?? p.invested), 0)
    const key = positionHistoryKey(ticker)
    if (invested > 0) seedFromInception(key, tickerInceptionDate(ticker), invested)
    if (current > 0) recordSnapshot(key, current)
  }
  historyTick.value++
}

// Fecha de alta de la cartera: la más antigua entre la fecha de creación de
// la cartera y la de sus posiciones (así, si agregaste una posición hace un
// mes, el gráfico arranca ahí en vez de "hoy").
const inceptionDate = computed(() => {
  const dates = positions.value.map((p) => p.createdAt).filter(Boolean)
  if (selectedPortfolio.value?.createdAt) dates.push(selectedPortfolio.value.createdAt)
  if (!dates.length) return null
  return dates.reduce((earliest, d) => (d < earliest ? d : earliest)).slice(0, 10)
})

const dailySeries = computed(() => {
  historyTick.value // dependencia reactiva
  return selectedId.value ? getDailySeries(selectedId.value, 90) : { labels: [], values: [], dates: [] }
})
const monthlySeries = computed(() => {
  historyTick.value
  return selectedId.value ? getMonthlySeries(selectedId.value, 24) : { labels: [], values: [], dates: [] }
})
const activeSeries = computed(() => (performanceView.value === 'DIARIO' ? dailySeries.value : monthlySeries.value))
const hasEnoughHistory = computed(() => activeSeries.value.values.length > 0)
// Rendimiento acumulado desde el primer punto de la serie activa hasta hoy,
// para mostrar como dato de contexto (no reemplaza la curva de valor).
const seriesReturnPct = computed(() => {
  const vals = activeSeries.value.values
  if (vals.length < 2 || !(vals[0] > 0)) return null
  return ((vals[vals.length - 1] - vals[0]) / vals[0]) * 100
})

// Serie de evolución del papel seleccionado en "Por empresa", con la misma
// mecánica (diario/mensual) que el gráfico general de la cartera.
const positionSeries = computed(() => {
  historyTick.value
  if (!selectedId.value || !selectedTicker.value) return { labels: [], values: [], dates: [] }
  const key = positionHistoryKey(selectedTicker.value)
  return performanceView.value === 'DIARIO' ? getDailySeries(key, 90) : getMonthlySeries(key, 24)
})
const hasPositionHistory = computed(() => positionSeries.value.values.length > 0)
const positionReturnPct = computed(() => {
  const vals = positionSeries.value.values
  if (vals.length < 2 || !(vals[0] > 0)) return null
  return ((vals[vals.length - 1] - vals[0]) / vals[0]) * 100
})

function selectTickerForChart(ticker) {
  selectedTicker.value = ticker
  nextTick(renderPositionChart)
}

function renderLineChart() {
  if (!lineCanvas.value) return
  const { labels, values } = activeSeries.value
  if (lineChart) lineChart.destroy()
  if (!values.length) return
  const base = values[0]
  const label = performanceView.value === 'DIARIO' ? 'Valor de la cartera (ARS) — diario' : 'Valor de la cartera (ARS) — mensual'
  lineChart = new Chart(lineCanvas.value, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label,
        data: values,
        borderColor: '#2563eb',
        backgroundColor: 'rgba(37, 99, 235, 0.15)',
        pointBackgroundColor: values.map((v) => (v >= base ? '#22c55e' : '#ef4444')),
        pointRadius: values.length > 1 ? 3 : 5,
        tension: 0.25,
        fill: true,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { ticks: { color: '#b0b4bc', font: { size: 11 } }, grid: { color: 'rgba(255,255,255,0.06)' } },
        y: {
          ticks: {
            color: '#b0b4bc',
            font: { size: 11 },
            callback: (v) => `$${Number(v).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`,
          },
          grid: { color: 'rgba(255,255,255,0.06)' },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const v = ctx.parsed.y
              const pct = base > 0 ? ((v - base) / base) * 100 : 0
              const sign = pct >= 0 ? '+' : ''
              return `$${v.toLocaleString('es-AR', { maximumFractionDigits: 0 })}  (${sign}${pct.toFixed(2)}% desde el inicio)`
            },
          },
        },
      },
    },
  })
}

function renderPositionChart() {
  if (!positionCanvas.value) return
  const { labels, values } = positionSeries.value
  if (positionChart) positionChart.destroy()
  if (!values.length) return
  const base = values[0]
  const color = selectedTicker.value ? sectorColor(PORTFOLIO_ASSET_BY_TICKER[selectedTicker.value]?.sector) : '#2563eb'
  positionChart = new Chart(positionCanvas.value, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: `Valor de ${selectedTicker.value} (ARS)`,
        data: values,
        borderColor: color,
        backgroundColor: color + '26',
        pointBackgroundColor: values.map((v) => (v >= base ? '#22c55e' : '#ef4444')),
        pointRadius: values.length > 1 ? 3 : 5,
        tension: 0.25,
        fill: true,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { ticks: { color: '#b0b4bc', font: { size: 11 } }, grid: { color: 'rgba(255,255,255,0.06)' } },
        y: {
          ticks: {
            color: '#b0b4bc',
            font: { size: 11 },
            callback: (v) => `$${Number(v).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`,
          },
          grid: { color: 'rgba(255,255,255,0.06)' },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const v = ctx.parsed.y
              const pct = base > 0 ? ((v - base) / base) * 100 : 0
              const sign = pct >= 0 ? '+' : ''
              return `$${v.toLocaleString('es-AR', { maximumFractionDigits: 0 })}  (${sign}${pct.toFixed(2)}% desde el alta)`
            },
          },
        },
      },
    },
  })
}

watch(breakdownByCompany, () => {
  // si todavía no eligieron un papel, mostramos por defecto el de mayor peso
  if (!selectedTicker.value && breakdownByCompany.value.length) {
    selectedTicker.value = breakdownByCompany.value[0].label
  }
  nextTick(renderPositionChart)
}, { deep: true, immediate: true })
watch(positionSeries, () => nextTick(renderPositionChart), { deep: true })
watch(activeSeries, () => nextTick(renderLineChart), { deep: true })
watch(performanceView, () => {
  nextTick(renderLineChart)
  nextTick(renderPositionChart)
})
watch(totalValueARS, (val) => {
  if (val > 0) recordTodaySnapshot()
})

onMounted(async () => {
  await loadPortfolios()
  await loadPositions()
  recordTodaySnapshot()
  await nextTick()
  renderPositionChart()
  renderLineChart()
  refreshTimer = setInterval(refreshLivePrices, REFRESH_MS)
})

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer)
  if (positionChart) positionChart.destroy()
  if (lineChart) lineChart.destroy()
})

function close() {
  emit('close')
}

function onOverlayClick(e) {
  if (e.target === e.currentTarget) close()
}
</script>

<template>
  <div class="pf-overlay" @click="onOverlayClick">
    <div class="pf-modal">
      <div class="pf-header">
        <div class="pf-title">
          <span class="pf-icon">🧩</span>
          Armado de Carteras
          <span class="build-tag" title="Si este número no cambió después de un deploy nuevo, el navegador está sirviendo el JS viejo (caché) y hay que forzar una recarga.">build 2026-09-26.6</span>
        </div>
        <button class="close-btn" @click="close" title="Cerrar">✕</button>
      </div>

      <div v-if="loading" class="pf-loading">Cargando carteras...</div>

      <template v-else>
        <div v-if="errorMsg" class="pf-error">{{ errorMsg }}</div>

        <div class="pf-layout">
          <!-- Sidebar: lista de carteras -->
          <div class="pf-sidebar">
            <div class="pf-sidebar-title">Mis carteras</div>
            <div class="pf-portfolio-list">
              <div
                v-for="p in portfolios"
                :key="p.id"
                class="pf-portfolio-item"
                :class="{ active: p.id === selectedId }"
              >
                <template v-if="renamingId === p.id">
                  <input
                    v-model="renameValue"
                    class="pf-rename-input"
                    @keyup.enter="confirmRename"
                    @keyup.esc="renamingId = null"
                    @blur="confirmRename"
                    autofocus
                  >
                </template>
                <template v-else>
                  <button type="button" class="pf-portfolio-name" @click="selectPortfolio(p.id)">
                    {{ p.name }}
                  </button>
                  <div class="pf-portfolio-actions">
                    <button class="icon-btn" title="Renombrar" @click="startRename(p)">✎</button>
                    <button class="icon-btn icon-btn-danger" title="Eliminar" @click="removePortfolio(p)">🗑</button>
                  </div>
                </template>
              </div>
              <div v-if="!portfolios.length" class="empty-state-small">
                Todavía no creaste ninguna cartera.
              </div>
            </div>

            <form class="pf-new-portfolio" @submit.prevent="addPortfolio">
              <input v-model="newPortfolioName" placeholder="Nombre de la cartera nueva">
              <button type="submit" class="btn-primary btn-small">+ Crear</button>
            </form>
          </div>

          <!-- Panel principal: cartera seleccionada -->
          <div class="pf-main">
            <div v-if="!selectedPortfolio" class="empty-state">
              Creá una cartera para empezar a armarla.
            </div>

            <template v-else>
              <div v-if="loadingPositions" class="pf-loading">Cargando posiciones...</div>

              <template v-else>
                <!-- Resumen de la cartera -->
                <div class="summary-bar">
                  <div class="summary-card">
                    <span class="summary-label">Valor total (ARS)</span>
                    <strong>${{ formatMoney(totalValueARS) }}</strong>
                  </div>
                  <div class="summary-card">
                    <span class="summary-label">Valor total (USD)</span>
                    <strong>{{ totalValueUSD != null ? `US$${formatMoney(totalValueUSD)}` : '—' }}</strong>
                  </div>
                  <div class="summary-card">
                    <span class="summary-label">Rendimiento no realizado</span>
                    <strong :class="totalUnrealizedARS >= 0 ? 'pl-pos' : 'pl-neg'">
                      {{ totalUnrealizedARS >= 0 ? '+' : '' }}${{ formatMoney(totalUnrealizedARS) }}
                      <span class="pct-tag">({{ formatPct(totalUnrealizedARSPct) }})</span>
                    </strong>
                  </div>
                  <div class="summary-card">
                    <span class="summary-label">Posiciones</span>
                    <strong>{{ positions.length }}</strong>
                  </div>
                  <div class="summary-card">
                    <span class="summary-label" title="Índice Herfindahl-Hirschman normalizado (0-100): cuanto más alto, más concentrada la cartera en pocas posiciones.">
                      Concentración (HHI)
                    </span>
                    <strong>{{ formatMoney(concentrationIndex) }} <span class="concentration-tag">{{ concentrationLabel(concentrationIndex) }}</span></strong>
                  </div>
                  <div class="summary-card">
                    <span class="summary-label" title="Beta ponderado por peso de las posiciones con beta conocido (papeles del catálogo). Beta > 1 = más volátil que el mercado, < 1 = menos volátil.">
                      Beta ponderada
                    </span>
                    <strong>
                      {{ portfolioBeta != null ? formatMoney(portfolioBeta) : '—' }}
                      <span v-if="portfolioBeta != null && betaCoveragePct < 99" class="concentration-tag">
                        (cubre {{ formatMoney(betaCoveragePct) }}% de la cartera)
                      </span>
                    </strong>
                  </div>
                  <div class="summary-card">
                    <span class="summary-label">Perfil de la cartera</span>
                    <strong v-if="investorProfile">
                      <span class="badge" :class="'badge-profile-' + investorProfile.label.toLowerCase()">{{ investorProfile.label }}</span>
                    </strong>
                    <strong v-else>—</strong>
                  </div>
                  <div class="summary-card">
                    <span class="summary-label">Diversificación</span>
                    <strong v-if="diversificationVerdict">{{ diversificationVerdict.label }}</strong>
                    <strong v-else>—</strong>
                  </div>
                </div>
                <div v-if="investorProfile || diversificationVerdict" class="pf-hint">
                  <template v-if="investorProfile">
                    📈 Perfil <strong>{{ investorProfile.label }}</strong>: {{ investorProfile.detail }} (beta ponderada {{ formatMoney(portfolioBeta) }}).
                  </template>
                  <template v-if="diversificationVerdict">
                    <br>🧩 Diversificación: <strong>{{ diversificationVerdict.label }}</strong>, {{ diversificationVerdict.detail }}.
                  </template>
                  <br><span class="stacked-line-dim">El beta de cada papel es un valor de referencia aproximado (varía según la fuente y el período de cálculo); usalo como orientación de riesgo, no como dato exacto en tiempo real.</span>
                </div>
                <div v-if="!allPricesKnown && positions.length" class="pf-hint">
                  ⚠️ Algunas posiciones no tienen precio en vivo ni precio manual cargado: se están valuando por su
                  costo promedio, así que el peso, el valor total y el rendimiento pueden no reflejar el precio real de mercado.
                </div>

                <!-- Importar / sincronizar con Mis Trades -->
                <div class="import-trades-bar">
                  <button type="button" class="btn-secondary btn-small" :disabled="importing" @click="importFromTrades">
                    {{ importing ? 'Sincronizando...' : '🔄 Sincronizar con Mis Trades' }}
                  </button>
                  <span v-if="importResult" class="import-result-text">
                    {{ importResult.created }} nueva(s)
                    <template v-if="importResult.updated"> · {{ importResult.updated }} actualizada(s)</template>
                    <template v-if="importResult.removed"> · {{ importResult.removed }} borrada(s) (vendidas del todo)</template>
                    <template v-if="importResult.skippedClosed"> · {{ importResult.skippedClosed }} sin tenencia neta</template>
                  </span>
                  <button type="button" class="btn-secondary btn-small" :disabled="fixingSectors" @click="fixSectorsFromCatalog">
                    {{ fixingSectors ? 'Corrigiendo...' : '🔧 Corregir sectores desde catálogo' }}
                  </button>
                  <span v-if="fixSectorsResult" class="import-result-text">
                    {{ fixSectorsResult.fixed }} corregida(s)
                    <template v-if="fixSectorsResult.noMatch"> · {{ fixSectorsResult.noMatch }} sin match en el catálogo</template>
                  </span>
                </div>

                <!-- Diversificación -->
                <div v-if="positions.length" class="diversification-section">
                  <div class="sector-legend">
                    <span v-for="b in breakdownBySector" :key="b.label" class="legend-item">
                      <span class="legend-dot" :style="{ backgroundColor: sectorColor(b.label) }"></span>
                      {{ b.label }}
                    </span>
                  </div>
                  <div class="diversification-col">
                    <div class="section-title">Por tipo de activo</div>
                    <div v-for="b in breakdownByType" :key="b.label" class="bar-row">
                      <span class="bar-label">{{ b.label }}</span>
                      <div class="bar-track">
                        <div class="bar-fill" :style="{ width: b.pct + '%' }"></div>
                      </div>
                      <span class="bar-pct">{{ formatMoney(b.pct) }}%</span>
                    </div>
                  </div>
                  <div class="diversification-col">
                    <div class="section-title">Por sector</div>
                    <div v-for="b in breakdownBySector" :key="b.label" class="bar-row">
                      <span class="bar-label">{{ b.label }}</span>
                      <div class="bar-track">
                        <div class="bar-fill" :style="{ width: b.pct + '%', backgroundColor: sectorColor(b.label) }"></div>
                      </div>
                      <span class="bar-pct">{{ formatMoney(b.pct) }}%</span>
                    </div>
                  </div>
                  <div class="diversification-col">
                    <div class="section-title">Por empresa <span class="hint-inline">(clic para ver su evolución)</span></div>
                    <button
                      v-for="b in breakdownByCompany"
                      :key="b.label"
                      type="button"
                      class="bar-row bar-row-clickable"
                      :class="{ active: selectedTicker === b.label }"
                      @click="selectTickerForChart(b.label)"
                    >
                      <span class="bar-label" :title="b.sector">{{ b.label }}</span>
                      <div class="bar-track">
                        <div class="bar-fill" :style="{ width: b.pct + '%', backgroundColor: sectorColor(b.sector) }"></div>
                      </div>
                      <span class="bar-pct">{{ formatMoney(b.pct) }}%</span>
                    </button>
                  </div>
                </div>

                <!-- Gráficos: evolución del papel elegido + línea de la cartera -->
                <div v-if="positions.length" class="charts-section">
                  <div class="chart-card">
                    <div class="chart-card-header">
                      <div class="section-title">
                        {{ selectedTicker ? `Evolución de ${selectedTicker}` : 'Evolución por papel' }}
                        <span v-if="positionReturnPct != null" class="series-return" :class="positionReturnPct >= 0 ? 'pl-pos' : 'pl-neg'">
                          {{ positionReturnPct >= 0 ? '+' : '' }}{{ formatMoney(positionReturnPct) }}%
                        </span>
                      </div>
                    </div>
                    <div class="chart-canvas-wrap">
                      <canvas v-show="hasPositionHistory" ref="positionCanvas"></canvas>
                      <div v-if="!hasPositionHistory" class="empty-state-small chart-empty">
                        <template v-if="selectedTicker">
                          Grabando el historial de {{ selectedTicker }} (costo al alta: {{ formatDateShort(tickerInceptionDate(selectedTicker)) }})... esperá un instante.
                        </template>
                        <template v-else>Elegí un papel en "Por empresa" para ver su evolución.</template>
                      </div>
                    </div>
                  </div>
                  <div class="chart-card">
                    <div class="chart-card-header">
                      <div class="section-title">
                        Valor de la cartera desde el alta
                        <span v-if="seriesReturnPct != null" class="series-return" :class="seriesReturnPct >= 0 ? 'pl-pos' : 'pl-neg'">
                          {{ seriesReturnPct >= 0 ? '+' : '' }}{{ formatMoney(seriesReturnPct) }}%
                        </span>
                      </div>
                      <div class="view-toggle">
                        <button
                          type="button"
                          class="filter-btn"
                          :class="{ active: performanceView === 'DIARIO' }"
                          @click="performanceView = 'DIARIO'"
                        >Diario</button>
                        <button
                          type="button"
                          class="filter-btn"
                          :class="{ active: performanceView === 'MENSUAL' }"
                          @click="performanceView = 'MENSUAL'"
                        >Mensual</button>
                      </div>
                    </div>
                    <div class="chart-canvas-wrap">
                      <canvas v-show="hasEnoughHistory" ref="lineCanvas"></canvas>
                      <div v-if="!hasEnoughHistory" class="empty-state-small chart-empty">
                        Grabando el primer punto del historial (costo al alta: {{ formatDateShort(inceptionDate) }})... esto tarda un instante.
                      </div>
                    </div>
                    <button type="button" class="debug-toggle" @click="showDebug = !showDebug">
                      {{ showDebug ? 'Ocultar' : 'Ver' }} datos del historial guardado
                    </button>
                    <pre v-if="showDebug" class="debug-panel">{{ debugInfo }}</pre>
                  </div>
                </div>

                <!-- Formulario de posición -->
                <form class="pf-form" @submit.prevent="submitPosition">
                  <div class="section-title">{{ editingPositionId ? 'Editar posición' : 'Agregar posición' }}</div>
                  <div class="form-grid">
                    <div class="form-field">
                      <label>Ticker</label>
                      <input type="text" v-model="form.ticker" placeholder="Ej: AAPL, GGAL" style="text-transform:uppercase" required>
                      <span v-if="detectedAsset" class="field-hint">β {{ detectedAsset.beta }} de referencia · {{ detectedAsset.sector }}</span>
                    </div>
                    <div class="form-field">
                      <label>Tipo de activo</label>
                      <select v-model="form.assetType">
                        <option value="CEDEAR">CEDEAR</option>
                        <option value="ACCION_AR">Acción argentina</option>
                      </select>
                    </div>
                    <template v-if="form.assetType === 'CEDEAR'">
                      <div class="form-field">
                        <label title="Ticker de la acción en EE.UU. para traer el precio en vivo (Finnhub). Si lo dejás vacío, se usa el mismo ticker.">
                          Ticker subyacente (USA)
                        </label>
                        <input type="text" v-model="form.underlyingTicker" placeholder="Ej: AAPL" style="text-transform:uppercase">
                      </div>
                      <div class="form-field">
                        <label title="Cuántos CEDEARs equivalen a 1 acción. Con esto se valúa en USD contra el precio real de la acción.">
                          Ratio (CEDEARs x acción)
                        </label>
                        <input type="number" min="0" step="any" v-model="form.ratio" placeholder="Ej: 10">
                      </div>
                    </template>
                    <div class="form-field">
                      <label>Sector</label>
                      <select v-model="form.sector">
                        <option v-for="s in SECTORS" :key="s" :value="s">{{ s }}</option>
                      </select>
                    </div>
                    <div class="form-field">
                      <label>Cantidad</label>
                      <input type="number" min="0" step="any" v-model="form.quantity" placeholder="Ej: 50" required>
                    </div>
                    <div class="form-field">
                      <label>Precio promedio de compra (ARS)</label>
                      <input type="number" min="0" step="any" v-model="form.avgPrice" placeholder="Ej: 12500" required>
                    </div>
                    <div class="form-field">
                      <label title="Para acciones argentinas (o CEDEARs sin ratio/subyacente cargado), ingresá acá el precio actual a mano.">
                        Precio actual manual (ARS)
                      </label>
                      <input type="number" min="0" step="any" v-model="form.manualPrice" placeholder="Opcional">
                    </div>
                    <div class="form-field">
                      <label title="Peso que querés que tenga esta posición en la cartera, para comparar contra el peso real.">
                        Peso objetivo (%)
                      </label>
                      <input type="number" min="0" max="100" step="any" v-model="form.targetWeight" placeholder="Opcional">
                    </div>
                  </div>

                  <div v-if="formError" class="form-error">{{ formError }}</div>

                  <div class="form-actions">
                    <button type="submit" class="btn-primary" :disabled="saving">
                      {{ saving ? 'Guardando...' : editingPositionId ? 'Guardar cambios' : 'Agregar posición' }}
                    </button>
                    <button v-if="editingPositionId" type="button" class="btn-secondary" @click="cancelEditPosition">Cancelar</button>
                  </div>
                </form>

                <!-- Tabla de posiciones -->
                <div v-if="positionsWithWeight.length" class="positions-table-wrap">
                  <table class="positions-table">
                    <thead>
                      <tr>
                        <th>Ticker</th>
                        <th class="num">Beta</th>
                        <th class="num">Cantidad</th>
                        <th class="num">Precio</th>
                        <th class="num">Valor / Peso</th>
                        <th class="num">Peso objetivo</th>
                        <th class="num">Rendimiento</th>
                        <th class="num">Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr
                        v-for="p in positionsWithWeight"
                        :key="p.id"
                        :class="p.unrealizedARS == null ? '' : (p.unrealizedARS >= 0 ? 'row-pos' : 'row-neg')"
                      >
                        <td>
                          <div class="ticker-cell">{{ p.ticker }}</div>
                          <span class="badge" :class="p.assetType === 'CEDEAR' ? 'badge-cedear' : 'badge-ar'">
                            {{ p.assetType === 'CEDEAR' ? 'CEDEAR' : 'Acción AR' }}
                          </span>
                          <div class="ratio-subrow">{{ p.sector }}</div>
                          <div v-if="p.assetType === 'CEDEAR'" class="ratio-subrow">
                            Ratio: {{ p.ratio ?? '—' }} · Subyacente: {{ p.underlyingTicker || '—' }}
                          </div>
                        </td>
                        <td class="num">{{ p.beta ?? '—' }}</td>
                        <td class="num">{{ p.quantity }}</td>
                        <td class="num">
                          <div class="stacked-cell">
                            <span class="stacked-line-dim">Costo ${{ formatMoney(p.avgPrice) }}</span>
                            <span>
                              {{ p.currentPriceARS != null ? `Actual $${formatMoney(p.currentPriceARS)}` : 'Actual —' }}
                              <span v-if="p.underlyingLoading" class="auto-tag">...</span>
                              <span
                                v-else-if="p.assetType === 'CEDEAR'"
                                :title="p.usesRatioValuation ? 'Real: ratio + precio de la acción (Finnhub)' : 'Sin ratio/subyacente: cargá el precio manual'"
                              >{{ p.usesRatioValuation ? '✓' : (p.currentPriceARS != null ? '✎' : '') }}</span>
                            </span>
                          </div>
                        </td>
                        <td class="num">
                          <div class="stacked-cell">
                            <span>${{ formatMoney(p.marketValueARS ?? p.invested) }}</span>
                            <span class="stacked-line-dim">
                              {{ formatMoney(p.weight) }}%
                              <template v-if="p.marketValueUSD != null">· US${{ formatMoney(p.marketValueUSD) }}</template>
                            </span>
                          </div>
                        </td>
                        <td class="num">
                          <template v-if="p.targetWeight != null">
                            <div class="stacked-cell">
                              <span>{{ formatMoney(p.targetWeight) }}%</span>
                              <span class="stacked-line-dim" :class="Math.abs(p.weightDelta) < 1 ? '' : (p.weightDelta > 0 ? 'pl-neg' : 'pl-pos')">
                                {{ p.weightDelta >= 0 ? '+' : '' }}{{ formatMoney(p.weightDelta) }}pp
                              </span>
                            </div>
                          </template>
                          <template v-else>—</template>
                        </td>
                        <td class="num">
                          <template v-if="p.unrealizedARS != null">
                            <span :class="p.unrealizedARS >= 0 ? 'pl-pos' : 'pl-neg'">
                              {{ p.unrealizedARS >= 0 ? '+' : '' }}${{ formatMoney(p.unrealizedARS) }}
                              <span class="pct-tag">({{ formatPct(p.unrealizedARSPct) }})</span>
                            </span>
                          </template>
                          <template v-else>—</template>
                        </td>
                        <td class="num">
                          <div class="actions-cell">
                            <button class="icon-btn" title="Editar" @click="startEditPosition(p)">✎</button>
                            <button class="icon-btn icon-btn-danger" title="Eliminar" @click="removePositionRow(p)">🗑</button>
                          </div>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div v-else class="empty-state">Esta cartera todavía no tiene posiciones cargadas.</div>
                <div class="pf-hint">
                  Para CEDEARs, cargá el ticker subyacente y el ratio para valuar con el precio real de la acción (✓).
                  Sin esos datos (o para acciones argentinas), cargá el precio actual a mano (✎). El "peso objetivo"
                  te permite comparar contra el peso real y detectar cuándo conviene rebalancear.
                </div>
              </template>
            </template>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.pf-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 24px;
}

.pf-modal {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 14px;
  width: 100%;
  max-width: 1280px;
  max-height: 90vh;
  overflow-y: auto;
  padding: 24px 28px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  font-size: 14.5px;
  line-height: 1.5;
}

.pf-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--border);
  padding-bottom: 16px;
}

.pf-title {
  font-size: 19px;
  font-weight: 700;
  color: var(--text);
  display: flex;
  align-items: center;
  gap: 10px;
}

.build-tag {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-dim);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 2px 7px;
  letter-spacing: 0.02em;
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

.pf-loading,
.empty-state {
  text-align: center;
  color: var(--text-dim);
  font-size: 14px;
  padding: 32px 0;
}

.empty-state-small {
  text-align: center;
  color: var(--text-dim);
  font-size: 12.5px;
  padding: 12px 0;
}

.pf-error,
.form-error {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.4);
  color: #ef4444;
  padding: 12px 14px;
  border-radius: 8px;
  font-size: 13px;
}

.pf-hint {
  font-size: 12.5px;
  color: var(--text-dim);
  line-height: 1.6;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 14px;
}

.pf-layout {
  display: grid;
  grid-template-columns: 240px 1fr;
  gap: 20px;
  align-items: start;
}

.pf-sidebar {
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px;
}

.pf-sidebar-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.pf-portfolio-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 220px;
  overflow-y: auto;
}

.pf-portfolio-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  border-radius: 8px;
  padding: 4px;
}

.pf-portfolio-item.active {
  background: rgba(37, 99, 235, 0.15);
}

.pf-portfolio-name {
  background: none;
  border: none;
  color: var(--text);
  font-size: 13.5px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  padding: 6px 8px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pf-portfolio-actions {
  display: flex;
  gap: 4px;
}

.pf-rename-input {
  width: 100%;
  background: var(--panel);
  border: 1px solid var(--blue, #2563eb);
  border-radius: 6px;
  padding: 6px 8px;
  color: var(--text);
  font-size: 13px;
  font-family: inherit;
}

.pf-new-portfolio {
  display: flex;
  gap: 6px;
  border-top: 1px solid var(--border);
  padding-top: 12px;
}

.pf-new-portfolio input {
  flex: 1;
  min-width: 0;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 8px 10px;
  color: var(--text);
  font-size: 13px;
  font-family: inherit;
}

.pf-main {
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-width: 0;
}

.summary-bar {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
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
  font-size: 18px;
  color: var(--text);
  font-family: var(--font-num, inherit);
}

.concentration-tag {
  font-size: 11px;
  font-family: var(--font-ui, inherit);
  color: var(--text-dim);
  font-weight: 500;
}

.diversification-section {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 20px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 18px 20px;
}

.diversification-col {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.sector-legend {
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 4px;
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-dim);
}

.legend-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex-shrink: 0;
}

.charts-section {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 20px;
}

.chart-card {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.chart-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}

.view-toggle {
  display: flex;
  gap: 6px;
}

.series-return {
  margin-left: 8px;
  font-size: 13px;
  font-weight: 700;
}

.chart-canvas-wrap {
  position: relative;
  height: 260px;
}

.chart-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 0 10px;
  line-height: 1.6;
}

.debug-toggle {
  align-self: flex-start;
  background: none;
  border: none;
  color: var(--text-dim);
  font-size: 11px;
  text-decoration: underline;
  cursor: pointer;
  padding: 0;
}

.debug-toggle:hover {
  color: var(--text);
}

.debug-panel {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 11px;
  color: var(--text-dim);
  max-height: 220px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.section-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--text);
}

.bar-row {
  display: grid;
  grid-template-columns: 110px 1fr 50px;
  align-items: center;
  gap: 10px;
  font-size: 12.5px;
}

.bar-row-clickable {
  width: 100%;
  background: none;
  border: 1px solid transparent;
  border-radius: 7px;
  padding: 3px 6px;
  cursor: pointer;
  font-family: inherit;
}

.bar-row-clickable:hover {
  background: var(--panel);
}

.bar-row-clickable.active {
  border-color: var(--blue, #2563eb);
  background: rgba(37, 99, 235, 0.1);
}

.bar-row-clickable .bar-label {
  color: var(--text);
  font-weight: 600;
}

.hint-inline {
  font-size: 10.5px;
  font-weight: 500;
  color: var(--text-dim);
  text-transform: none;
}

.bar-label {
  color: var(--text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bar-track {
  height: 8px;
  background: var(--panel);
  border-radius: 999px;
  overflow: hidden;
}

.bar-fill {
  height: 100%;
  background: var(--blue, #2563eb);
  border-radius: 999px;
}

.bar-pct {
  text-align: right;
  font-family: var(--font-num, inherit);
  color: var(--text);
}

.pf-form {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 22px 24px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 16px;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.form-field label {
  font-size: 12.5px;
  color: var(--text-dim);
  font-weight: 600;
}

.field-hint {
  font-size: 11.5px;
  color: var(--text-dim);
}

.form-field input,
.form-field select {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  color: var(--text);
  font-size: 14px;
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
  padding: 12px 22px;
  font-weight: 600;
  font-size: 14.5px;
  cursor: pointer;
}

.btn-primary:hover {
  background: #1d4ed8;
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-small {
  padding: 8px 14px;
  font-size: 13px;
  white-space: nowrap;
}

.import-trades-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.import-result-text {
  font-size: 12.5px;
  color: var(--text-dim);
}

.btn-secondary {
  background: var(--panel);
  border: 1px solid var(--border);
  color: var(--text-dim);
  border-radius: 9px;
  padding: 12px 22px;
  font-weight: 600;
  font-size: 14.5px;
  cursor: pointer;
}

.btn-secondary:hover {
  color: var(--text);
  border-color: var(--text-dim);
}

.positions-table-wrap {
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 10px;
  max-height: 420px;
}

.positions-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13.5px;
  font-variant-numeric: tabular-nums;
}

.positions-table th {
  text-align: left;
  padding: 10px 14px;
  background: var(--bg);
  color: var(--text-dim);
  font-weight: 600;
  font-size: 12px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
  position: sticky;
  top: 0;
}

.positions-table th.num,
.positions-table td.num {
  text-align: right;
}

.positions-table td {
  padding: 9px 14px;
  border-bottom: 1px solid var(--border);
  color: var(--text);
  font-family: var(--font-num, inherit);
}

.positions-table tbody tr:last-child td {
  border-bottom: none;
}

.positions-table tbody tr.row-pos {
  background: rgba(34, 197, 94, 0.055);
}

.positions-table tbody tr.row-neg {
  background: rgba(239, 68, 68, 0.055);
}

.stacked-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  white-space: nowrap;
}

.positions-table td.num .stacked-cell {
  align-items: flex-end;
}

.stacked-line-dim {
  color: var(--text-dim);
  font-size: 0.88em;
}

.ticker-cell {
  font-weight: 700;
  font-size: 14.5px;
}

.ratio-subrow {
  font-size: 11.5px;
  color: var(--text-dim);
  margin-top: 3px;
  white-space: normal;
}

.badge {
  display: inline-block;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  margin-top: 4px;
}

.badge-cedear {
  background: rgba(59, 130, 246, 0.15);
  color: #60a5fa;
}

.badge-ar {
  background: rgba(168, 85, 247, 0.15);
  color: #c084fc;
}

.badge-profile-conservador {
  background: rgba(59, 130, 246, 0.15);
  color: #60a5fa;
}

.badge-profile-moderado {
  background: rgba(234, 179, 8, 0.15);
  color: #eab308;
}

.badge-profile-agresivo {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

.pct-tag {
  font-size: 12px;
  opacity: 0.85;
}

.auto-tag {
  color: var(--text-dim);
  font-weight: 600;
}

.pl-pos {
  color: #22c55e !important;
}

.pl-neg {
  color: #ef4444 !important;
}

.actions-cell {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
}

.icon-btn {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 7px;
  width: 30px;
  height: 30px;
  cursor: pointer;
  color: var(--text-dim);
  font-size: 13px;
}

.icon-btn:hover {
  color: var(--text);
  border-color: var(--text-dim);
}

.icon-btn-danger:hover {
  color: #ef4444;
  border-color: #ef4444;
}

@media (max-width: 900px) {
  .pf-layout {
    grid-template-columns: 1fr;
  }
  .pf-sidebar {
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
  }
  .pf-portfolio-list {
    max-height: none;
    flex: 1;
    min-width: 200px;
  }
}

@media (max-width: 760px) {
  .pf-overlay {
    padding: 0;
  }
  .pf-modal {
    max-width: 100%;
    height: 100vh;
    height: 100dvh;
    border-radius: 0;
    padding: 16px 12px;
    gap: 14px;
    font-size: 14px;
  }
  .pf-title {
    font-size: 16px;
  }
  .pf-form {
    padding: 16px;
  }
  .form-field input,
  .form-field select {
    font-size: 16px;
  }
  .form-actions {
    flex-direction: column;
  }
  .form-actions button {
    width: 100%;
  }
}
</style>
