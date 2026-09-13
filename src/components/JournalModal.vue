<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import {
  getJournalEntries,
  getJournalSummary,
  createJournalEntry,
  updateJournalEntry,
  deleteJournalEntry,
} from '../services/journalService'

const emit = defineEmits(['close'])

const MARKET_LABELS = {
  ACCION: 'Acción',
  CEDEAR: 'CEDEAR',
  FOREX: 'Forex',
  FUTURO: 'Futuro',
  CRIPTO: 'Cripto',
  OPCION: 'Opción',
  INDICE: 'Índice',
  MATERIA_PRIMA: 'Materia prima',
  BONO: 'Bono',
  OTRO: 'Otro',
}

const MARKET_BADGE_CLASS = {
  ACCION: 'badge-acc',
  CEDEAR: 'badge-cedear',
  FOREX: 'badge-forex',
  FUTURO: 'badge-fut',
  CRIPTO: 'badge-cripto',
  OPCION: 'badge-op',
  INDICE: 'badge-idx',
  MATERIA_PRIMA: 'badge-mat',
  BONO: 'badge-bono',
  OTRO: 'badge-otro',
}

const STATUS_LABELS = { ABIERTO: 'Abierto', CERRADO: 'Cerrado', CANCELADO: 'Cancelado' }
const EMOTIONS = ['Confiado', 'Neutral', 'Ansioso', 'FOMO', 'Euforia', 'Miedo', 'Impaciencia', 'Otro']

const entries = ref([])
const summary = ref({
  totals: {
    totalEntries: 0, openPositions: 0, closedTrades: 0, winRate: 0, netResult: 0,
    profitFactor: 0, avgR: null, bestTrade: 0, worstTrade: 0, planAdherence: 0,
  },
})
const loading = ref(true)
const errorMsg = ref('')
const saving = ref(false)
const statusFilter = ref('TODAS')

const editingId = ref(null)
const expandedId = ref(null) // id de la operación con el detalle desplegado

function toggleExpand(id) {
  expandedId.value = expandedId.value === id ? null : id
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function emptyForm() {
  return {
    entryDate: todayISO(),
    exitDate: '',
    market: 'ACCION',
    symbol: '',
    direction: 'LONG',
    strategy: '',
    timeframe: '',
    entryPrice: '',
    stopLoss: '',
    takeProfit: '',
    exitPrice: '',
    size: '',
    leverage: 1,
    fee: '',
    riskAmount: '',
    riskPercent: '',
    status: 'ABIERTO',
    emotion: '',
    followedPlan: true,
    entryReason: '',
    lessons: '',
    account: '',
  }
}

const form = reactive(emptyForm())
const formError = ref('')

function formatMoney(n) {
  if (n === null || n === undefined || n === '') return '—'
  const num = Number(n) || 0
  return num.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatNum(n) {
  if (n === null || n === undefined || n === '') return '—'
  return Number(n).toLocaleString('es-AR', { maximumFractionDigits: 4 })
}

function formatDate(d) {
  if (!d) return '—'
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}

// Días transcurridos de la operación: desde la entrada hasta la salida (si
// ya cerró) o hasta hoy (si sigue abierta/en curso).
function daysElapsed(entry) {
  if (!entry.entryDate) return null
  const start = new Date(`${entry.entryDate}T00:00:00`)
  const endStr = entry.status === 'CERRADO' && entry.exitDate ? entry.exitDate : todayISO()
  const end = new Date(`${endStr}T00:00:00`)
  const diffDays = Math.round((end - start) / (1000 * 60 * 60 * 24))
  return diffDays < 0 ? 0 : diffDays
}

function formatDays(entry) {
  const days = daysElapsed(entry)
  if (days === null) return '—'
  const label = days === 1 ? 'día' : 'días'
  const enCurso = entry.status === 'ABIERTO' && !entry.exitDate
  return `${days} ${label}${enCurso ? ' (en curso)' : ''}`
}

const filteredEntries = computed(() => {
  if (statusFilter.value === 'TODAS') return entries.value
  return entries.value.filter((e) => e.status === statusFilter.value)
})

const sortedEntries = computed(() =>
  [...filteredEntries.value].sort((a, b) =>
    a.entryDate < b.entryDate ? 1 : a.entryDate > b.entryDate ? -1 : b.id - a.id
  )
)

// Duración promedio de las operaciones ya cerradas (en días), para el
// resumen general.
const avgDurationDays = computed(() => {
  const closed = entries.value.filter((e) => e.status === 'CERRADO' && e.exitDate)
  if (!closed.length) return null
  const total = closed.reduce((acc, e) => acc + (daysElapsed(e) ?? 0), 0)
  return Math.round((total / closed.length) * 10) / 10
})

async function loadAll() {
  loading.value = true
  errorMsg.value = ''
  try {
    const [e, s] = await Promise.all([getJournalEntries(), getJournalSummary()])
    entries.value = e
    summary.value = s
  } catch (e) {
    errorMsg.value = e.message
  } finally {
    loading.value = false
  }
}

async function refreshSummary() {
  try {
    summary.value = await getJournalSummary()
  } catch (e) {
    console.error('Error refrescando el resumen de la planilla', e)
  }
}

function startEdit(entry) {
  editingId.value = entry.id
  form.entryDate = entry.entryDate
  form.exitDate = entry.exitDate || ''
  form.market = entry.market
  form.symbol = entry.symbol
  form.direction = entry.direction
  form.strategy = entry.strategy || ''
  form.timeframe = entry.timeframe || ''
  form.entryPrice = entry.entryPrice
  form.stopLoss = entry.stopLoss ?? ''
  form.takeProfit = entry.takeProfit ?? ''
  form.exitPrice = entry.exitPrice ?? ''
  form.size = entry.size
  form.leverage = entry.leverage ?? 1
  form.fee = entry.fee ?? ''
  form.riskAmount = entry.riskAmount ?? ''
  form.riskPercent = entry.riskPercent ?? ''
  form.status = entry.status
  form.emotion = entry.emotion || ''
  form.followedPlan = !!entry.followedPlan
  form.entryReason = entry.entryReason || ''
  form.lessons = entry.lessons || ''
  form.account = entry.account || ''
  formError.value = ''
  document.getElementById('journal-form-top')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function cancelEdit() {
  editingId.value = null
  Object.assign(form, emptyForm())
  formError.value = ''
}

async function submitForm() {
  formError.value = ''
  const symbol = form.symbol.trim().toUpperCase()
  if (!symbol) return (formError.value = 'Ingresá un símbolo / par / ticker')
  if (!(Number(form.entryPrice) > 0)) return (formError.value = 'El precio de entrada debe ser mayor a 0')
  if (!(Number(form.size) > 0)) return (formError.value = 'El tamaño de la posición debe ser mayor a 0')

  const payload = {
    entryDate: form.entryDate,
    exitDate: form.exitDate || null,
    market: form.market,
    symbol,
    direction: form.direction,
    strategy: form.strategy.trim(),
    timeframe: form.timeframe.trim(),
    entryPrice: Number(form.entryPrice),
    stopLoss: form.stopLoss === '' ? null : Number(form.stopLoss),
    takeProfit: form.takeProfit === '' ? null : Number(form.takeProfit),
    exitPrice: form.exitPrice === '' ? null : Number(form.exitPrice),
    size: Number(form.size),
    leverage: Number(form.leverage) || 1,
    fee: Number(form.fee) || 0,
    riskAmount: form.riskAmount === '' ? null : Number(form.riskAmount),
    riskPercent: form.riskPercent === '' ? null : Number(form.riskPercent),
    status: form.status,
    emotion: form.emotion,
    followedPlan: !!form.followedPlan,
    entryReason: form.entryReason.trim(),
    lessons: form.lessons.trim(),
    account: form.account.trim(),
  }

  saving.value = true
  try {
    if (editingId.value) {
      const updated = await updateJournalEntry(editingId.value, payload)
      const idx = entries.value.findIndex((e) => e.id === editingId.value)
      if (idx !== -1) entries.value[idx] = updated
    } else {
      const created = await createJournalEntry(payload)
      entries.value.push(created)
    }
    cancelEdit()
    await refreshSummary()
  } catch (e) {
    formError.value = e.message
  } finally {
    saving.value = false
  }
}

async function removeEntry(entry) {
  const ok = window.confirm(`¿Borrar el registro de ${entry.symbol} del ${formatDate(entry.entryDate)}?`)
  if (!ok) return
  try {
    await deleteJournalEntry(entry.id)
    entries.value = entries.value.filter((e) => e.id !== entry.id)
    if (editingId.value === entry.id) cancelEdit()
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
  <div class="journal-overlay" @click="onOverlayClick">
    <div class="journal-modal">
      <div class="journal-header" id="journal-form-top">
        <div class="journal-title">
          <span class="journal-icon">📊</span>
          Planilla Profesional de Trading
        </div>
        <button class="close-btn" @click="close" title="Cerrar">✕</button>
      </div>

      <div v-if="loading" class="journal-loading">Cargando planilla...</div>

      <template v-else>
        <div v-if="errorMsg" class="journal-error">{{ errorMsg }}</div>

        <!-- Resumen general -->
        <div class="summary-bar">
          <div class="summary-card">
            <span class="summary-label">Resultado neto</span>
            <strong :class="summary.totals.netResult >= 0 ? 'pl-pos' : 'pl-neg'">
              {{ summary.totals.netResult >= 0 ? '+' : '' }}${{ formatMoney(summary.totals.netResult) }}
            </strong>
          </div>
          <div class="summary-card">
            <span class="summary-label">Win rate</span>
            <strong>{{ formatNum(summary.totals.winRate) }}%</strong>
          </div>
          <div class="summary-card">
            <span class="summary-label">Profit factor</span>
            <strong>{{ summary.totals.profitFactor === null ? '∞' : formatNum(summary.totals.profitFactor) }}</strong>
          </div>
          <div class="summary-card">
            <span class="summary-label">R promedio</span>
            <strong>{{ summary.totals.avgR === null ? '—' : `${summary.totals.avgR}R` }}</strong>
          </div>
          <div class="summary-card">
            <span class="summary-label">Mejor trade</span>
            <strong class="pl-pos">${{ formatMoney(summary.totals.bestTrade) }}</strong>
          </div>
          <div class="summary-card">
            <span class="summary-label">Peor trade</span>
            <strong class="pl-neg">${{ formatMoney(summary.totals.worstTrade) }}</strong>
          </div>
          <div class="summary-card">
            <span class="summary-label">Posiciones abiertas</span>
            <strong>{{ summary.totals.openPositions }}</strong>
          </div>
          <div class="summary-card">
            <span class="summary-label">Adherencia al plan</span>
            <strong>{{ formatNum(summary.totals.planAdherence) }}%</strong>
          </div>
          <div class="summary-card">
            <span class="summary-label">Duración promedio</span>
            <strong>{{ avgDurationDays === null ? '—' : `${avgDurationDays} días` }}</strong>
          </div>
        </div>

        <!-- Formulario alta / edición -->
        <form class="journal-form" @submit.prevent="submitForm">
          <div class="section-title">{{ editingId ? 'Editar operación' : 'Nueva operación' }}</div>

          <div class="form-subsection-title">Datos generales</div>
          <div class="form-grid">
            <div class="form-field">
              <label>Fecha de entrada</label>
              <input type="date" v-model="form.entryDate" required>
            </div>
            <div class="form-field">
              <label>Mercado / Instrumento</label>
              <select v-model="form.market">
                <option v-for="(label, key) in MARKET_LABELS" :key="key" :value="key">{{ label }}</option>
              </select>
            </div>
            <div class="form-field">
              <label>Símbolo / Par</label>
              <input type="text" v-model="form.symbol" placeholder="Ej: EURUSD, ES, GGAL" style="text-transform:uppercase" required>
            </div>
            <div class="form-field">
              <label>Dirección</label>
              <select v-model="form.direction">
                <option value="LONG">Long</option>
                <option value="SHORT">Short</option>
              </select>
            </div>
            <div class="form-field">
              <label>Estrategia / Setup</label>
              <input type="text" v-model="form.strategy" placeholder="Ej: Ruptura de rango">
            </div>
            <div class="form-field">
              <label>Timeframe</label>
              <input type="text" v-model="form.timeframe" placeholder="Ej: 4H, Diario">
            </div>
            <div class="form-field">
              <label>Cuenta / Broker</label>
              <input type="text" v-model="form.account" placeholder="Ej: IOL, Cocos, MT5 Live">
            </div>
            <div class="form-field">
              <label>Estado</label>
              <select v-model="form.status">
                <option value="ABIERTO">Abierto</option>
                <option value="CERRADO">Cerrado</option>
                <option value="CANCELADO">Cancelado</option>
              </select>
            </div>
          </div>

          <div class="form-subsection-title">Gestión de riesgo</div>
          <div class="form-grid">
            <div class="form-field">
              <label>Precio de entrada</label>
              <input type="number" min="0" step="any" v-model="form.entryPrice" placeholder="Ej: 1.0850" required>
            </div>
            <div class="form-field">
              <label>Stop loss</label>
              <input type="number" min="0" step="any" v-model="form.stopLoss" placeholder="Opcional">
            </div>
            <div class="form-field">
              <label>Take profit</label>
              <input type="number" min="0" step="any" v-model="form.takeProfit" placeholder="Opcional">
            </div>
            <div class="form-field">
              <label>Tamaño (unidades / lotes / contratos)</label>
              <input type="number" min="0" step="any" v-model="form.size" placeholder="Ej: 1, 100, 0.5" required>
            </div>
            <div class="form-field">
              <label>Apalancamiento</label>
              <input type="number" min="0" step="any" v-model="form.leverage" placeholder="Ej: 1, 30, 100">
            </div>
            <div class="form-field">
              <label>Comisión / Swap ($)</label>
              <input type="number" min="0" step="any" v-model="form.fee" placeholder="Opcional">
            </div>
            <div class="form-field">
              <label>Riesgo en $ (para calcular R)</label>
              <input type="number" min="0" step="any" v-model="form.riskAmount" placeholder="Ej: 50">
            </div>
            <div class="form-field">
              <label>Riesgo (% de la cuenta)</label>
              <input type="number" min="0" step="any" v-model="form.riskPercent" placeholder="Ej: 1">
            </div>
          </div>

          <div class="form-subsection-title">Cierre de la operación</div>
          <div class="form-grid">
            <div class="form-field">
              <label>Fecha de salida</label>
              <input type="date" v-model="form.exitDate">
            </div>
            <div class="form-field">
              <label>Precio de salida</label>
              <input type="number" min="0" step="any" v-model="form.exitPrice" placeholder="Opcional">
            </div>
          </div>

          <div class="form-subsection-title">Psicología y revisión</div>
          <div class="form-grid">
            <div class="form-field">
              <label>Emoción al entrar</label>
              <select v-model="form.emotion">
                <option value="">Sin especificar</option>
                <option v-for="em in EMOTIONS" :key="em" :value="em">{{ em }}</option>
              </select>
            </div>
            <div class="form-field form-field-checkbox">
              <label class="checkbox-label">
                <input type="checkbox" v-model="form.followedPlan">
                Seguí mi plan al pie de la letra
              </label>
            </div>
            <div class="form-field form-field-wide">
              <label>Razón de entrada / tesis</label>
              <textarea v-model="form.entryReason" rows="2" placeholder="¿Por qué entraste en esta operación?"></textarea>
            </div>
            <div class="form-field form-field-wide">
              <label>Lecciones / notas de revisión</label>
              <textarea v-model="form.lessons" rows="2" placeholder="¿Qué aprendiste? ¿Qué harías distinto?"></textarea>
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
          <div class="section-title">Historial ({{ filteredEntries.length }})</div>
          <div class="status-filters">
            <button
              v-for="f in ['TODAS', 'ABIERTO', 'CERRADO', 'CANCELADO']"
              :key="f"
              type="button"
              class="filter-btn"
              :class="{ active: statusFilter === f }"
              @click="statusFilter = f"
            >
              {{ f === 'TODAS' ? 'Todas' : STATUS_LABELS[f] }}
            </button>
          </div>
        </div>

        <div class="journal-table-wrap">
          <table class="journal-table" v-if="sortedEntries.length">
            <thead>
              <tr>
                <th></th>
                <th>Fecha</th>
                <th>Mercado</th>
                <th>Símbolo</th>
                <th>Dir</th>
                <th>Entrada</th>
                <th>SL</th>
                <th>TP</th>
                <th>Salida</th>
                <th>Días</th>
                <th>Tamaño</th>
                <th>R:R plan.</th>
                <th>Resultado</th>
                <th>R</th>
                <th>Estado</th>
                <th>Plan</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <template v-for="e in sortedEntries" :key="e.id">
                <tr
                  class="entry-row"
                  :class="{ 'row-editing': editingId === e.id, 'row-expanded': expandedId === e.id }"
                  @click="toggleExpand(e.id)"
                >
                  <td class="expand-cell">{{ expandedId === e.id ? '▾' : '▸' }}</td>
                  <td>{{ formatDate(e.entryDate) }}</td>
                  <td><span class="badge" :class="MARKET_BADGE_CLASS[e.market]">{{ MARKET_LABELS[e.market] }}</span></td>
                  <td class="ticker-cell" :title="e.strategy">{{ e.symbol }}</td>
                  <td><span class="badge" :class="e.direction === 'LONG' ? 'badge-buy' : 'badge-sell'">{{ e.direction === 'LONG' ? 'Long' : 'Short' }}</span></td>
                  <td>{{ formatNum(e.entryPrice) }}</td>
                  <td>{{ formatNum(e.stopLoss) }}</td>
                  <td>{{ formatNum(e.takeProfit) }}</td>
                  <td>{{ formatNum(e.exitPrice) }}</td>
                  <td>{{ formatDays(e) }}</td>
                  <td>{{ formatNum(e.size) }}</td>
                  <td>{{ e.plannedRR === null ? '—' : `${e.plannedRR}R` }}</td>
                  <td v-if="e.resultAmount === null">—</td>
                  <td v-else :class="e.resultAmount >= 0 ? 'pl-pos' : 'pl-neg'">
                    {{ e.resultAmount >= 0 ? '+' : '' }}${{ formatMoney(e.resultAmount) }}
                  </td>
                  <td v-if="e.resultR === null">—</td>
                  <td v-else :class="e.resultR >= 0 ? 'pl-pos' : 'pl-neg'">{{ e.resultR >= 0 ? '+' : '' }}{{ e.resultR }}R</td>
                  <td>
                    <span class="badge" :class="{
                      'badge-open': e.status === 'ABIERTO',
                      'badge-closed': e.status === 'CERRADO',
                      'badge-cancel': e.status === 'CANCELADO',
                    }">{{ STATUS_LABELS[e.status] }}</span>
                  </td>
                  <td class="plan-cell">{{ e.followedPlan ? '✓' : '✕' }}</td>
                  <td class="actions-cell">
                    <button class="icon-btn" title="Editar" @click.stop="startEdit(e)">✎</button>
                    <button class="icon-btn icon-btn-danger" title="Eliminar" @click.stop="removeEntry(e)">🗑</button>
                  </td>
                </tr>
                <tr v-if="expandedId === e.id" class="detail-row">
                  <td :colspan="17">
                    <div class="detail-panel">
                      <div class="detail-col">
                        <div class="detail-item">
                          <span class="detail-label">Estrategia / Setup</span>
                          <span class="detail-value">{{ e.strategy || '—' }}</span>
                        </div>
                        <div class="detail-item">
                          <span class="detail-label">Timeframe</span>
                          <span class="detail-value">{{ e.timeframe || '—' }}</span>
                        </div>
                        <div class="detail-item">
                          <span class="detail-label">Cuenta / Broker</span>
                          <span class="detail-value">{{ e.account || '—' }}</span>
                        </div>
                      </div>
                      <div class="detail-col">
                        <div class="detail-item">
                          <span class="detail-label">Apalancamiento</span>
                          <span class="detail-value">{{ formatNum(e.leverage) }}x</span>
                        </div>
                        <div class="detail-item">
                          <span class="detail-label">Comisión / Swap</span>
                          <span class="detail-value">${{ formatMoney(e.fee) }}</span>
                        </div>
                        <div class="detail-item">
                          <span class="detail-label">Riesgo</span>
                          <span class="detail-value">
                            {{ e.riskAmount != null ? `$${formatMoney(e.riskAmount)}` : '—' }}
                            <template v-if="e.riskPercent != null"> · {{ e.riskPercent }}%</template>
                          </span>
                        </div>
                      </div>
                      <div class="detail-col">
                        <div class="detail-item">
                          <span class="detail-label">Emoción al entrar</span>
                          <span class="detail-value">{{ e.emotion || 'Sin especificar' }}</span>
                        </div>
                        <div class="detail-item">
                          <span class="detail-label">¿Siguió el plan?</span>
                          <span class="detail-value" :class="e.followedPlan ? 'pl-pos' : 'pl-neg'">
                            {{ e.followedPlan ? 'Sí' : 'No' }}
                          </span>
                        </div>
                        <div class="detail-item">
                          <span class="detail-label">Cargada</span>
                          <span class="detail-value">{{ formatDate(e.entryDate) }} → {{ e.exitDate ? formatDate(e.exitDate) : 'en curso' }}</span>
                        </div>
                      </div>
                      <div class="detail-col detail-col-wide">
                        <div class="detail-item">
                          <span class="detail-label">Razón de entrada / tesis</span>
                          <p class="detail-text">{{ e.entryReason || 'Sin notas cargadas.' }}</p>
                        </div>
                        <div class="detail-item">
                          <span class="detail-label">Lecciones / revisión</span>
                          <p class="detail-text">{{ e.lessons || 'Sin notas cargadas.' }}</p>
                        </div>
                      </div>
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
          <div v-else class="empty-state">Todavía no cargaste ninguna operación en la planilla.</div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.journal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}

.journal-modal {
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

.journal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--border);
  padding-bottom: 12px;
}

.journal-title {
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

.journal-loading,
.empty-state {
  text-align: center;
  color: var(--text-dim);
  font-size: 13px;
  padding: 24px 0;
}

.journal-error,
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
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
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

.form-subsection-title {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--blue);
  margin-top: 4px;
}

.table-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}

.status-filters {
  display: flex;
  gap: 6px;
}

.filter-btn {
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text-dim);
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}

.filter-btn:hover {
  color: var(--text);
  border-color: var(--text-dim);
}

.filter-btn.active {
  background: rgba(37, 99, 235, 0.15);
  border-color: #2563eb;
  color: var(--blue);
}

.journal-table-wrap {
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
}

.journal-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.journal-table th {
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

.journal-table td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  color: var(--text);
  white-space: nowrap;
  font-family: var(--font-num, inherit);
}

.journal-table tbody tr:last-child td {
  border-bottom: none;
}

.journal-table tbody tr:hover {
  background: var(--bg);
}

.row-editing {
  background: rgba(37, 99, 235, 0.08);
}

.entry-row {
  cursor: pointer;
}

.entry-row:hover {
  background: var(--bg);
}

.row-expanded {
  background: rgba(37, 99, 235, 0.05);
}

.expand-cell {
  text-align: center;
  color: var(--text-dim);
  width: 20px;
}

.detail-row td {
  padding: 0;
  background: var(--bg);
  cursor: default;
  white-space: normal;
}

.detail-panel {
  display: grid;
  grid-template-columns: repeat(3, minmax(160px, 1fr)) minmax(240px, 1.6fr);
  gap: 14px;
  padding: 14px 16px;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}

.detail-col {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.detail-col-wide {
  grid-column: span 1;
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

@media (max-width: 900px) {
  .detail-panel {
    grid-template-columns: 1fr 1fr;
  }
  .detail-col-wide {
    grid-column: 1 / -1;
  }
}

@media (max-width: 600px) {
  .detail-panel {
    grid-template-columns: 1fr;
  }
}

.ticker-cell {
  font-weight: 700;
  font-family: inherit;
}

.plan-cell {
  text-align: center;
}

.badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  font-family: inherit;
}

.badge-acc { background: rgba(96, 165, 250, 0.15); color: #60a5fa; }
.badge-cedear { background: rgba(59, 130, 246, 0.15); color: #60a5fa; }
.badge-forex { background: rgba(45, 212, 191, 0.15); color: #2dd4bf; }
.badge-fut { background: rgba(251, 191, 36, 0.15); color: #fbbf24; }
.badge-cripto { background: rgba(249, 115, 22, 0.15); color: #fb923c; }
.badge-op { background: rgba(168, 85, 247, 0.15); color: #c084fc; }
.badge-idx { background: rgba(236, 72, 153, 0.15); color: #f472b6; }
.badge-mat { background: rgba(163, 163, 163, 0.18); color: #d4d4d4; }
.badge-bono { background: rgba(132, 204, 22, 0.15); color: #a3e635; }
.badge-otro { background: rgba(148, 163, 184, 0.15); color: #94a3b8; }

.badge-buy { background: rgba(34, 197, 94, 0.15); color: #22c55e; }
.badge-sell { background: rgba(239, 68, 68, 0.15); color: #ef4444; }

.badge-open { background: rgba(37, 99, 235, 0.15); color: #60a5fa; }
.badge-closed { background: rgba(34, 197, 94, 0.15); color: #22c55e; }
.badge-cancel { background: rgba(148, 163, 184, 0.15); color: #94a3b8; }

.pl-pos { color: #22c55e !important; }
.pl-neg { color: #ef4444 !important; }

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

.journal-form {
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
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 10px;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.form-field-wide {
  grid-column: 1 / -1;
}

.form-field-checkbox {
  justify-content: flex-end;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text);
  font-weight: 600;
  cursor: pointer;
}

.checkbox-label input[type="checkbox"] {
  width: 14px;
  height: 14px;
  cursor: pointer;
}

.form-field label {
  font-size: 10px;
  color: var(--text-dim);
  font-weight: 600;
}

.form-field input,
.form-field select,
.form-field textarea {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 8px;
  color: var(--text);
  font-size: 12px;
  font-family: inherit;
  min-width: 0;
  resize: vertical;
}

.form-field input:focus,
.form-field select:focus,
.form-field textarea:focus {
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
  .journal-overlay {
    padding: 0;
  }
  .journal-modal {
    max-width: 100%;
    height: 100vh;
    border-radius: 0;
  }
  .form-field-wide {
    grid-column: span 1;
  }
}
</style>