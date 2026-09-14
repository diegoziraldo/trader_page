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
// api.argentinadatos.com expone el CCL histórico día por día, así no hay
// que tipearlo a mano para operaciones viejas.
const HISTORICAL_CCL_BASE = 'https://api.argentinadatos.com/v1/cotizaciones/dolares/contadoconliqui'

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

// --- Precio en USD de la acción subyacente (data912) ---
const usaPrices = ref({}) // { TICKER: precioUSD }
let intervaloUsaPrices = null

// --- Ratio CEDEAR/acción. cedearRatiosAuto[ticker] === false significa que
// el usuario lo corrigió a mano y no debe pisarse con el autocompletado. ---
const cedearRatios = ref({})     // { TICKER: ratio numérico }
const cedearRatiosAuto = reactive({}) // { TICKER: true | false }

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
      const livePrice = isCedear ? getLivePrice(s.ticker) : null
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
      }
    })
)

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
  const res = await fetch(DOLARAPI_LIST_URL)
  if (!res.ok) throw new Error('No se pudo consultar dolarapi')
  const lista = await res.json()
  const ccl = lista.find((d) => d.casa === 'contadoconliqui')
  return ccl && ccl.venta ? Number(ccl.venta) : null
}

async function fetchHistoricalCCL(dateStr) {
  if (!dateStr) return null
  const [y, m, d] = dateStr.split('-')
  const res = await fetch(`${HISTORICAL_CCL_BASE}/${y}/${m}/${d}`)
  if (!res.ok) return null // fin de semana / feriado / fecha sin dato
  const data = await res.json()
  const row = Array.isArray(data) ? data[0] : data
  return row && row.venta ? Number(row.venta) : null
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
    const res = await fetch(CEDEARS_LIVE_URL)
    if (!res.ok) throw new Error('Error consultando data912')
    liveCedears.value = await res.json()
  } catch (e) {
    console.error('No se pudo cargar el precio en vivo de CEDEARs', e)
  }
}

function getLivePrice(ticker) {
  const found = liveCedears.value.find((item) => String(item.symbol).toUpperCase() === ticker)
  return found && found.c ? Number(found.c) : null
}

// =========================================================
// PRECIO EN USD DE LA ACCIÓN SUBYACENTE (data912)
// =========================================================
async function loadUsaPrices() {
  try {
    const [stocksRes, adrsRes] = await Promise.allSettled([
      fetch(USA_STOCKS_LIVE_URL),
      fetch(USA_ADRS_LIVE_URL),
    ])
    const merged = {}
    for (const settled of [stocksRes, adrsRes]) {
      if (settled.status !== 'fulfilled' || !settled.value.ok) continue
      const list = await settled.value.json()
      for (const item of list) {
        const sym = String(item.symbol || '').toUpperCase()
        const price = Number(item.c)
        if (sym && price > 0) merged[sym] = price
      }
    }
    usaPrices.value = merged
  } catch (e) {
    console.error('No se pudo cargar el precio en USD de las acciones subyacentes', e)
  }
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
    const res = await fetch(CEDEAR_RATIOS_URL)
    if (!res.ok) throw new Error('No se pudo consultar la fuente de ratios')
    const data = await res.json()
    const items = Array.isArray(data) ? data : data.items || []
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

async function submitForm() {
  formError.value = ''
  const ticker = form.ticker.trim().toUpperCase()
  if (!ticker) return (formError.value = 'Ingresá un ticker')
  if (!(Number(form.quantity) > 0)) return (formError.value = 'La cantidad debe ser mayor a 0')
  if (!(Number(form.price) > 0)) return (formError.value = 'El precio debe ser mayor a 0')

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
            <div v-for="t in paginatedTrades" :key="t.id" class="entry-card">
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
        <!-- Posiciones abiertas: valor de mercado y rendimiento no realizado -->
        <div v-if="openPositions.length" class="by-symbol-section">
          <div class="section-title">Posiciones abiertas — valor de mercado</div>
          <div class="by-symbol-table-wrap">
            <table class="by-symbol-table">
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Cantidad</th>
                  <th>Costo prom. (ARS)</th>
                  <th title="Precio en vivo, solo CEDEARs (data912)">Precio actual (ARS)</th>
                  <th title="Cuántos CEDEARs equivalen a 1 acción de la empresa en el exterior. Se autocompleta cuando es posible; si falta o quedó vieja, cargala a mano.">Ratio CEDEAR</th>
                  <th title="CCL implícito de este CEDEAR puntual (precio CEDEAR × ratio ÷ precio real de la acción en USD). Puede diferir del CCL oficial.">CCL implícito</th>
                  <th>Valor actual (ARS)</th>
                  <th>Rendimiento (ARS)</th>
                  <th title="Con ratio conocido se calcula con el precio real de la acción en USD. Sin ratio, se aproxima con el CCL general (marcado con ≈).">Valor actual (USD)</th>
                  <th title="Con ratio conocido se calcula con el precio real de la acción en USD. Sin ratio, se aproxima con el CCL general (marcado con ≈).">Rendimiento (USD)</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="p in openPositions" :key="p.ticker">
                  <td class="ticker-cell">{{ p.ticker }}</td>
                  <td>{{ formatNum(p.quantity) }}</td>
                  <td>${{ formatMoney(p.avgCost) }}</td>
                  <td>{{ p.livePrice != null ? `$${formatMoney(p.livePrice)}` : '—' }}</td>
                  <td v-if="p.assetType === 'CEDEAR'">
                    <div class="ratio-input-row">
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
                  <td v-else>—</td>
                  <td>{{ p.impliedCCL != null ? `$${formatMoney(p.impliedCCL)}` : '—' }}</td>
                  <td>{{ p.marketValueARS != null ? `$${formatMoney(p.marketValueARS)}` : '—' }}</td>
                  <td v-if="p.unrealizedARS === null">—</td>
                  <td v-else :class="p.unrealizedARS >= 0 ? 'pl-pos' : 'pl-neg'">
                    {{ p.unrealizedARS >= 0 ? '+' : '' }}${{ formatMoney(p.unrealizedARS) }}
                    <span class="pct-tag">({{ formatPct(p.unrealizedARSPct) }})</span>
                  </td>
                  <td>
                    <template v-if="p.marketValueUSD != null">
                      US${{ formatMoney(p.marketValueUSD) }}
                      <span
                        v-if="p.assetType === 'CEDEAR'"
                        class="pct-tag"
                        :title="p.usesRatioValuation ? 'Valor real: calculado con ratio + precio de la acción' : 'Aproximado con el CCL general (falta ratio o precio de la acción)'"
                      >{{ p.usesRatioValuation ? '✓' : '≈' }}</span>
                    </template>
                    <template v-else>—</template>
                  </td>
                  <td v-if="p.unrealizedUSD === null">—</td>
                  <td v-else :class="p.unrealizedUSD >= 0 ? 'pl-pos' : 'pl-neg'">
                    {{ p.unrealizedUSD >= 0 ? '+' : '' }}US${{ formatMoney(p.unrealizedUSD) }}
                    <span class="pct-tag">({{ formatPct(p.unrealizedUSDPct) }})</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="table-hint">
            Precio en vivo solo para CEDEARs (fuente: data912.com, cada 30s). Para acciones argentinas
            todavía no hay precio en vivo conectado acá. El valor y rendimiento en USD de los CEDEARs se
            calcula con el ratio real contra la acción subyacente (✓); si el ratio no está disponible
            se aproxima con el CCL general (≈) — completalo a mano en "Ratio CEDEAR" para tener el número exacto.
          </div>
        </div>

        <!-- Resumen por ticker (histórico, incluye posiciones cerradas) -->
        <div v-if="summary.bySymbol.length" class="by-symbol-section">
          <div class="section-title">Resultado por ticker (histórico)</div>
          <div class="by-symbol-table-wrap">
            <table class="by-symbol-table">
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Tipo</th>
                  <th>Cantidad</th>
                  <th>Costo prom. (ARS)</th>
                  <th>Costo prom. (USD)</th>
                  <th>P&L realizado (ARS)</th>
                  <th>P&L realizado (USD)</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="s in summary.bySymbol" :key="s.ticker">
                  <td class="ticker-cell">{{ s.ticker }}</td>
                  <td><span class="badge" :class="s.assetType === 'CEDEAR' ? 'badge-cedear' : 'badge-ar'">{{ s.assetType === 'CEDEAR' ? 'CEDEAR' : 'Acción AR' }}</span></td>
                  <td>{{ formatNum(s.quantity) }}</td>
                  <td>${{ formatMoney(s.avgCost) }}</td>
                  <td :title="s.usdIncomplete ? 'Faltan cargar CCL en alguna operación de este ticker' : ''">
                    {{ s.usdIncomplete ? '—' : `US$${formatMoney(s.avgCostUSD)}` }}
                  </td>
                  <td :class="s.realizedPL >= 0 ? 'pl-pos' : 'pl-neg'">
                    {{ s.realizedPL >= 0 ? '+' : '' }}${{ formatMoney(s.realizedPL) }}
                  </td>
                  <td v-if="s.usdIncomplete" :title="'Faltan cargar CCL en alguna operación de este ticker'">—</td>
                  <td v-else :class="s.realizedPLUSD >= 0 ? 'pl-pos' : 'pl-neg'">
                    {{ s.realizedPLUSD >= 0 ? '+' : '' }}US${{ formatMoney(s.realizedPLUSD) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

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
  padding: 20px;
}

.trades-modal {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  width: 100%;
  max-width: 1180px;
  max-height: 92vh;
  overflow-y: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.trades-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--border);
  padding-bottom: 12px;
}

.trades-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--text);
  display: flex;
  align-items: center;
  gap: 8px;
}

.close-btn {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-dim);
  width: 28px;
  height: 28px;
  cursor: pointer;
  font-size: 14px;
}

.close-btn:hover {
  color: var(--text);
  border-color: var(--text-dim);
}

.trades-loading,
.empty-state {
  text-align: center;
  color: var(--text-dim);
  font-size: 13px;
  padding: 24px 0;
}

.trades-error,
.form-error {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.4);
  color: #ef4444;
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 12px;
}

.summary-bar {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 10px;
}

.summary-card {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.summary-label {
  font-size: 10px;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.summary-card strong {
  font-size: 16px;
  color: var(--text);
  font-family: var(--font-num, inherit);
}

.section-title {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-dim);
}

.table-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}

.search-box {
  position: relative;
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 160px;
  max-width: 260px;
}

.search-box input {
  width: 100%;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 26px 6px 10px;
  color: var(--text);
  font-size: 12px;
  font-family: inherit;
}

.search-box input:focus {
  outline: none;
  border-color: var(--blue, #2563eb);
}

.search-clear {
  position: absolute;
  right: 6px;
  background: none;
  border: none;
  color: var(--text-dim);
  cursor: pointer;
  font-size: 11px;
  padding: 2px;
}

.search-clear:hover {
  color: var(--text);
}

.pagination-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding-top: 4px;
}

.page-btn {
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text-dim);
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 11px;
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
  font-size: 11px;
  color: var(--text-dim);
  white-space: nowrap;
}

.view-tabs {
  display: flex;
  gap: 8px;
  border-bottom: 1px solid var(--border);
  padding-bottom: 12px;
}

.view-tab {
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text-dim);
  border-radius: 8px;
  padding: 8px 14px;
  font-size: 12px;
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
  gap: 12px;
}

.entry-cards {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.entry-card {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.entry-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}

.entry-card-title {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.entry-card-title .ticker-cell {
  font-size: 15px;
}

.entry-card-actions {
  display: flex;
  gap: 6px;
}

.entry-card-dates {
  font-size: 11px;
  color: var(--text-dim);
  font-family: var(--font-num, inherit);
}

.entry-card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 10px;
  padding: 10px 0;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}

.entry-card-notes {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}

.detail-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.detail-label {
  font-size: 10px;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.4px;
  font-weight: 700;
}

.detail-value {
  font-size: 12px;
  color: var(--text);
  font-family: var(--font-num, inherit);
}

.detail-text {
  font-size: 12px;
  color: var(--text);
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  margin: 0;
}

.by-symbol-table-wrap,
.trades-table-wrap {
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
}

.by-symbol-table,
.trades-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.by-symbol-table th,
.trades-table th {
  text-align: left;
  padding: 8px 10px;
  background: var(--bg);
  color: var(--text-dim);
  font-weight: 600;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}

.by-symbol-table td,
.trades-table td {
  padding: 8px 10px;
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

.table-hint {
  font-size: 11px;
  color: var(--text-dim);
  padding: 2px 2px 0;
}

.pct-tag {
  font-size: 10px;
  opacity: 0.85;
}

.row-editing {
  background: rgba(37, 99, 235, 0.08);
}

.ticker-cell {
  font-weight: 700;
}

.notes-cell {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: inherit;
  color: var(--text-dim);
}

.badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
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
  gap: 6px;
}

.icon-btn {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  width: 26px;
  height: 26px;
  cursor: pointer;
  color: var(--text-dim);
  font-size: 12px;
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
  border-radius: 8px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 10px;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.form-field-wide {
  grid-column: span 2;
}

.form-field label {
  font-size: 10px;
  color: var(--text-dim);
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 4px;
}

.auto-tag {
  color: #22c55e;
  font-weight: 600;
  text-transform: none;
}

.ccl-input-row {
  display: flex;
  gap: 6px;
}

.ccl-input-row input {
  flex: 1;
  min-width: 0;
}

.ccl-hint {
  font-size: 10px;
  color: #fbbf24;
}

.ratio-input-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.ratio-input {
  width: 56px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 6px;
  color: var(--text);
  font-size: 12px;
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
  border-radius: 6px;
  padding: 6px 8px;
  color: var(--text);
  font-size: 12px;
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
  gap: 8px;
}

.btn-primary {
  background: #2563eb;
  border: 1px solid #2563eb;
  color: white;
  border-radius: 6px;
  padding: 8px 16px;
  font-weight: 600;
  font-size: 12px;
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
  border-radius: 6px;
  padding: 8px 16px;
  font-weight: 600;
  font-size: 12px;
  cursor: pointer;
}

.btn-secondary:hover {
  color: var(--text);
  border-color: var(--text-dim);
}

@media (max-width: 600px) {
  .trades-overlay {
    padding: 0;
  }
  .trades-modal {
    max-width: 100%;
    height: 100vh;
    border-radius: 0;
  }
  .form-field-wide {
    grid-column: span 1;
  }
}
</style>