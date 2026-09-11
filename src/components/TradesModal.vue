<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import {
  getTrades,
  getTradesSummary,
  createTrade,
  updateTrade,
  deleteTrade,
} from '../services/tradesService'

const emit = defineEmits(['close'])

const trades = ref([])
const summary = ref({ bySymbol: [], totals: { realizedPL: 0, invested: 0, openPositions: 0, totalTrades: 0 } })
const loading = ref(true)
const errorMsg = ref('')
const saving = ref(false)

const editingId = ref(null) // null = modo "agregar", si no, id del trade en edición

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
    notes: '',
  }
}

const form = reactive(emptyForm())
const formError = ref('')

function formatMoney(n) {
  const num = Number(n) || 0
  return num.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatDate(d) {
  if (!d) return '—'
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}

const sortedTrades = computed(() =>
  [...trades.value].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id))
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

function startEdit(trade) {
  editingId.value = trade.id
  form.date = trade.date
  form.assetType = trade.assetType
  form.ticker = trade.ticker
  form.operation = trade.operation
  form.quantity = trade.quantity
  form.price = trade.price
  form.fee = trade.fee
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

  const payload = {
    date: form.date,
    assetType: form.assetType,
    ticker,
    operation: form.operation,
    quantity: Number(form.quantity),
    price: Number(form.price),
    fee: Number(form.fee) || 0,
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
            <span class="summary-label">Resultado realizado</span>
            <strong :class="summary.totals.realizedPL >= 0 ? 'pl-pos' : 'pl-neg'">
              {{ summary.totals.realizedPL >= 0 ? '+' : '' }}${{ formatMoney(summary.totals.realizedPL) }}
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
        </div>

        <!-- Resumen por ticker -->
        <div v-if="summary.bySymbol.length" class="by-symbol-section">
          <div class="section-title">Resultado por ticker</div>
          <div class="by-symbol-table-wrap">
            <table class="by-symbol-table">
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Tipo</th>
                  <th>Cantidad</th>
                  <th>Costo prom.</th>
                  <th>P&amp;L realizado</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="s in summary.bySymbol" :key="s.ticker">
                  <td class="ticker-cell">{{ s.ticker }}</td>
                  <td><span class="badge" :class="s.assetType === 'CEDEAR' ? 'badge-cedear' : 'badge-ar'">{{ s.assetType === 'CEDEAR' ? 'CEDEAR' : 'Acción AR' }}</span></td>
                  <td>{{ s.quantity }}</td>
                  <td>${{ formatMoney(s.avgCost) }}</td>
                  <td :class="s.realizedPL >= 0 ? 'pl-pos' : 'pl-neg'">
                    {{ s.realizedPL >= 0 ? '+' : '' }}${{ formatMoney(s.realizedPL) }}
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
              <input type="text" v-model="form.ticker" placeholder="Ej: GGAL" style="text-transform:uppercase" required>
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
        <div class="section-title">Historial ({{ trades.length }})</div>
        <div class="trades-table-wrap">
          <table class="trades-table" v-if="sortedTrades.length">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Activo</th>
                <th>Ticker</th>
                <th>Operación</th>
                <th>Cantidad</th>
                <th>Precio</th>
                <th>Comisión</th>
                <th>Total</th>
                <th>Notas</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="t in sortedTrades" :key="t.id" :class="{ 'row-editing': editingId === t.id }">
                <td>{{ formatDate(t.date) }}</td>
                <td><span class="badge" :class="t.assetType === 'CEDEAR' ? 'badge-cedear' : 'badge-ar'">{{ t.assetType === 'CEDEAR' ? 'CEDEAR' : 'Acción AR' }}</span></td>
                <td class="ticker-cell">{{ t.ticker }}</td>
                <td><span class="badge" :class="t.operation === 'COMPRA' ? 'badge-buy' : 'badge-sell'">{{ t.operation === 'COMPRA' ? 'Compra' : 'Venta' }}</span></td>
                <td>{{ t.quantity }}</td>
                <td>${{ formatMoney(t.price) }}</td>
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
  max-width: 1100px;
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