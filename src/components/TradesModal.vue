<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue'
import {
  getTrades,
  getTradesSummary,
  createTrade,
  updateTrade,
  deleteTrade,
} from '../services/tradesService'

const emit = defineEmits(['close'])

const trades = ref([])
const loading = ref(true)
const errorMsg = ref('')
const saving = ref(false)

const editingId = ref(null)

// Variables reactivas para simular el "Mercado en Vivo" (Dinamismo tipo Broker)
const globalCcl = ref(1000) 
const livePrices = ref({})

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
    ratio: '',
    exchangeRate: '',
    notes: '',
  }
}

const form = reactive(emptyForm())
const formError = ref('')

function formatMoney(n) {
  const num = Number(n) || 0
  return num.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatPct(n) {
  const num = Number(n) || 0
  return num.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%'
}

function formatDate(d) {
  if (!d) return '—'
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}

const sortedTrades = computed(() =>
  [...trades.value].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id))
)

const refUsdPrice = computed(() => {
  if (form.assetType !== 'CEDEAR') return 0
  const p = Number(form.price)
  const r = Number(form.ratio)
  const ccl = Number(form.exchangeRate)
  if (p > 0 && r > 0 && ccl > 0) {
    return (p * r) / ccl
  }
  return 0
})

// Inicializa los precios en vivo basados en la última operación registrada
function initializeLiveMarket() {
  const chronoSorted = [...trades.value].sort((a, b) => new Date(a.date) - new Date(b.date) || a.id - b.id)
  let lastCcl = globalCcl.value
  
  chronoSorted.forEach(t => {
    livePrices.value[t.ticker] = t.price // Guarda el último precio conocido
    if (t.assetType === 'CEDEAR' && t.exchangeRate) {
      lastCcl = t.exchangeRate // Guarda el último CCL conocido
    }
  })
  globalCcl.value = lastCcl
}

// MOTOR DE PORTAFOLIO EN VIVO (Calcula PPP, Realizado y No Realizado en ARS y USD)
const portfolio = computed(() => {
  const bySymbol = {}
  
  // 1. Reconstruir historial y calcular Costo Promedio Ponderado (PPP)
  const sorted = [...trades.value].sort((a, b) => new Date(a.date) - new Date(b.date) || a.id - b.id)

  sorted.forEach(t => {
    if (!bySymbol[t.ticker]) {
      bySymbol[t.ticker] = {
        ticker: t.ticker,
        assetType: t.assetType,
        qty: 0,
        costArs: 0,
        costUsd: 0,
        realizedPLArs: 0,
        realizedPLUsd: 0,
      }
    }
    
    const s = bySymbol[t.ticker]
    const isCedear = t.assetType === 'CEDEAR'
    const cclTrade = t.exchangeRate || 1
    const priceArs = t.price
    const priceUsd = isCedear && cclTrade > 1 ? (t.price / cclTrade) : 0
    const feeArs = t.fee || 0
    const feeUsd = isCedear && cclTrade > 1 ? (feeArs / cclTrade) : 0

    if (t.operation === 'COMPRA') {
      s.qty += t.quantity
      s.costArs += (priceArs * t.quantity) + feeArs
      if (isCedear) s.costUsd += (priceUsd * t.quantity) + feeUsd
    } else if (t.operation === 'VENTA') {
      if (s.qty > 0) {
        const avgCostArs = s.costArs / s.qty
        const avgCostUsd = s.costUsd / s.qty
        const soldQty = t.quantity
        
        const costOfSoldArs = avgCostArs * soldQty
        const costOfSoldUsd = avgCostUsd * soldQty
        
        s.costArs -= costOfSoldArs
        s.costUsd -= costOfSoldUsd
        s.qty -= soldQty
        
        const revenueArs = priceArs * soldQty
        const revenueUsd = isCedear ? (priceUsd * soldQty) : 0
        
        s.realizedPLArs += (revenueArs - costOfSoldArs - feeArs)
        if (isCedear) s.realizedPLUsd += (revenueUsd - costOfSoldUsd - feeUsd)
      }
    }
  })

  // 2. Calcular rendimientos en vivo (Unrealized) basados en inputs reactivos
  const openPositions = []
  let totalInvestedArs = 0
  let totalInvestedUsd = 0
  let totalCurrentValueArs = 0
  let totalCurrentValueUsd = 0
  let totalRealizedArs = 0
  let totalRealizedUsd = 0

  Object.values(bySymbol).forEach(s => {
    totalRealizedArs += s.realizedPLArs
    totalRealizedUsd += s.realizedPLUsd

    if (s.qty > 0) {
      const isCedear = s.assetType === 'CEDEAR'
      s.avgCostArs = s.costArs / s.qty
      s.avgCostUsd = isCedear ? (s.costUsd / s.qty) : 0

      // Precio actual reactivo
      const currentPriceArs = livePrices.value[s.ticker] || 0
      const currentPriceUsd = isCedear && globalCcl.value > 0 ? (currentPriceArs / globalCcl.value) : 0

      s.currentValueArs = s.qty * currentPriceArs
      s.currentValueUsd = isCedear ? s.qty * currentPriceUsd : 0

      s.unrealizedPLArs = s.currentValueArs - s.costArs
      s.unrealizedPLUsd = isCedear ? s.currentValueUsd - s.costUsd : 0

      s.unrealizedPctArs = s.costArs > 0 ? (s.unrealizedPLArs / s.costArs) * 100 : 0
      s.unrealizedPctUsd = s.costUsd > 0 ? (s.unrealizedPLUsd / s.costUsd) * 100 : 0

      totalInvestedArs += s.costArs
      totalInvestedUsd += s.costUsd
      totalCurrentValueArs += s.currentValueArs
      totalCurrentValueUsd += s.currentValueUsd

      openPositions.push(s)
    }
  })

  // Totales Globales
  const totalUnrealizedArs = totalCurrentValueArs - totalInvestedArs
  const totalUnrealizedUsd = totalCurrentValueUsd - totalInvestedUsd
  const totalUnrealizedPctArs = totalInvestedArs > 0 ? (totalUnrealizedArs / totalInvestedArs) * 100 : 0
  const totalUnrealizedPctUsd = totalInvestedUsd > 0 ? (totalUnrealizedUsd / totalInvestedUsd) * 100 : 0

  return {
    openPositions,
    totals: {
      investedArs: totalInvestedArs,
      investedUsd: totalInvestedUsd,
      currentValueArs: totalCurrentValueArs,
      currentValueUsd: totalCurrentValueUsd,
      unrealizedArs: totalUnrealizedArs,
      unrealizedUsd: totalUnrealizedUsd,
      unrealizedPctArs: totalUnrealizedPctArs,
      unrealizedPctUsd: totalUnrealizedPctUsd,
      realizedArs: totalRealizedArs,
      realizedUsd: totalRealizedUsd,
      count: openPositions.length
    }
  }
})

async function loadAll() {
  loading.value = true
  errorMsg.value = ''
  try {
    const [t] = await Promise.all([getTrades(), getTradesSummary().catch(() => {})])
    trades.value = t
    initializeLiveMarket() // Setea los precios iniciales
  } catch (e) {
    errorMsg.value = e.message
  } finally {
    loading.value = false
  }
}

function startEdit(trade) {
  editingId.value = trade.id
  form.date = trade.date
  form.assetType = trade.assetType
  form.ticker = trade.ticker
  form.operation = trade.operation
  form.quantity = trade.quantity
  form.price = trade.price
  form.fee = trade.fee
  form.ratio = trade.ratio || ''
  form.exchangeRate = trade.exchangeRate || ''
  form.notes = trade.notes
  formError.value = ''
}

function cancelEdit() {
  editingId.value = null
  Object.assign(form, emptyForm())
  formError.value = ''
}

async function submitForm() {
  formError.value = ''
  const ticker = form.ticker.trim().toUpperCase()
  if (!ticker) return (formError.value = 'Ingresá un ticker')
  if (!(Number(form.quantity) > 0)) return (formError.value = 'La cantidad debe ser mayor a 0')
  if (!(Number(form.price) > 0)) return (formError.value = 'El precio debe ser mayor a 0')

  if (form.assetType === 'CEDEAR') {
    if (!(Number(form.ratio) > 0)) return (formError.value = 'Ingresá un Ratio válido para el CEDEAR')
    if (!(Number(form.exchangeRate) > 0)) return (formError.value = 'Ingresá el tipo de cambio (Dólar CCL) al momento de operar')
  }

  const payload = {
    date: form.date,
    assetType: form.assetType,
    ticker,
    operation: form.operation,
    quantity: Number(form.quantity),
    price: Number(form.price),
    fee: Number(form.fee) || 0,
    ratio: form.assetType === 'CEDEAR' ? Number(form.ratio) : 1,
    exchangeRate: form.assetType === 'CEDEAR' ? Number(form.exchangeRate) : 1,
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
      livePrices.value[created.ticker] = created.price // Actualiza el precio en vivo al comprar
      if (created.assetType === 'CEDEAR') globalCcl.value = created.exchangeRate
    }
    cancelEdit()
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
})
</script>

<template>
  <div class="trades-overlay" @click="onOverlayClick">
    <div class="trades-modal">
      <div class="trades-header">
        <div class="trades-title">
          <span class="trades-icon">📈</span>
          Portafolio y Bitácora de Trades
        </div>
        <button class="close-btn" @click="close" title="Cerrar">✕</button>
      </div>

      <div v-if="loading" class="trades-loading">Cargando datos...</div>

      <template v-else>
        <div v-if="errorMsg" class="trades-error">{{ errorMsg }}</div>

        <!-- DASHBOARD TIPO BROKER -->
        <div class="market-controls">
          <div class="live-indicator">
            <span class="pulse-dot"></span> Simulación en Vivo
          </div>
          <div class="ccl-input-wrap">
            <label>Dólar CCL Actual:</label>
            <div class="input-prefix">
              <span>$</span>
              <input type="number" v-model="globalCcl" step="any" class="ccl-input" title="Ajustá el CCL actual para recalcular tu portafolio en USD">
            </div>
          </div>
        </div>

        <div class="summary-bar">
          <div class="summary-card highlight-card">
            <span class="summary-label">Valorizado Total</span>
            <div class="card-values">
              <strong>${{ formatMoney(portfolio.totals.currentValueArs) }}</strong>
              <span class="usd-value text-dim">U$D {{ formatMoney(portfolio.totals.currentValueUsd) }}</span>
            </div>
          </div>
          <div class="summary-card">
            <span class="summary-label">Ganancia Actual (Abierta)</span>
            <div class="card-values">
              <strong :class="portfolio.totals.unrealizedArs >= 0 ? 'pl-pos' : 'pl-neg'">
                {{ portfolio.totals.unrealizedArs >= 0 ? '+' : '' }}${{ formatMoney(portfolio.totals.unrealizedArs) }} ({{ formatPct(portfolio.totals.unrealizedPctArs) }})
              </strong>
              <span class="usd-value" :class="portfolio.totals.unrealizedUsd >= 0 ? 'pl-pos' : 'pl-neg'">
                {{ portfolio.totals.unrealizedUsd >= 0 ? '+' : '' }}U$D {{ formatMoney(portfolio.totals.unrealizedUsd) }} ({{ formatPct(portfolio.totals.unrealizedPctUsd) }})
              </span>
            </div>
          </div>
          <div class="summary-card">
            <span class="summary-label">Capital Invertido</span>
            <div class="card-values">
              <strong>${{ formatMoney(portfolio.totals.investedArs) }}</strong>
              <span class="usd-value text-dim">U$D {{ formatMoney(portfolio.totals.investedUsd) }}</span>
            </div>
          </div>
          <div class="summary-card">
            <span class="summary-label">Ganancia Histórica (Cerrada)</span>
            <div class="card-values">
              <strong :class="portfolio.totals.realizedArs >= 0 ? 'pl-pos' : 'pl-neg'">
                {{ portfolio.totals.realizedArs >= 0 ? '+' : '' }}${{ formatMoney(portfolio.totals.realizedArs) }}
              </strong>
              <span v-if="portfolio.totals.realizedUsd !== 0" class="usd-value" :class="portfolio.totals.realizedUsd >= 0 ? 'pl-pos' : 'pl-neg'">
                {{ portfolio.totals.realizedUsd >= 0 ? '+' : '' }}U$D {{ formatMoney(portfolio.totals.realizedUsd) }}
              </span>
            </div>
          </div>
        </div>

        <!-- TABLA DE TENENCIAS (PORTAFOLIO) -->
        <div v-if="portfolio.openPositions.length" class="by-symbol-section">
          <div class="section-title">Mis Tenencias ({{ portfolio.totals.count }})</div>
          <div class="by-symbol-table-wrap">
            <table class="by-symbol-table">
              <thead>
                <tr>
                  <th>Activo</th>
                  <th class="text-right">Tenencia</th>
                  <th class="text-right">PPP (Costo Prom)</th>
                  <th class="text-right" style="width: 140px;">Cotización Actual</th>
                  <th class="text-right">Valorizado</th>
                  <th class="text-right">Ganancia ARS</th>
                  <th class="text-right">Ganancia USD</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="s in portfolio.openPositions" :key="s.ticker">
                  <td>
                    <div style="display:flex; flex-direction:column; gap:2px;">
                      <span class="ticker-cell">{{ s.ticker }}</span>
                      <span class="badge" :class="s.assetType === 'CEDEAR' ? 'badge-cedear' : 'badge-ar'">{{ s.assetType === 'CEDEAR' ? 'CEDEAR' : 'AR' }}</span>
                    </div>
                  </td>
                  <td class="text-right font-num">{{ s.qty }}</td>
                  <td class="text-right font-num">
                    ${{ formatMoney(s.avgCostArs) }}
                    <div v-if="s.assetType === 'CEDEAR'" class="text-dim text-xs">U$D {{ formatMoney(s.avgCostUsd) }}</div>
                  </td>
                  <td class="text-right">
                    <div class="live-input-container">
                      <span>$</span>
                      <input type="number" v-model="livePrices[s.ticker]" class="live-price-input" step="any">
                    </div>
                    <div v-if="s.assetType === 'CEDEAR'" class="text-dim text-xs mt-1">
                      U$D {{ formatMoney((livePrices[s.ticker] || 0) / globalCcl) }}
                    </div>
                  </td>
                  <td class="text-right font-num">
                    <strong>${{ formatMoney(s.currentValueArs) }}</strong>
                    <div v-if="s.assetType === 'CEDEAR'" class="text-dim text-xs">U$D {{ formatMoney(s.currentValueUsd) }}</div>
                  </td>
                  <td class="text-right font-num" :class="s.unrealizedPLArs >= 0 ? 'pl-pos' : 'pl-neg'">
                    <strong>{{ s.unrealizedPLArs >= 0 ? '+' : '' }}${{ formatMoney(s.unrealizedPLArs) }}</strong>
                    <div class="text-xs">{{ s.unrealizedPLArs >= 0 ? '+' : '' }}{{ formatPct(s.unrealizedPctArs) }}</div>
                  </td>
                  <td class="text-right font-num">
                    <template v-if="s.assetType === 'CEDEAR'">
                      <strong :class="s.unrealizedPLUsd >= 0 ? 'pl-pos' : 'pl-neg'">
                        {{ s.unrealizedPLUsd >= 0 ? '+' : '' }}U$D {{ formatMoney(s.unrealizedPLUsd) }}
                      </strong>
                      <div :class="s.unrealizedPLUsd >= 0 ? 'pl-pos' : 'pl-neg'" class="text-xs">
                        {{ s.unrealizedPLUsd >= 0 ? '+' : '' }}{{ formatPct(s.unrealizedPctUsd) }}
                      </div>
                    </template>
                    <span v-else class="text-dim">—</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- FORMULARIO DE TRADES -->
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
              <input type="text" v-model="form.ticker" placeholder="Ej: AAPL" style="text-transform:uppercase" required>
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
              <input type="number" min="0" step="any" v-model="form.quantity" placeholder="Ej: 10" required>
            </div>
            <div class="form-field">
              <label>Precio unitario ($)</label>
              <input type="number" min="0" step="any" v-model="form.price" placeholder="Ej: 15000" required>
            </div>
            
            <template v-if="form.assetType === 'CEDEAR'">
              <div class="form-field">
                <label>Ratio</label>
                <input type="number" min="0.01" step="any" v-model="form.ratio" placeholder="Ej: 10">
              </div>
              <div class="form-field">
                <label>Dólar CCL ($)</label>
                <input type="number" min="0" step="any" v-model="form.exchangeRate" placeholder="Ej: 1250">
              </div>
              <div class="form-field">
                <label>Ref. Acción (USD)</label>
                <input type="text" :value="refUsdPrice ? 'U$D ' + refUsdPrice.toFixed(2) : '—'" disabled class="input-disabled">
              </div>
            </template>

            <div class="form-field">
              <label>Comisión ($)</label>
              <input type="number" min="0" step="any" v-model="form.fee" placeholder="Opcional">
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

        <!-- HISTORIAL DE TRADES -->
        <div class="section-title">Historial de Movimientos</div>
        <div class="trades-table-wrap">
          <table class="trades-table" v-if="sortedTrades.length">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Ticker</th>
                <th>Oper.</th>
                <th class="text-right">Cant.</th>
                <th class="text-right">Precio ARS</th>
                <th class="text-right">CCL</th>
                <th class="text-right">Acción USD</th>
                <th class="text-right">Total USD</th>
                <th class="text-right">Total ARS</th>
                <th>Notas</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="t in sortedTrades" :key="t.id" :class="{ 'row-editing': editingId === t.id }">
                <td>{{ formatDate(t.date) }}</td>
                <td>
                  <div style="display:flex; flex-direction:column; gap:2px;">
                    <span class="ticker-cell">{{ t.ticker }}</span>
                    <span class="badge" :class="t.assetType === 'CEDEAR' ? 'badge-cedear' : 'badge-ar'">{{ t.assetType === 'CEDEAR' ? 'CEDEAR' : 'AR' }}</span>
                  </div>
                </td>
                <td><span class="badge" :class="t.operation === 'COMPRA' ? 'badge-buy' : 'badge-sell'">{{ t.operation === 'COMPRA' ? 'Compra' : 'Venta' }}</span></td>
                <td class="text-right font-num">{{ t.quantity }}</td>
                <td class="text-right font-num">${{ formatMoney(t.price) }}</td>
                <td class="text-right font-num text-dim">{{ t.assetType === 'CEDEAR' && t.exchangeRate ? '$' + formatMoney(t.exchangeRate) : '—' }}</td>
                <td class="text-right font-num text-dim">{{ t.assetType === 'CEDEAR' && t.exchangeRate && t.ratio ? 'U$D ' + formatMoney((t.price * t.ratio) / t.exchangeRate) : '—' }}</td>
                <td class="text-right font-num">
                  <strong v-if="t.assetType === 'CEDEAR' && t.exchangeRate">U$D {{ formatMoney(((t.price * t.quantity) + (t.operation === 'COMPRA' ? (t.fee||0) : -(t.fee||0))) / t.exchangeRate) }}</strong>
                  <span v-else class="text-dim">—</span>
                </td>
                <td class="text-right font-num">${{ formatMoney(t.total || ((t.price * t.quantity) + (t.operation === 'COMPRA' ? (t.fee||0) : -(t.fee||0)))) }}</td>
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
  align-items: flex-start;
  justify-content: center;
  padding: 4vh 16px;
  z-index: 1000;
  overflow-y: auto;
}

.trades-modal {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  width: 100%;
  max-width: 1200px;
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
  font-size: 18px;
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

/* Market Controls (Dynamism) */
.market-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: rgba(37, 99, 235, 0.05);
  border: 1px solid rgba(37, 99, 235, 0.2);
  padding: 10px 16px;
  border-radius: 8px;
}

.live-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 600;
  color: #3b82f6;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.pulse-dot {
  width: 8px;
  height: 8px;
  background-color: #3b82f6;
  border-radius: 50%;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.7); }
  70% { box-shadow: 0 0 0 6px rgba(59, 130, 246, 0); }
  100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0); }
}

.ccl-input-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: var(--text-dim);
  font-weight: 600;
}

.input-prefix {
  display: flex;
  align-items: center;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0 8px;
}

.input-prefix span {
  color: var(--text-dim);
  font-weight: 700;
}

.ccl-input {
  background: transparent;
  border: none;
  color: var(--text);
  font-size: 14px;
  font-weight: 700;
  font-family: var(--font-num, inherit);
  padding: 6px 4px;
  width: 80px;
  outline: none;
}

/* Summary Bar */
.summary-bar {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}

.summary-card {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.highlight-card {
  background: rgba(37, 99, 235, 0.05);
  border-color: rgba(37, 99, 235, 0.3);
}

.summary-label {
  font-size: 10px;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 700;
}

.card-values {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.card-values strong {
  font-size: 18px;
  color: var(--text);
  font-family: var(--font-num, inherit);
}

.usd-value {
  font-size: 13px;
  font-weight: 600;
  font-family: var(--font-num, inherit);
}

.text-dim { color: var(--text-dim); }
.text-xs { font-size: 11px; }
.mt-1 { margin-top: 2px; }
.text-right { text-align: right !important; }
.font-num { font-family: var(--font-num, inherit); }

.section-title {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-dim);
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
  padding: 10px 12px;
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
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  color: var(--text);
  white-space: nowrap;
  vertical-align: middle;
}

.trades-table tbody tr:hover,
.by-symbol-table tbody tr:hover {
  background: rgba(0,0,0,0.02);
}

.row-editing {
  background: rgba(37, 99, 235, 0.08) !important;
}

.ticker-cell { font-weight: 700; font-size: 13px; }

/* Live Input in Table */
.live-input-container {
  display: inline-flex;
  align-items: center;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0 6px;
  transition: all 0.2s;
}

.live-input-container:focus-within {
  border-color: #3b82f6;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
}

.live-input-container span {
  color: var(--text-dim);
  font-size: 12px;
  font-weight: 600;
}

.live-price-input {
  background: transparent;
  border: none;
  color: var(--text);
  font-size: 13px;
  font-weight: 700;
  font-family: var(--font-num, inherit);
  padding: 6px 4px;
  width: 75px;
  text-align: right;
  outline: none;
}

.notes-cell {
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: inherit;
  color: var(--text-dim);
}

.badge {
  display: inline-block;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 9px;
  font-weight: 800;
  text-transform: uppercase;
  width: fit-content;
}

.badge-cedear { background: rgba(59, 130, 246, 0.15); color: #3b82f6; }
.badge-ar { background: rgba(168, 85, 247, 0.15); color: #a855f7; }
.badge-buy { background: rgba(34, 197, 94, 0.15); color: #16a34a; }
.badge-sell { background: rgba(239, 68, 68, 0.15); color: #dc2626; }

.pl-pos { color: #16a34a !important; }
.pl-neg { color: #dc2626 !important; }

.actions-cell {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
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

.icon-btn:hover { color: var(--text); border-color: var(--text-dim); }
.icon-btn-danger:hover { color: #ef4444; border-color: #ef4444; }

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
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 10px;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.form-field-wide { grid-column: span 2; }

.form-field label {
  font-size: 10px;
  color: var(--text-dim);
  font-weight: 600;
}

.form-field input,
.form-field select {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px;
  color: var(--text);
  font-size: 12px;
  font-family: inherit;
  min-width: 0;
}

.form-field input:focus,
.form-field select:focus {
  outline: none;
  border-color: #3b82f6;
}

.input-disabled {
  background: var(--bg) !important;
  color: var(--text-dim) !important;
  cursor: not-allowed;
  border-color: var(--border) !important;
  font-weight: 600;
}

.form-actions {
  display: flex;
  gap: 8px;
}

.btn-primary {
  background: #3b82f6;
  border: 1px solid #3b82f6;
  color: white;
  border-radius: 6px;
  padding: 8px 16px;
  font-weight: 600;
  font-size: 12px;
  cursor: pointer;
}

.btn-primary:hover { background: #2563eb; }
.btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }

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

.btn-secondary:hover { color: var(--text); border-color: var(--text-dim); }

@media (max-width: 768px) {
  .trades-overlay { padding: 0; }
  .trades-modal { max-width: 100%; height: 100vh; border-radius: 0; }
  .form-field-wide { grid-column: span 1; }
  .market-controls { flex-direction: column; align-items: flex-start; gap: 10px; }
}
</style>