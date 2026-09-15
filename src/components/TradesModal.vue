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
    ratio: 1,
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
      const livePrice = s.assetType === 'CEDEAR' ? getLivePrice(s.ticker) : null
      const marketValueARS = livePrice != null ? s.quantity * livePrice : null
      const unrealizedARS = marketValueARS != null ? marketValueARS - s.invested : null
      const unrealizedARSPct =
        marketValueARS != null && s.invested > 0 ? (unrealizedARS / s.invested) * 100 : null

      const marketValueUSD =
        marketValueARS != null && cclActual.value ? marketValueARS / cclActual.value : null
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
  form.ratio = trade.ratio ?? 1
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
    ratio: Number(form.ratio) || 1,
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

  // Primer autocompletado del CCL para el formulario "hoy" en blanco.
  cclIsAuto.value = true
  autofillCCL()
})

onUnmounted(() => {
  if (intervaloCclActual) clearInterval(intervaloCclActual)
  if (intervaloCedears) clearInterval(intervaloCedears)
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
                  <span class="detail-label">Ratio</span>
                  <span class="detail-value">{{ t.ratio || 1 }}</span>
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
                  <th>Valor actual (ARS)</th>
                  <th>Rendimiento (ARS)</th>
                  <th>Valor actual (USD)</th>
                  <th>Rendimiento (USD)</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="p in openPositions" :key="p.ticker">
                  <td class="ticker-cell">{{ p.ticker }}</td>
                  <td>{{ formatNum(p.quantity) }}</td>
                  <td>${{ formatMoney(p.avgCost) }}</td>
                  <td>{{ p.livePrice != null ? `$${formatMoney(p.livePrice)}` : '—' }}</td>
                  <td>{{ p.marketValueARS != null ? `$${formatMoney(p.marketValueARS)}` : '—' }}</td>
                  <td v-if="p.unrealizedARS === null">—</td>
                  <td v-else :class="p.unrealizedARS >= 0 ? 'pl-pos' : 'pl-neg'">
                    {{ p.unrealizedARS >= 0 ? '+' : '' }}${{ formatMoney(p.unrealizedARS) }}
                    <span class="pct-tag">({{ formatPct(p.unrealizedARSPct) }})</span>
                  </td>
                  <td>{{ p.marketValueUSD != null ? `US$${formatMoney(p.marketValueUSD)}` : '—' }}</td>
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
            todavía no hay precio en vivo conectado acá.
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
              <label>Ratio (ej: 10, 20)</label>
              <input type="number" min="0.001" step="any" v-model="form.ratio" placeholder="Ej: 10" required>
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

        <!-- Tabla de operaciones -->
        <div class="table-header-row">
          <div class="section-title">Historial ({{ filteredTrades.length }})</div>
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
        <div class="trades-table-wrap">
          <table class="trades-table" v-if="sortedTrades.length">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Activo</th>
                <th>Ticker</th>
                <th>Operación</th>
                <th>Cantidad</th>
                <th>Ratio</th>
                <th>Precio (ARS)</th>
                <th>CCL</th>
                <th>Precio (USD)</th>
                <th>Comisión</th>
                <th>Total</th>
                <th>Notas</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="t in paginatedTrades" :key="t.id" :class="{ 'row-editing': editingId === t.id }">
                <td>{{ formatDate(t.date) }}</td>
                <td><span class="badge" :class="t.assetType === 'CEDEAR' ? 'badge-cedear' : 'badge-ar'">{{ t.assetType === 'CEDEAR' ? 'CEDEAR' : 'Acción AR' }}</span></td>
                <td class="ticker-cell">{{ t.ticker }}</td>
                <td><span class="badge" :class="t.operation === 'COMPRA' ? 'badge-buy' : 'badge-sell'">{{ t.operation === 'COMPRA' ? 'Compra' : 'Venta' }}</span></td>
                <td>{{ formatNum(t.quantity) }}</td>
                <td>{{ t.ratio || 1 }}</td>
                <td>${{ formatMoney(t.price) }}</td>
                <td>{{ t.ccl ? `$${formatMoney(t.ccl)}` : '—' }}</td>
                <td>{{ t.priceUSD != null ? `US$${formatMoney(t.priceUSD)}` : '—' }}</td>
                <td>${{ formatMoney(t.fee) }}</td>
                <td>${{ formatMoney(t.total) }}</td>
                <td class="notes-cell" :title="t.notes">{{ t.notes || '—' }}</td>
                <td class="actions-cell">
                  <button class="icon-btn" title="Editar" @click="startEdit(t)">✎</button>
                  <button class="icon-btn icon-btn-danger" title="Eliminar" @click="removeTrade(t)">🗑</button>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-else class="empty-state">Todavía no cargaste ninguna operación.</div>
        </div>

        <div v-if="sortedTrades.length" class="pagination-bar">
          <button type="button" class="page-btn" :disabled="currentPage === 1" @click="goToPage(currentPage - 1)">← Anterior</button>
          <span class="page-info">Página {{ currentPage }} de {{ totalPages }} · mostrando {{ paginatedTrades.length }} de {{ sortedTrades.length }}</span>
          <button type="button" class="page-btn" :disabled="currentPage === totalPages" @click="goToPage(currentPage + 1)">Siguiente →</button>
        </div>
        </template>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* =========================================================
   BITÁCORA DE TRADES — UI PROFESIONAL
   LÓGICA Y TEMPLATE ORIGINAL SIN MODIFICACIONES
   ========================================================= */

.trades-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 18px;
  background: rgba(0, 0, 0, 0.72);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}

.trades-modal {
  box-sizing: border-box;
  width: 100%;
  max-width: 1480px;
  max-height: calc(100vh - 36px);
  overflow-x: hidden;
  overflow-y: auto;
  padding: 26px 30px 30px;
  display: flex;
  flex-direction: column;
  gap: 22px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 16px;
  color: var(--text);
  font-size: 14px;
  line-height: 1.5;
  box-shadow:
    0 30px 90px rgba(0, 0, 0, 0.45),
    0 10px 30px rgba(0, 0, 0, 0.24);
  scrollbar-gutter: stable;
  overscroll-behavior: contain;
}

.trades-modal::-webkit-scrollbar,
.by-symbol-table-wrap::-webkit-scrollbar,
.trades-table-wrap::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.trades-modal::-webkit-scrollbar-track,
.by-symbol-table-wrap::-webkit-scrollbar-track,
.trades-table-wrap::-webkit-scrollbar-track {
  background: transparent;
}

.trades-modal::-webkit-scrollbar-thumb,
.by-symbol-table-wrap::-webkit-scrollbar-thumb,
.trades-table-wrap::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 999px;
}

.trades-modal::-webkit-scrollbar-thumb:hover,
.by-symbol-table-wrap::-webkit-scrollbar-thumb:hover,
.trades-table-wrap::-webkit-scrollbar-thumb:hover {
  background: var(--text-dim);
}

/* =========================
   HEADER
   ========================= */

.trades-header {
  position: sticky;
  top: -26px;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 17px;
  background: var(--panel);
  border-bottom: 1px solid var(--border);
}

.trades-title {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--text);
  font-size: 21px;
  font-weight: 750;
  line-height: 1.2;
  letter-spacing: -0.02em;
}

.trades-icon {
  font-size: 20px;
  line-height: 1;
}

.close-btn {
  flex: 0 0 auto;
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 9px;
  color: var(--text-dim);
  cursor: pointer;
  font-size: 14px;
  transition:
    color .15s ease,
    border-color .15s ease,
    background .15s ease,
    transform .15s ease;
}

.close-btn:hover {
  color: var(--text);
  border-color: var(--text-dim);
  background: var(--panel);
  transform: translateY(-1px);
}

/* =========================
   STATES
   ========================= */

.trades-loading,
.empty-state {
  text-align: center;
  color: var(--text-dim);
  font-size: 13px;
  padding: 30px 20px;
}

.trades-error,
.form-error {
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.30);
  color: #ef4444;
  padding: 11px 14px;
  border-radius: 9px;
  font-size: 12px;
}

/* =========================
   SUMMARY
   ========================= */

.summary-bar {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 10px;
}

.summary-card {
  min-width: 0;
  min-height: 82px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 6px;
  padding: 13px 15px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 11px;
  transition:
    border-color .15s ease,
    transform .15s ease,
    box-shadow .15s ease;
}

.summary-card:hover {
  border-color: var(--text-dim);
  transform: translateY(-1px);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.14);
}

.summary-label {
  color: var(--text-dim);
  font-size: 10px;
  font-weight: 700;
  line-height: 1.25;
  letter-spacing: .045em;
  text-transform: uppercase;
}

.summary-card strong {
  min-width: 0;
  color: var(--text);
  font-size: 19px;
  font-weight: 750;
  line-height: 1.15;
  font-family: var(--font-num, inherit);
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pl-pos {
  color: #22c55e !important;
}

.pl-neg {
  color: #ef4444 !important;
}

/* =========================
   TABS
   ========================= */

.view-tabs {
  display: inline-flex;
  align-self: flex-start;
  align-items: center;
  gap: 5px;
  padding: 4px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 10px;
}

.view-tab {
  flex: 0 0 auto;
  background: transparent;
  border: 1px solid transparent;
  color: var(--text-dim);
  border-radius: 7px;
  padding: 9px 14px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition:
    color .15s ease,
    background .15s ease,
    border-color .15s ease;
}

.view-tab:hover {
  color: var(--text);
  background: var(--panel);
}

.view-tab.active {
  background: rgba(37, 99, 235, 0.12);
  border-color: rgba(37, 99, 235, 0.45);
  color: var(--blue, #60a5fa);
}

/* =========================
   GENERAL
   ========================= */

.section-title {
  color: var(--text);
  font-size: 12px;
  font-weight: 750;
  letter-spacing: .055em;
  text-transform: uppercase;
}

.table-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

/* =========================
   SEARCH
   ========================= */

.search-box {
  position: relative;
  display: flex;
  align-items: center;
  width: min(320px, 100%);
}

.search-box input {
  width: 100%;
  box-sizing: border-box;
  padding: 9px 34px 9px 12px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  font-size: 12px;
  font-family: inherit;
  transition:
    border-color .15s ease,
    box-shadow .15s ease;
}

.search-box input:hover {
  border-color: var(--text-dim);
}

.search-box input:focus {
  outline: none;
  border-color: var(--blue, #2563eb);
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.10);
}

.search-clear {
  position: absolute;
  right: 8px;
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  background: transparent;
  border: none;
  color: var(--text-dim);
  cursor: pointer;
  font-size: 11px;
}

.search-clear:hover {
  color: var(--text);
}

/* =========================
   FULL DETAIL
   ========================= */

.full-detail-screen {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}

.entry-cards {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.entry-card {
  min-width: 0;
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 11px;
  transition:
    border-color .15s ease,
    box-shadow .15s ease;
}

.entry-card:hover {
  border-color: var(--text-dim);
  box-shadow: 0 7px 22px rgba(0, 0, 0, 0.13);
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
  gap: 7px;
  flex-wrap: wrap;
}

.entry-card-title .ticker-cell {
  font-size: 16px;
}

.entry-card-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.entry-card-dates {
  color: var(--text-dim);
  font-size: 11px;
  font-family: var(--font-num, inherit);
  font-variant-numeric: tabular-nums;
}

.entry-card-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(105px, 1fr));
  gap: 1px;
  overflow: hidden;
  background: var(--border);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.entry-card-grid .detail-item {
  background: var(--bg);
}

.entry-card-notes {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
}

.detail-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 10px 12px;
}

.detail-label {
  color: var(--text-dim);
  font-size: 9.5px;
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: .055em;
  text-transform: uppercase;
}

.detail-value {
  min-width: 0;
  color: var(--text);
  font-size: 12px;
  font-weight: 650;
  font-family: var(--font-num, inherit);
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-text {
  margin: 0;
  color: var(--text);
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}

/* =========================
   TABLES
   ========================= */

.by-symbol-table-wrap,
.trades-table-wrap {
  width: 100%;
  overflow: auto;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 10px;
  scrollbar-gutter: stable;
}

.by-symbol-table-wrap {
  max-height: 400px;
}

.by-symbol-table,
.trades-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
}

.by-symbol-table th,
.trades-table th {
  position: sticky;
  top: 0;
  z-index: 5;
  padding: 10px 11px;
  background: var(--bg);
  color: var(--text-dim);
  border-bottom: 1px solid var(--border);
  font-size: 9.5px;
  font-weight: 750;
  letter-spacing: .05em;
  text-transform: uppercase;
  white-space: nowrap;
  text-align: left;
}

.by-symbol-table td,
.trades-table td {
  padding: 10px 11px;
  background: var(--bg);
  color: var(--text);
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
  font-family: var(--font-num, inherit);
}

.by-symbol-table tbody tr:hover td,
.trades-table tbody tr:hover td {
  background: rgba(255, 255, 255, 0.018);
}

.by-symbol-table tbody tr:last-child td,
.trades-table tbody tr:last-child td {
  border-bottom: none;
}

.by-symbol-table th:not(:first-child),
.by-symbol-table td:not(:first-child) {
  text-align: right;
}

.by-symbol-table th:first-child,
.by-symbol-table td:first-child {
  text-align: left;
}

.trades-table {
  min-width: 1180px;
}

.trades-table th:last-child,
.trades-table td:last-child {
  width: 1%;
}

.notes-cell {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-dim) !important;
  font-family: inherit !important;
}

.row-editing td {
  background: rgba(37, 99, 235, 0.08) !important;
}

.table-hint {
  padding: 2px 2px 0;
  color: var(--text-dim);
  font-size: 10.5px;
  line-height: 1.45;
}

.pct-tag {
  margin-left: 3px;
  color: var(--text-dim);
  font-size: 10px;
}

/* =========================
   TICKER + BADGES
   ========================= */

.ticker-cell {
  color: var(--text);
  font-weight: 750;
  letter-spacing: .01em;
}

.badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 20px;
  box-sizing: border-box;
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 9px;
  font-weight: 750;
  line-height: 1;
  text-transform: uppercase;
  white-space: nowrap;
}

.badge-cedear {
  background: rgba(59, 130, 246, 0.12);
  border: 1px solid rgba(59, 130, 246, 0.20);
  color: #60a5fa;
}

.badge-ar {
  background: rgba(168, 85, 247, 0.12);
  border: 1px solid rgba(168, 85, 247, 0.20);
  color: #c084fc;
}

.badge-buy {
  background: rgba(34, 197, 94, 0.11);
  border: 1px solid rgba(34, 197, 94, 0.18);
  color: #22c55e;
}

.badge-sell {
  background: rgba(239, 68, 68, 0.11);
  border: 1px solid rgba(239, 68, 68, 0.18);
  color: #ef4444;
}

/* =========================
   ACTIONS
   ========================= */

.actions-cell {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}

.icon-btn {
  width: 31px;
  height: 31px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 7px;
  color: var(--text-dim);
  cursor: pointer;
  font-size: 12px;
  transition:
    color .15s ease,
    border-color .15s ease,
    background .15s ease,
    transform .15s ease;
}

.icon-btn:hover {
  color: var(--text);
  border-color: var(--text-dim);
  background: var(--panel);
  transform: translateY(-1px);
}

.icon-btn-danger:hover {
  color: #ef4444;
  border-color: rgba(239, 68, 68, .55);
  background: rgba(239, 68, 68, .06);
}

/* =========================
   FORM
   ========================= */

.trade-form {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 19px 20px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 11px;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px 15px;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.form-field-wide {
  grid-column: span 2;
}

.form-field label {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--text-dim);
  font-size: 10px;
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: .025em;
}

.form-field input,
.form-field select {
  width: 100%;
  height: 41px;
  box-sizing: border-box;
  padding: 9px 11px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  font-size: 12px;
  font-family: inherit;
  font-variant-numeric: tabular-nums;
  transition:
    border-color .15s ease,
    box-shadow .15s ease,
    background .15s ease;
}

.form-field input:hover,
.form-field select:hover {
  border-color: var(--text-dim);
}

.form-field input::placeholder {
  color: var(--text-dim);
}

.form-field input:focus,
.form-field select:focus {
  outline: none;
  border-color: var(--blue, #2563eb);
  box-shadow: 0 0 0 3px rgba(37, 99, 235, .10);
}

.form-field input[type='date'] {
  color-scheme: dark;
}

.auto-tag {
  color: #22c55e;
  font-weight: 650;
  text-transform: none;
}

.ccl-input-row {
  display: flex;
  align-items: stretch;
  gap: 7px;
}

.ccl-input-row input {
  flex: 1;
  min-width: 0;
}

.ccl-hint {
  color: #fbbf24;
  font-size: 10px;
  line-height: 1.4;
}

/* =========================
   FORM BUTTONS
   ========================= */

.form-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 1px;
}

.btn-primary,
.btn-secondary {
  min-height: 40px;
  padding: 9px 17px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 700;
  font-family: inherit;
  cursor: pointer;
  transition:
    background .15s ease,
    border-color .15s ease,
    color .15s ease,
    transform .15s ease;
}

.btn-primary {
  background: #2563eb;
  border: 1px solid #2563eb;
  color: #fff;
}

.btn-primary:hover:not(:disabled) {
  background: #1d4ed8;
  border-color: #1d4ed8;
  transform: translateY(-1px);
}

.btn-primary:disabled {
  opacity: .55;
  cursor: not-allowed;
}

.btn-secondary {
  background: var(--panel);
  border: 1px solid var(--border);
  color: var(--text-dim);
}

.btn-secondary:hover {
  color: var(--text);
  border-color: var(--text-dim);
  transform: translateY(-1px);
}

/* =========================
   PAGINATION
   ========================= */

.pagination-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding-top: 1px;
}

.page-btn {
  min-height: 34px;
  padding: 8px 13px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text-dim);
  font-size: 11px;
  font-weight: 650;
  cursor: pointer;
  transition:
    color .15s ease,
    border-color .15s ease,
    background .15s ease;
}

.page-btn:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--text-dim);
  background: var(--panel);
}

.page-btn:disabled {
  opacity: .4;
  cursor: not-allowed;
}

.page-info {
  color: var(--text-dim);
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* =========================
   ACCESSIBILITY / FOCUS
   ========================= */

button:focus-visible,
input:focus-visible,
select:focus-visible {
  outline: 2px solid var(--blue, #2563eb);
  outline-offset: 2px;
}

/* =========================
   RESPONSIVE
   ========================= */

@media (max-width: 1250px) {
  .summary-bar {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .entry-card-grid {
    grid-template-columns: repeat(4, minmax(100px, 1fr));
  }

  .form-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 900px) {
  .trades-overlay {
    padding: 10px;
  }

  .trades-modal {
    max-height: calc(100vh - 20px);
    padding: 22px;
    gap: 18px;
  }

  .trades-header {
    top: -22px;
  }

  .summary-bar {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .entry-card-grid {
    grid-template-columns: repeat(2, minmax(110px, 1fr));
  }

  .form-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .trades-overlay {
    padding: 0;
  }

  .trades-modal {
    width: 100%;
    max-width: 100%;
    height: 100vh;
    max-height: none;
    padding: 18px 15px 22px;
    gap: 17px;
    border-radius: 0;
    border-left: 0;
    border-right: 0;
  }

  .trades-header {
    top: -18px;
    padding-bottom: 14px;
  }

  .trades-title {
    font-size: 18px;
  }

  .summary-bar {
    gap: 7px;
  }

  .summary-card {
    min-height: 72px;
    padding: 10px 11px;
  }

  .summary-label {
    font-size: 9px;
  }

  .summary-card strong {
    font-size: 16px;
  }

  .view-tabs {
    max-width: 100%;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .view-tabs::-webkit-scrollbar {
    display: none;
  }

  .view-tab {
    padding: 8px 11px;
    font-size: 11px;
  }

  .table-header-row {
    align-items: stretch;
    flex-direction: column;
  }

  .search-box {
    width: 100%;
    max-width: none;
  }

  .entry-card {
    padding: 14px;
  }

  .form-grid {
    grid-template-columns: 1fr;
  }

  .form-field-wide {
    grid-column: span 1;
  }

  .trade-form {
    padding: 16px;
  }

  .form-actions {
    justify-content: stretch;
  }

  .form-actions button {
    flex: 1;
  }

  .pagination-bar {
    flex-wrap: wrap;
  }

  .page-info {
    order: -1;
    width: 100%;
    text-align: center;
  }
}

@media (max-width: 420px) {
  .summary-bar {
    grid-template-columns: 1fr;
  }

  .summary-card strong {
    font-size: 15px;
  }

  .entry-card-grid {
    grid-template-columns: 1fr;
  }

  .trades-title {
    font-size: 17px;
  }
}
</style>