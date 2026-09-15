<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, watch } from 'vue'
import {
  getTrades,
  getTradesSummary,
  createTrade,
  updateTrade,
  deleteTrade
} from '../services/tradesService'

const emit = defineEmits(['close'])

const DOLARAPI_LIST_URL = 'https://dolarapi.com/v1/dolares'
const CCL_REFRESH_MS = 60000

const CEDEARS_LIVE_URL = 'https://data912.com/live/arg_cedears'
const CEDEARS_REFRESH_MS = 30000

const HISTORICAL_CCL_BASE =
  'https://api.argentinadatos.com/v1/cotizaciones/dolares/contadoconliqui'

const USA_STOCKS_LIVE_URL = 'https://data912.com/live/usa_stocks'
const USA_ADRS_LIVE_URL = 'https://data912.com/live/usa_adrs'
const USA_PRICES_REFRESH_MS = 60000

const CEDEAR_RATIOS_URL =
  'https://ferminrp.github.io/google-sheets-argento/api/cedears.json'

const trades = ref([])
const summary = ref({
  bySymbol: [],
  totals: {
    realizedPL: 0,
    realizedPLUSD: 0,
    invested: 0,
    investedUSD: 0,
    openPositions: 0,
    totalTrades: 0
  }
})

const loading = ref(false)
const errorMsg = ref('')
const saving = ref(false)

const editingId = ref(null)
const viewMode = ref('form')

const cclActual = ref(null)
const cclInterval = ref(null)

const liveCedears = ref([])
const cedearInterval = ref(null)

const usaPrices = ref([])
const usaPricesInterval = ref(null)

const cedearRatios = ref({})
const cedearRatiosAuto = ref({})

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
    notes: ''
  }
}

const form = reactive(emptyForm())

function formatMoney(value, decimals = 2) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '-'

  return n.toLocaleString('es-AR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  })
}

function formatNum(value, decimals = 2) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '-'

  return n.toLocaleString('es-AR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  })
}

function formatPct(value, decimals = 2) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '-'

  return `${n.toLocaleString('es-AR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  })}%`
}

function formatDate(value) {
  if (!value) return '-'

  const d = new Date(value + 'T00:00:00')

  if (Number.isNaN(d.getTime())) return value

  return d.toLocaleDateString('es-AR')
}

const searchQuery = ref('')
const currentPage = ref(1)
const PAGE_SIZE = 10

const filteredTrades = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()

  if (!q) return trades.value

  return trades.value.filter(trade => {
    return [
      trade.ticker,
      trade.assetType,
      trade.operation,
      trade.notes,
      trade.date
    ]
      .filter(Boolean)
      .some(value => String(value).toLowerCase().includes(q))
  })
})

const sortedTrades = computed(() => {
  return [...filteredTrades.value].sort((a, b) => {
    const dateA = new Date(a.date || 0).getTime()
    const dateB = new Date(b.date || 0).getTime()

    if (dateA !== dateB) return dateB - dateA

    return Number(b.id || 0) - Number(a.id || 0)
  })
})

const totalPages = computed(() => {
  return Math.max(1, Math.ceil(sortedTrades.value.length / PAGE_SIZE))
})

const paginatedTrades = computed(() => {
  const start = (currentPage.value - 1) * PAGE_SIZE

  return sortedTrades.value.slice(start, start + PAGE_SIZE)
})

function goToPage(page) {
  const p = Math.min(Math.max(1, page), totalPages.value)
  currentPage.value = p
}

watch(searchQuery, () => {
  currentPage.value = 1
})

watch(totalPages, value => {
  if (currentPage.value > value) {
    currentPage.value = value
  }
})

const openPositions = computed(() => {
  const rows = summary.value?.bySymbol || []

  return rows
    .filter(row => Number(row.quantity || 0) > 0)
    .map(row => {
      const ticker = String(row.ticker || '').toUpperCase()
      const quantity = Number(row.quantity || 0)
      const avgCost = Number(row.avgCost || row.averageCost || 0)

      const currentPriceARS =
        getLivePrice(ticker) ??
        Number(row.currentPrice || row.price || 0)

      const marketValueARS = quantity * currentPriceARS
      const investedARS = quantity * avgCost
      const unrealizedARS = marketValueARS - investedARS

      let currentValueUSD = 0
      let unrealizedUSD = 0
      let impliedCCL = null

      if (row.assetType === 'CEDEAR') {
        const ratio = getCedearRatio(ticker)
        const underlyingUSD = getUnderlyingPriceUSD(ticker)

        if (
          ratio &&
          Number.isFinite(ratio) &&
          underlyingUSD &&
          Number.isFinite(underlyingUSD)
        ) {
          currentValueUSD =
            (quantity * underlyingUSD) / ratio

          unrealizedUSD =
            currentValueUSD -
            (investedARS / (Number(form.ccl) || cclActual.value || 1))

          if (underlyingUSD > 0) {
            impliedCCL =
              currentPriceARS * ratio / underlyingUSD
          }
        } else {
          const ccl =
            Number(form.ccl) ||
            Number(cclActual.value) ||
            1

          currentValueUSD = marketValueARS / ccl
          unrealizedUSD = unrealizedARS / ccl
        }
      } else {
        const ccl =
          Number(form.ccl) ||
          Number(cclActual.value) ||
          1

        currentValueUSD = marketValueARS / ccl
        unrealizedUSD = unrealizedARS / ccl
      }

      return {
        ...row,
        ticker,
        quantity,
        avgCost,
        currentPriceARS,
        marketValueARS,
        unrealizedARS,
        currentValueUSD,
        unrealizedUSD,
        impliedCCL
      }
    })
})

async function loadAll() {
  loading.value = true
  errorMsg.value = ''

  try {
    const [tradesData, summaryData] = await Promise.all([
      getTrades(),
      getTradesSummary()
    ])

    trades.value = Array.isArray(tradesData) ? tradesData : []

    summary.value = summaryData || {
      bySymbol: [],
      totals: {
        realizedPL: 0,
        realizedPLUSD: 0,
        invested: 0,
        investedUSD: 0,
        openPositions: 0,
        totalTrades: 0
      }
    }
  } catch (error) {
    console.error(error)
    errorMsg.value = 'No se pudieron cargar los trades.'
  } finally {
    loading.value = false
  }
}

async function refreshSummary() {
  try {
    summary.value = await getTradesSummary()
  } catch (error) {
    console.error(error)
  }
}

async function fetchLiveCCL() {
  cclLoading.value = true
  cclMsg.value = ''

  try {
    const response = await fetch(DOLARAPI_LIST_URL)

    if (!response.ok) {
      throw new Error('Error obteniendo dólares')
    }

    const data = await response.json()

    const ccl = Array.isArray(data)
      ? data.find(item =>
          String(item.nombre || item.casa || '')
            .toLowerCase()
            .includes('contado con liqui')
        )
      : null

    if (!ccl) {
      throw new Error('No se encontró CCL')
    }

    const value =
      Number(ccl.venta) ||
      Number(ccl.compra) ||
      null

    if (value) {
      cclActual.value = value
      cclIsAuto.value = true

      if (!editingId.value && !form.ccl) {
        form.ccl = value
      }
    }
  } catch (error) {
    console.error(error)
    cclMsg.value = 'No se pudo actualizar el CCL.'
  } finally {
    cclLoading.value = false
  }
}

async function fetchHistoricalCCL(date) {
  if (!date) return null

  try {
    const response = await fetch(
      `${HISTORICAL_CCL_BASE}/${date}`
    )

    if (!response.ok) return null

    const data = await response.json()

    if (typeof data === 'number') return data

    if (Array.isArray(data) && data.length) {
      return Number(
        data[data.length - 1]?.valor ||
        data[data.length - 1]?.venta ||
        data[data.length - 1]?.value ||
        0
      ) || null
    }

    return Number(
      data?.valor ||
      data?.venta ||
      data?.value ||
      0
    ) || null
  } catch (error) {
    console.error(error)
    return null
  }
}

async function refreshLiveCCL() {
  await fetchLiveCCL()
}

async function autofillCCL() {
  if (!form.date) return

  cclLoading.value = true
  cclMsg.value = ''

  try {
    const historical = await fetchHistoricalCCL(form.date)

    if (historical) {
      form.ccl = historical
      cclIsAuto.value = true
      cclMsg.value = 'CCL histórico cargado.'
      return
    }

    if (form.date === todayISO()) {
      await fetchLiveCCL()
    } else {
      cclMsg.value = 'No se encontró CCL histórico para esa fecha.'
    }
  } finally {
    cclLoading.value = false
  }
}

function onCclManualInput() {
  cclIsAuto.value = false
  cclMsg.value = ''
}

async function refetchCCL() {
  await autofillCCL()
}

watch(
  () => form.date,
  async newDate => {
    if (!newDate) return

    if (!editingId.value) {
      await autofillCCL()
    }
  }
)

async function loadLiveCedears() {
  try {
    const response = await fetch(CEDEARS_LIVE_URL)

    if (!response.ok) {
      throw new Error('Error obteniendo CEDEARs')
    }

    const data = await response.json()

    liveCedears.value = Array.isArray(data) ? data : []
  } catch (error) {
    console.error(error)
  }
}

function getLivePrice(ticker) {
  const symbol = String(ticker || '').toUpperCase()

  const item = liveCedears.value.find(item => {
    return String(
      item.symbol ||
      item.ticker ||
      item.especie ||
      item.name ||
      ''
    ).toUpperCase() === symbol
  })

  if (!item) return null

  return (
    Number(item.price) ||
    Number(item.last) ||
    Number(item.ultimo) ||
    Number(item.px) ||
    null
  )
}

async function loadUSAPrices() {
  try {
    const [stocksResponse, adrsResponse] = await Promise.all([
      fetch(USA_STOCKS_LIVE_URL),
      fetch(USA_ADRS_LIVE_URL)
    ])

    const stocks = stocksResponse.ok
      ? await stocksResponse.json()
      : []

    const adrs = adrsResponse.ok
      ? await adrsResponse.json()
      : []

    usaPrices.value = [
      ...(Array.isArray(stocks) ? stocks : []),
      ...(Array.isArray(adrs) ? adrs : [])
    ]
  } catch (error) {
    console.error(error)
  }
}

function getUnderlyingPriceUSD(ticker) {
  const symbol = String(ticker || '').toUpperCase()

  const item = usaPrices.value.find(item => {
    return String(
      item.symbol ||
      item.ticker ||
      item.name ||
      ''
    ).toUpperCase() === symbol
  })

  if (!item) return null

  return (
    Number(item.price) ||
    Number(item.last) ||
    Number(item.ultimo) ||
    Number(item.px) ||
    null
  )
}

function parseRatio(item) {
  if (item == null) return null

  if (typeof item === 'number') {
    return Number.isFinite(item) ? item : null
  }

  if (typeof item === 'string') {
    const value = Number(
      item
        .replace(',', '.')
        .replace(/[^0-9.-]/g, '')
    )

    return Number.isFinite(value) ? value : null
  }

  if (typeof item === 'object') {
    return (
      parseRatio(item.ratio) ||
      parseRatio(item.ratioCedear) ||
      parseRatio(item.ratio_cedear) ||
      parseRatio(item.value) ||
      parseRatio(item.valor) ||
      null
    )
  }

  return null
}

async function loadCedearRatios() {
  try {
    const response = await fetch(CEDEAR_RATIOS_URL)

    if (!response.ok) {
      throw new Error('Error obteniendo ratios')
    }

    const data = await response.json()

    const result = {}

    if (Array.isArray(data)) {
      data.forEach(item => {
        const ticker = String(
          item.ticker ||
          item.symbol ||
          item.especie ||
          item.nombre ||
          ''
        ).toUpperCase()

        const ratio = parseRatio(item)

        if (ticker && ratio) {
          result[ticker] = ratio
        }
      })
    } else if (data && typeof data === 'object') {
      Object.entries(data).forEach(([ticker, value]) => {
        const ratio = parseRatio(value)

        if (ratio) {
          result[String(ticker).toUpperCase()] = ratio
        }
      })
    }

    cedearRatios.value = result
    cedearRatiosAuto.value = { ...result }
  } catch (error) {
    console.error(error)
  }
}

function getCedearRatio(ticker) {
  const symbol = String(ticker || '').toUpperCase()

  return (
    Number(cedearRatios.value[symbol]) ||
    Number(cedearRatiosAuto.value[symbol]) ||
    null
  )
}

function setManualRatio(ticker, value) {
  const symbol = String(ticker || '').toUpperCase()
  const ratio = Number(value)

  if (!symbol) return

  if (Number.isFinite(ratio) && ratio > 0) {
    cedearRatios.value[symbol] = ratio
  } else {
    cedearRatios.value[symbol] =
      cedearRatiosAuto.value[symbol] || null
  }
}

function startEdit(trade) {
  editingId.value = trade.id

  Object.assign(form, {
    date: trade.date || todayISO(),
    assetType: trade.assetType || 'CEDEAR',
    ticker: trade.ticker || '',
    operation: trade.operation || 'COMPRA',
    quantity: trade.quantity ?? '',
    price: trade.price ?? '',
    fee: trade.fee ?? '',
    ccl: trade.ccl ?? '',
    notes: trade.notes || ''
  })

  viewMode.value = 'form'
}

function cancelEdit() {
  editingId.value = null
  Object.assign(form, emptyForm())

  if (cclActual.value) {
    form.ccl = cclActual.value
  }
}

async function submitForm() {
  if (saving.value) return

  saving.value = true
  errorMsg.value = ''

  try {
    const payload = {
      date: form.date,
      assetType: form.assetType,
      ticker: String(form.ticker || '').toUpperCase().trim(),
      operation: form.operation,
      quantity: Number(form.quantity),
      price: Number(form.price),
      fee: Number(form.fee || 0),
      ccl: Number(form.ccl || 0),
      notes: form.notes
    }

    if (editingId.value) {
      await updateTrade(editingId.value, payload)
    } else {
      await createTrade(payload)
    }

    cancelEdit()
    await loadAll()
  } catch (error) {
    console.error(error)
    errorMsg.value =
      error?.message ||
      'No se pudo guardar el trade.'
  } finally {
    saving.value = false
  }
}

async function removeTrade(id) {
  if (!confirm('¿Querés eliminar este trade?')) return

  try {
    await deleteTrade(id)

    if (editingId.value === id) {
      cancelEdit()
    }

    await loadAll()
  } catch (error) {
    console.error(error)
    errorMsg.value =
      error?.message ||
      'No se pudo eliminar el trade.'
  }
}

function close() {
  emit('close')
}

function onOverlayClick(event) {
  if (event.target === event.currentTarget) {
    close()
  }
}

onMounted(async () => {
  await loadAll()

  await Promise.all([
    fetchLiveCCL(),
    loadLiveCedears(),
    loadUSAPrices(),
    loadCedearRatios()
  ])

  cclInterval.value = setInterval(
    refreshLiveCCL,
    CCL_REFRESH_MS
  )

  cedearInterval.value = setInterval(
    loadLiveCedears,
    CEDEARS_REFRESH_MS
  )

  usaPricesInterval.value = setInterval(
    loadUSAPrices,
    USA_PRICES_REFRESH_MS
  )
})

onUnmounted(() => {
  if (cclInterval.value) {
    clearInterval(cclInterval.value)
  }

  if (cedearInterval.value) {
    clearInterval(cedearInterval.value)
  }

  if (usaPricesInterval.value) {
    clearInterval(usaPricesInterval.value)
  }
})
</script>

<template>
  <div
    class="trades-overlay"
    @click="onOverlayClick"
  >
    <div class="trades-modal">

      <!-- HEADER -->
      <header class="trades-header">
        <div class="trades-title">
          <span>📒</span>
          <span>Bitácora de Trades</span>
        </div>

        <button
          class="close-btn"
          type="button"
          aria-label="Cerrar"
          @click="close"
        >
          ✕
        </button>
      </header>

      <!-- LOADING -->
      <div
        v-if="loading"
        class="loading"
      >
        Cargando operaciones...
      </div>

      <!-- ERROR -->
      <div
        v-if="errorMsg"
        class="error-msg"
      >
        {{ errorMsg }}
      </div>

      <!-- SUMMARY -->
      <section class="summary-bar">

        <div class="summary-card">
          <span class="summary-label">
            Resultado realizado ARS
          </span>

          <strong
            :class="{
              'pl-pos':
                Number(summary.totals?.realizedPL) > 0,
              'pl-neg':
                Number(summary.totals?.realizedPL) < 0
            }"
          >
            $ {{ formatMoney(summary.totals?.realizedPL || 0) }}
          </strong>
        </div>

        <div class="summary-card">
          <span class="summary-label">
            Resultado realizado USD
          </span>

          <strong
            :class="{
              'pl-pos':
                Number(summary.totals?.realizedPLUSD) > 0,
              'pl-neg':
                Number(summary.totals?.realizedPLUSD) < 0
            }"
          >
            USD {{ formatMoney(summary.totals?.realizedPLUSD || 0) }}
          </strong>
        </div>

        <div class="summary-card">
          <span class="summary-label">
            Capital invertido
          </span>

          <strong>
            $ {{ formatMoney(summary.totals?.invested || 0) }}
          </strong>
        </div>

        <div class="summary-card">
          <span class="summary-label">
            Posiciones abiertas
          </span>

          <strong>
            {{ summary.totals?.openPositions || 0 }}
          </strong>
        </div>

        <div class="summary-card">
          <span class="summary-label">
            Total de operaciones
          </span>

          <strong>
            {{ summary.totals?.totalTrades || trades.length }}
          </strong>
        </div>

        <div class="summary-card">
          <span class="summary-label">
            CCL actual
          </span>

          <strong>
            $
            {{ cclActual ? formatMoney(cclActual) : '-' }}
          </strong>
        </div>

      </section>

      <!-- TABS -->
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

      <!-- =====================================================
           LIST VIEW
           ===================================================== -->
      <section
        v-if="viewMode === 'list'"
        class="full-detail-screen"
      >

        <div class="table-header-row">
          <h3 class="section-title">
            Historial completo de operaciones
          </h3>

          <input
            v-model="searchQuery"
            type="search"
            class="search-input"
            placeholder="Buscar ticker, operación..."
          >
        </div>

        <div
          v-if="!paginatedTrades.length"
          class="empty-state"
        >
          No hay operaciones que coincidan con la búsqueda.
        </div>

        <div
          v-else
          class="entry-cards"
        >

          <article
            v-for="trade in paginatedTrades"
            :key="trade.id"
            class="entry-card"
          >

            <div class="entry-card-header">

              <div class="entry-card-ticker">

                <strong>
                  {{ trade.ticker }}
                </strong>

                <span class="badge">
                  {{ trade.assetType }}
                </span>

                <span
                  class="badge"
                  :class="
                    trade.operation === 'COMPRA'
                      ? 'badge-compra'
                      : 'badge-venta'
                  "
                >
                  {{ trade.operation }}
                </span>

              </div>

              <div class="entry-card-actions">

                <button
                  type="button"
                  class="icon-btn"
                  title="Editar"
                  @click="startEdit(trade)"
                >
                  ✎
                </button>

                <button
                  type="button"
                  class="icon-btn icon-btn-danger"
                  title="Eliminar"
                  @click="removeTrade(trade.id)"
                >
                  🗑
                </button>

              </div>

            </div>

            <div class="entry-card-grid">

              <div class="detail-item">
                <label>Fecha</label>
                <strong>
                  {{ formatDate(trade.date) }}
                </strong>
              </div>

              <div class="detail-item">
                <label>Cantidad</label>
                <strong>
                  {{ formatNum(trade.quantity, 4) }}
                </strong>
              </div>

              <div class="detail-item">
                <label>Precio unitario</label>
                <strong>
                  $ {{ formatMoney(trade.price) }}
                </strong>
              </div>

              <div class="detail-item">
                <label>CCL</label>
                <strong>
                  $
                  {{
                    trade.ccl
                      ? formatMoney(trade.ccl)
                      : '-'
                  }}
                </strong>
              </div>

              <div class="detail-item">
                <label>Precio USD</label>
                <strong>
                  USD
                  {{
                    trade.ccl && trade.price
                      ? formatMoney(
                          Number(trade.price) /
                            Number(trade.ccl)
                        )
                      : '-'
                  }}
                </strong>
              </div>

              <div class="detail-item">
                <label>Comisión</label>
                <strong>
                  $ {{ formatMoney(trade.fee || 0) }}
                </strong>
              </div>

              <div class="detail-item">
                <label>Total</label>
                <strong>
                  $
                  {{
                    formatMoney(
                      Number(trade.quantity || 0) *
                        Number(trade.price || 0) +
                        Number(trade.fee || 0)
                    )
                  }}
                </strong>
              </div>

            </div>

            <div
              v-if="trade.notes"
              class="entry-card-notes"
            >
              <span>Notas</span>
              <strong>{{ trade.notes }}</strong>
            </div>

          </article>

        </div>

        <div
          v-if="totalPages > 1"
          class="pagination"
        >

          <button
            type="button"
            :disabled="currentPage === 1"
            @click="goToPage(currentPage - 1)"
          >
            ‹
          </button>

          <button
            v-for="page in totalPages"
            :key="page"
            type="button"
            :class="{ active: page === currentPage }"
            @click="goToPage(page)"
          >
            {{ page }}
          </button>

          <button
            type="button"
            :disabled="currentPage === totalPages"
            @click="goToPage(currentPage + 1)"
          >
            ›
          </button>

        </div>

      </section>

      <!-- =====================================================
           FORM VIEW
           ===================================================== -->
      <template v-else>

        <!-- OPEN POSITIONS -->
        <section
          v-if="openPositions.length"
          class="by-symbol-section"
        >

          <div class="table-header-row">
            <h3 class="section-title">
              Posiciones abiertas
            </h3>
          </div>

          <div class="by-symbol-table-wrap">

            <table class="by-symbol-table positions-table">

              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Cantidad</th>
                  <th>Costo prom. ARS</th>
                  <th>Precio actual ARS</th>
                  <th>Valor actual ARS</th>
                  <th>Rendimiento ARS</th>
                  <th>Valor actual USD</th>
                  <th>Rendimiento USD</th>
                </tr>
              </thead>

              <tbody>

                <tr
                  v-for="position in openPositions"
                  :key="position.ticker"
                >

                  <td class="ticker-cell">

                    <div>
                      <span>
                        {{ position.ticker }}
                      </span>

                      <span class="badge">
                        {{ position.assetType }}
                      </span>
                    </div>

                    <div
                      v-if="position.assetType === 'CEDEAR'"
                      class="ratio-row"
                    >
                      <span>Ratio</span>

                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        :value="getCedearRatio(position.ticker) || ''"
                        @change="
                          setManualRatio(
                            position.ticker,
                            $event.target.value
                          )
                        "
                      >

                      <span
                        v-if="
                          cedearRatiosAuto[position.ticker]
                        "
                        class="auto-tag"
                      >
                        auto
                      </span>

                      <span
                        v-if="position.impliedCCL"
                        class="ratio-subrow-ccl"
                      >
                        CCL implícito:
                        $
                        {{
                          formatMoney(
                            position.impliedCCL
                          )
                        }}
                      </span>
                    </div>

                  </td>

                  <td>
                    {{ formatNum(position.quantity, 4) }}
                  </td>

                  <td>
                    $
                    {{ formatMoney(position.avgCost) }}
                  </td>

                  <td>
                    $
                    {{
                      formatMoney(
                        position.currentPriceARS
                      )
                    }}
                  </td>

                  <td>
                    $
                    {{
                      formatMoney(
                        position.marketValueARS
                      )
                    }}
                  </td>

                  <td
                    :class="
                      position.unrealizedARS >= 0
                        ? 'pl-pos'
                        : 'pl-neg'
                    "
                  >
                    $
                    {{
                      formatMoney(
                        position.unrealizedARS
                      )
                    }}
                  </td>

                  <td>
                    USD
                    {{
                      formatMoney(
                        position.currentValueUSD
                      )
                    }}
                  </td>

                  <td
                    :class="
                      position.unrealizedUSD >= 0
                        ? 'pl-pos'
                        : 'pl-neg'
                    "
                  >
                    USD
                    {{
                      formatMoney(
                        position.unrealizedUSD
                      )
                    }}
                  </td>

                </tr>

              </tbody>

            </table>

          </div>

          <p class="table-hint">
            En CEDEARs, el valor USD se calcula utilizando
            el <strong>ratio del CEDEAR</strong> y el precio
            de la acción subyacente.
          </p>

        </section>

        <!-- HISTORICAL SUMMARY -->
        <section class="history-section">

          <div class="table-header-row">
            <h3 class="section-title">
              Resumen histórico por ticker
            </h3>
          </div>

          <div class="by-symbol-table-wrap">

            <table class="by-symbol-table history-table">

              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Tipo</th>
                  <th>Comprado</th>
                  <th>Vendido</th>
                  <th>Posición</th>
                  <th>Invertido</th>
                  <th>Realizado ARS</th>
                  <th>Realizado USD</th>
                </tr>
              </thead>

              <tbody>

                <tr
                  v-for="row in summary.bySymbol"
                  :key="row.ticker"
                >

                  <td class="ticker-cell">
                    {{ row.ticker }}
                  </td>

                  <td>
                    <span class="badge">
                      {{ row.assetType }}
                    </span>
                  </td>

                  <td>
                    {{ formatNum(row.bought || 0, 4) }}
                  </td>

                  <td>
                    {{ formatNum(row.sold || 0, 4) }}
                  </td>

                  <td>
                    {{ formatNum(row.quantity || 0, 4) }}
                  </td>

                  <td>
                    $
                    {{
                      formatMoney(
                        row.invested || 0
                      )
                    }}
                  </td>

                  <td
                    :class="
                      Number(row.realizedPL || 0) >= 0
                        ? 'pl-pos'
                        : 'pl-neg'
                    "
                  >
                    $
                    {{
                      formatMoney(
                        row.realizedPL || 0
                      )
                    }}
                  </td>

                  <td
                    :class="
                      Number(row.realizedPLUSD || 0) >= 0
                        ? 'pl-pos'
                        : 'pl-neg'
                    "
                  >
                    USD
                    {{
                      formatMoney(
                        row.realizedPLUSD || 0
                      )
                    }}
                  </td>

                </tr>

              </tbody>

            </table>

          </div>

        </section>

        <!-- FORM -->
        <section class="trade-form">

          <div class="table-header-row">

            <h3 class="section-title">
              {{
                editingId
                  ? 'Editar operación'
                  : 'Nueva operación'
              }}
            </h3>

          </div>

          <div class="form-grid">

            <!-- DATE -->
            <div class="form-field">

              <label>
                Fecha
              </label>

              <input
                v-model="form.date"
                type="date"
              >

            </div>

            <!-- ASSET -->
            <div class="form-field">

              <label>
                Activo
              </label>

              <select v-model="form.assetType">
                <option value="CEDEAR">
                  CEDEAR
                </option>

                <option value="ACCION">
                  Acción
                </option>

                <option value="ADR">
                  ADR
                </option>

                <option value="BONO">
                  Bono
                </option>

                <option value="ON">
                  ON
                </option>

                <option value="FCI">
                  FCI
                </option>

                <option value="OTRO">
                  Otro
                </option>
              </select>

            </div>

            <!-- TICKER -->
            <div class="form-field">

              <label>
                Ticker
              </label>

              <input
                v-model="form.ticker"
                type="text"
                placeholder="Ej: AAPL"
                @input="
                  form.ticker =
                    form.ticker.toUpperCase()
                "
              >

            </div>

            <!-- OPERATION -->
            <div class="form-field">

              <label>
                Operación
              </label>

              <select v-model="form.operation">
                <option value="COMPRA">
                  COMPRA
                </option>

                <option value="VENTA">
                  VENTA
                </option>
              </select>

            </div>

            <!-- QUANTITY -->
            <div class="form-field">

              <label>
                Cantidad
              </label>

              <input
                v-model="form.quantity"
                type="number"
                min="0"
                step="0.0001"
                placeholder="0"
              >

            </div>

            <!-- PRICE -->
            <div class="form-field">

              <label>
                Precio unitario ARS
              </label>

              <input
                v-model="form.price"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
              >

            </div>

            <!-- FEE -->
            <div class="form-field">

              <label>
                Comisión
              </label>

              <input
                v-model="form.fee"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
              >

            </div>

            <!-- CCL -->
            <div class="form-field">

              <label>
                CCL
                <span
                  v-if="cclIsAuto"
                  class="auto-tag"
                >
                  automático
                </span>
              </label>

              <div class="ccl-input-row">

                <input
                  v-model="form.ccl"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="CCL"
                  @input="onCclManualInput"
                >

                <button
                  type="button"
                  class="icon-btn"
                  title="Actualizar CCL"
                  :disabled="cclLoading"
                  @click="refetchCCL"
                >
                  ↻
                </button>

              </div>

              <div
                v-if="cclMsg"
                class="ccl-hint"
              >
                {{ cclMsg }}
              </div>

            </div>

            <!-- NOTES -->
            <div class="form-field form-field-wide">

              <label>
                Notas
              </label>

              <textarea
                v-model="form.notes"
                rows="2"
                placeholder="Motivo de entrada, estrategia, observaciones..."
              />

            </div>

          </div>

          <div
            v-if="errorMsg"
            class="error-msg"
          >
            {{ errorMsg }}
          </div>

          <div class="form-actions">

            <button
              v-if="editingId"
              type="button"
              class="btn-secondary"
              @click="cancelEdit"
            >
              Cancelar
            </button>

            <button
              type="button"
              class="btn-primary"
              :disabled="saving"
              @click="submitForm"
            >
              {{
                saving
                  ? 'Guardando...'
                  : editingId
                    ? 'Guardar cambios'
                    : 'Registrar trade'
              }}
            </button>

          </div>

        </section>

      </template>

    </div>
  </div>
</template>

<style scoped>
/* =========================================================
   TRADING JOURNAL — PROFESSIONAL UI
   Visual layer only. No business logic modified.
   ========================================================= */

.trades-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  padding: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.72);
  backdrop-filter: blur(5px);
  -webkit-backdrop-filter: blur(5px);
}

.trades-modal {
  --accent: var(--blue, #2563eb);

  box-sizing: border-box;
  width: min(1500px, 100%);
  max-height: calc(100vh - 36px);
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;

  display: flex;
  flex-direction: column;
  gap: 22px;

  padding: 26px 30px 30px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 16px;

  color: var(--text);
  font-size: 14px;
  line-height: 1.5;

  box-shadow:
    0 24px 70px rgba(0, 0, 0, 0.38),
    0 4px 18px rgba(0, 0, 0, 0.22);
}

.trades-modal,
.trades-modal * {
  box-sizing: border-box;
}

.trades-modal::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.trades-modal::-webkit-scrollbar-track {
  background: transparent;
}

.trades-modal::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 999px;
}

.trades-modal::-webkit-scrollbar-thumb:hover {
  background: var(--text-dim);
}

/* HEADER */

.trades-header {
  position: sticky;
  top: -26px;
  z-index: 20;

  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;

  padding: 0 0 18px;
  background: var(--panel);
  border-bottom: 1px solid var(--border);
}

.trades-title {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;

  color: var(--text);
  font-size: 21px;
  font-weight: 750;
  letter-spacing: -0.01em;
}

.close-btn {
  flex: 0 0 auto;
  width: 36px;
  height: 36px;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 9px;
  color: var(--text-dim);
  cursor: pointer;
  font-size: 16px;

  transition:
    color 0.15s ease,
    border-color 0.15s ease,
    background 0.15s ease,
    transform 0.15s ease;
}

.close-btn:hover {
  color: var(--text);
  border-color: var(--text-dim);
  background: var(--panel);
  transform: translateY(-1px);
}

/* LOADING / ERROR */

.loading {
  padding: 12px 14px;
  color: var(--text-dim);
  text-align: center;
}

.error-msg {
  padding: 11px 14px;
  color: #fca5a5;
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.28);
  border-radius: 9px;
}

/* SUMMARY */

.summary-bar {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 10px;
}

.summary-card {
  min-width: 0;
  min-height: 82px;

  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 5px;

  padding: 13px 15px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 11px;

  transition:
    border-color 0.15s ease,
    transform 0.15s ease;
}

.summary-card:hover {
  border-color: color-mix(
    in srgb,
    var(--border) 60%,
    var(--accent)
  );

  transform: translateY(-1px);
}

.summary-label {
  color: var(--text-dim);
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.045em;
  line-height: 1.2;
  text-transform: uppercase;
}

.summary-card strong {
  min-width: 0;
  overflow: hidden;

  color: var(--text);
  font-size: 21px;
  font-weight: 750;
  line-height: 1.15;

  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* TABS */

.view-tabs {
  display: flex;
  align-items: center;
  gap: 6px;

  padding: 4px;

  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 11px;
}

.view-tab {
  flex: 0 0 auto;

  padding: 9px 15px;

  background: transparent;
  border: 1px solid transparent;
  border-radius: 8px;

  color: var(--text-dim);
  cursor: pointer;

  font-size: 13px;
  font-weight: 650;
  white-space: nowrap;

  transition:
    color 0.15s ease,
    background 0.15s ease,
    border-color 0.15s ease;
}

.view-tab:hover {
  color: var(--text);
  background: var(--panel);
}

.view-tab.active {
  color: var(--text);
  background: rgba(37, 99, 235, 0.12);
  border-color: rgba(37, 99, 235, 0.55);

  box-shadow:
    inset 0 0 0 1px rgba(37, 99, 235, 0.08);
}

/* GENERIC SECTION */

.section-title {
  margin: 0;

  color: var(--text);
  font-size: 14px;
  font-weight: 750;
  letter-spacing: 0.01em;
}

.table-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.table-header-row h3 {
  margin: 0;
}

.search-input {
  width: min(320px, 100%);
  min-width: 0;

  padding: 10px 12px;

  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);

  font: inherit;
  font-size: 13px;

  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}

.search-input::placeholder {
  color: var(--text-dim);
}

.search-input:focus {
  outline: none;
  border-color: var(--accent);

  box-shadow:
    0 0 0 3px rgba(37, 99, 235, 0.12);
}

/* FULL DETAIL */

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

  padding: 17px 19px;

  display: flex;
  flex-direction: column;
  gap: 13px;

  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 11px;

  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}

.entry-card:hover {
  border-color: color-mix(
    in srgb,
    var(--border) 65%,
    var(--accent)
  );

  box-shadow:
    0 5px 18px rgba(0, 0, 0, 0.14);
}

.entry-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.entry-card-ticker {
  min-width: 0;

  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
}

.entry-card-ticker strong {
  color: var(--text);
  font-size: 16px;
  font-weight: 750;
}

.entry-card-actions {
  flex: 0 0 auto;

  display: flex;
  align-items: center;
  gap: 6px;
}

.entry-card-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(120px, 1fr));
  gap: 1px;

  overflow: hidden;

  background: var(--border);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.detail-item {
  min-width: 0;
  padding: 10px 12px;
  background: var(--bg);
}

.detail-item label {
  display: block;
  margin-bottom: 3px;

  color: var(--text-dim);
  font-size: 10.5px;
  font-weight: 650;
  letter-spacing: 0.04em;
  line-height: 1.2;
  text-transform: uppercase;
}

.detail-item strong {
  display: block;
  min-width: 0;
  overflow: hidden;

  color: var(--text);
  font-size: 13px;
  font-weight: 650;

  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.entry-card-notes {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: baseline;
  gap: 10px;

  padding-top: 11px;
  border-top: 1px solid var(--border);

  color: var(--text-dim);
  font-size: 12.5px;
}

.entry-card-notes strong {
  color: var(--text);
  font-weight: 500;
  overflow-wrap: anywhere;
}

.empty-state {
  padding: 34px 20px;

  color: var(--text-dim);

  background: var(--bg);
  border: 1px dashed var(--border);
  border-radius: 11px;

  text-align: center;
}

/* BADGES / P&L */

.badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;

  min-height: 22px;
  padding: 3px 8px;

  border: 1px solid var(--border);
  border-radius: 999px;

  color: var(--text-dim);
  font-size: 10.5px;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
}

.badge-compra {
  color: #4ade80;
  background: rgba(34, 197, 94, 0.08);
  border-color: rgba(34, 197, 94, 0.22);
}

.badge-venta {
  color: #f87171;
  background: rgba(239, 68, 68, 0.08);
  border-color: rgba(239, 68, 68, 0.22);
}

.pct-tag {
  display: inline-flex;
  align-items: center;

  min-height: 20px;
  padding: 2px 7px;

  border: 1px solid var(--border);
  border-radius: 999px;

  font-size: 10.5px;
  font-weight: 700;
  line-height: 1;
}

.pl-pos {
  color: #22c55e !important;
}

.pl-neg {
  color: #ef4444 !important;
}

/* TABLES */

.by-symbol-table-wrap,
.trades-table-wrap {
  width: 100%;
  overflow: auto;

  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 11px;

  scrollbar-gutter: stable;
}

.by-symbol-table-wrap {
  max-height: 390px;
}

.trades-table-wrap {
  max-height: 520px;
}

.by-symbol-table-wrap::-webkit-scrollbar,
.trades-table-wrap::-webkit-scrollbar {
  width: 7px;
  height: 7px;
}

.by-symbol-table-wrap::-webkit-scrollbar-thumb,
.trades-table-wrap::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 999px;
}

.by-symbol-table,
.trades-table {
  width: 100%;

  border-collapse: separate;
  border-spacing: 0;

  font-size: 12.5px;
  font-variant-numeric: tabular-nums;
}

.by-symbol-table {
  min-width: 1120px;
}

.trades-table {
  min-width: 900px;
}

.by-symbol-table th,
.by-symbol-table td,
.trades-table th,
.trades-table td {
  padding: 10px 13px;
  border-bottom: 1px solid var(--border);
  vertical-align: middle;
}

.by-symbol-table th,
.trades-table th {
  position: sticky;
  top: 0;
  z-index: 5;

  background: var(--bg);
  color: var(--text-dim);

  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.045em;
  line-height: 1.2;
  text-transform: uppercase;
  white-space: nowrap;
}

.by-symbol-table td,
.trades-table td {
  color: var(--text);
  white-space: nowrap;
}

.by-symbol-table tr:last-child td,
.trades-table tr:last-child td {
  border-bottom: 0;
}

.by-symbol-table tbody tr:hover td,
.trades-table tbody tr:hover td {
  background: rgba(255, 255, 255, 0.018);
}

.positions-table th:not(:first-child),
.positions-table td:not(:first-child),
.history-table th:not(:first-child),
.history-table td:not(:first-child),
.trades-table th:not(:first-child),
.trades-table td:not(:first-child) {
  text-align: right;
}

.positions-table th:first-child,
.positions-table td:first-child,
.history-table th:first-child,
.history-table td:first-child {
  text-align: left;
}

.ticker-cell {
  min-width: 155px;

  color: var(--text);
  font-size: 13px;
  font-weight: 750;
}

.ticker-cell > div:first-child {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
}

.ratio-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;

  margin-top: 6px;

  color: var(--text-dim);
  font-size: 10.5px;
  font-weight: 500;
}

.ratio-row input {
  width: 55px;
  height: 24px;
  padding: 3px 6px;

  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 6px;

  color: var(--text);

  font: inherit;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.ratio-row input:focus {
  outline: none;
  border-color: var(--accent);

  box-shadow:
    0 0 0 2px rgba(37, 99, 235, 0.10);
}

.table-hint {
  margin: -4px 1px 0;

  color: var(--text-dim);
  font-size: 11px;
  line-height: 1.45;
}

.table-hint strong {
  color: var(--text);
  font-weight: 650;
}

.by-symbol-section,
.history-section {
  display: flex;
  flex-direction: column;
  gap: 9px;
}

/* PAGINATION */

.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 5px;

  padding-top: 3px;
}

.pagination button {
  min-width: 32px;
  height: 32px;
  padding: 0 9px;

  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 7px;

  color: var(--text-dim);
  cursor: pointer;

  font: inherit;
  font-size: 12px;
  font-weight: 650;
}

.pagination button:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--text-dim);
}

.pagination button.active {
  color: #fff;
  background: #2563eb;
  border-color: #2563eb;
}

.pagination button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.pagination span {
  padding: 0 4px;
  color: var(--text-dim);
}

/* ACTIONS */

.actions-cell {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}

.icon-btn {
  width: 31px;
  height: 31px;
  padding: 0;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 7px;

  color: var(--text-dim);
  cursor: pointer;

  font-size: 13px;

  transition:
    color 0.15s ease,
    border-color 0.15s ease,
    background 0.15s ease;
}

.icon-btn:hover {
  color: var(--text);
  border-color: var(--text-dim);
  background: var(--panel);
}

.icon-btn-danger:hover {
  color: #ef4444;
  border-color: rgba(239, 68, 68, 0.6);
  background: rgba(239, 68, 68, 0.06);
}

/* FORM */

.trade-form {
  display: flex;
  flex-direction: column;
  gap: 19px;

  padding: 20px 21px;

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
  min-width: 0;

  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-field-wide {
  grid-column: span 2;
}

.form-field label {
  display: flex;
  align-items: center;
  gap: 6px;

  color: var(--text-dim);
  font-size: 11.5px;
  font-weight: 650;
  line-height: 1.25;
}

.auto-tag {
  color: #22c55e;
  font-weight: 650;
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
  font-size: 10.5px;
  line-height: 1.4;
}

.ratio-subrow {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;

  margin-top: 5px;

  color: var(--text-dim);
  font-size: 11px;
  white-space: normal;
}

.ratio-subrow-ccl {
  color: var(--text-dim);
}

.ratio-input {
  width: 62px;
  height: 27px;
  padding: 4px 7px;

  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 6px;

  color: var(--text);

  font: inherit;
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
}

.ratio-input:focus {
  outline: none;
  border-color: var(--accent);

  box-shadow:
    0 0 0 2px rgba(37, 99, 235, 0.10);
}

.form-field input,
.form-field select {
  width: 100%;
  height: 41px;
  min-width: 0;

  padding: 9px 11px;

  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;

  color: var(--text);

  font: inherit;
  font-size: 13px;
  font-variant-numeric: tabular-nums;

  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease,
    background 0.15s ease;
}

.form-field input::placeholder {
  color: var(--text-dim);
}

.form-field input:hover,
.form-field select:hover {
  border-color: var(--text-dim);
}

.form-field input:focus,
.form-field select:focus {
  outline: none;
  border-color: var(--accent);

  box-shadow:
    0 0 0 3px rgba(37, 99, 235, 0.11);
}

.form-field input[type='date'] {
  color-scheme: dark;
}

.form-field textarea {
  width: 100%;
  min-height: 41px;

  resize: vertical;
  padding: 9px 11px;

  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;

  color: var(--text);

  font: inherit;
  font-size: 13px;
}

.form-field textarea:focus {
  outline: none;
  border-color: var(--accent);

  box-shadow:
    0 0 0 3px rgba(37, 99, 235, 0.11);
}

.form-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;

  padding-top: 2px;
}

.btn-primary,
.btn-secondary {
  min-height: 40px;
  padding: 9px 17px;

  border-radius: 8px;
  cursor: pointer;

  font: inherit;
  font-size: 13px;
  font-weight: 700;

  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease,
    transform 0.15s ease;
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
  opacity: 0.55;
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

/* KEYBOARD FOCUS */

.close-btn:focus-visible,
.view-tab:focus-visible,
.icon-btn:focus-visible,
.btn-primary:focus-visible,
.btn-secondary:focus-visible,
.pagination button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

/* RESPONSIVE */

@media (max-width: 1250px) {
  .summary-bar {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .entry-card-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
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
    border-radius: 13px;
  }

  .trades-header {
    top: -22px;
  }

  .summary-bar {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .entry-card-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .form-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 650px) {
  .trades-overlay {
    padding: 0;
  }

  .trades-modal {
    width: 100%;
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

  .close-btn {
    width: 34px;
    height: 34px;
  }

  .summary-card {
    min-height: 73px;
    padding: 11px 12px;
  }

  .summary-card strong {
    font-size: 18px;
  }

  .summary-label {
    font-size: 10px;
  }

  .view-tabs {
    overflow-x: auto;
    justify-content: flex-start;
    scrollbar-width: none;
  }

  .view-tabs::-webkit-scrollbar {
    display: none;
  }

  .view-tab {
    font-size: 12px;
    padding: 8px 11px;
  }

  .table-header-row {
    align-items: stretch;
    flex-direction: column;
    gap: 9px;
  }

  .search-input {
    width: 100%;
  }

  .entry-card {
    padding: 14px;
  }

  .entry-card-header {
    align-items: flex-start;
  }

  .entry-card-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .entry-card-notes {
    grid-template-columns: 1fr;
    gap: 4px;
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
}

@media (max-width: 420px) {
  .summary-bar {
    grid-template-columns: 1fr 1fr;
    gap: 7px;
  }

  .summary-card {
    padding: 10px;
  }

  .summary-card strong {
    font-size: 16px;
  }

  .entry-card-grid {
    grid-template-columns: 1fr;
  }

  .pagination button {
    min-width: 29px;
    height: 29px;
    padding: 0 7px;
  }
}
</style>