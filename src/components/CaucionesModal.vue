<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import {
  getCauciones,
  getCaucionesSummary,
  createCaucion,
  updateCaucion,
  deleteCaucion,
} from '../services/caucionesService'

const emit = defineEmits(['close'])

const cauciones = ref([])
const summary = ref({
  totals: {
    cantidadActivas: 0,
    cantidadFinalizadas: 0,
    totalColocadoActivas: 0,
    gananciaNetaProyectada: 0,
    gananciaNetaRealizada: 0,
    gananciaNetaTotal: 0,
    tnaNetaPromedioPonderada: 0,
  },
})
const loading = ref(true)
const errorMsg = ref('')
const saving = ref(false)
const editingId = ref(null)
const statusFilter = ref('TODAS') // TODAS | ACTIVA | FINALIZADA

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function emptyForm() {
  return {
    startDate: todayISO(),
    termDays: '',
    amount: '',
    currency: 'ARS',
    tna: '',
    broker: '',
    feeType: 'PERCENT',
    feeValue: '',
    status: 'ACTIVA',
    notes: '',
  }
}

const form = reactive(emptyForm())
const formError = ref('')

function formatMoney(n) {
  if (n === null || n === undefined || n === '') return '—'
  return (Number(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatDate(d) {
  if (!d) return '—'
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}

function currencySymbol(c) {
  return c === 'USD' ? 'US$' : '$'
}

// Vista previa en vivo mientras se completa el formulario, con las mismas
// fórmulas que usa el backend, para que el usuario vea la ganancia antes
// de guardar.
const preview = computed(() => {
  const amount = Number(form.amount)
  const tna = Number(form.tna)
  const termDays = Number(form.termDays)
  const feeValue = Number(form.feeValue)

  if (!(amount > 0) || !(termDays > 0) || Number.isNaN(tna) || tna < 0 || Number.isNaN(feeValue) || feeValue < 0) {
    return null
  }

  const grossInterest = amount * (tna / 100) * (termDays / 365)
  const brokerFee = form.feeType === 'PERCENT' ? grossInterest * (feeValue / 100) : feeValue
  const netGain = grossInterest - brokerFee
  const netTNA = amount > 0 && termDays > 0 ? (netGain / amount) * (365 / termDays) * 100 : 0

  return {
    grossInterest,
    brokerFee,
    netGain,
    netTNA,
    totalToReceive: amount + netGain,
  }
})

const filteredCauciones = computed(() => {
  if (statusFilter.value === 'TODAS') return cauciones.value
  return cauciones.value.filter((c) => c.status === statusFilter.value)
})

async function loadAll() {
  loading.value = true
  errorMsg.value = ''
  try {
    const [c, s] = await Promise.all([getCauciones(), getCaucionesSummary()])
    cauciones.value = c
    summary.value = s
  } catch (e) {
    errorMsg.value = e.message
  } finally {
    loading.value = false
  }
}

async function refreshSummary() {
  try {
    summary.value = await getCaucionesSummary()
  } catch (e) {
    console.error('Error refrescando el resumen de cauciones', e)
  }
}

function startEdit(caucion) {
  editingId.value = caucion.id
  form.startDate = caucion.startDate
  form.termDays = caucion.termDays
  form.amount = caucion.amount
  form.currency = caucion.currency
  form.tna = caucion.tna
  form.broker = caucion.broker
  form.feeType = caucion.feeType
  form.feeValue = caucion.feeValue
  form.status = caucion.status
  form.notes = caucion.notes
  formError.value = ''
}

function cancelEdit() {
  editingId.value = null
  Object.assign(form, emptyForm())
  formError.value = ''
}

async function submitForm() {
  formError.value = ''

  if (!form.startDate || Number.isNaN(new Date(form.startDate).getTime())) {
    return (formError.value = 'Ingresá una fecha de inicio válida')
  }
  if (!(Number(form.termDays) > 0)) return (formError.value = 'El plazo (días) debe ser mayor a 0')
  if (!(Number(form.amount) > 0)) return (formError.value = 'El monto debe ser mayor a 0')
  if (form.tna === '' || Number.isNaN(Number(form.tna)) || Number(form.tna) < 0) {
    return (formError.value = 'Ingresá una TNA válida')
  }
  if (form.feeValue === '' || Number.isNaN(Number(form.feeValue)) || Number(form.feeValue) < 0) {
    return (formError.value = 'Ingresá el interés/comisión cobrado por el broker')
  }

  const payload = {
    startDate: form.startDate,
    termDays: Number(form.termDays),
    amount: Number(form.amount),
    currency: form.currency,
    tna: Number(form.tna),
    broker: form.broker.trim(),
    feeType: form.feeType,
    feeValue: Number(form.feeValue),
    status: form.status,
    notes: form.notes.trim(),
  }

  saving.value = true
  try {
    if (editingId.value) {
      const updated = await updateCaucion(editingId.value, payload)
      const idx = cauciones.value.findIndex((c) => c.id === editingId.value)
      if (idx !== -1) cauciones.value[idx] = updated
    } else {
      const created = await createCaucion(payload)
      cauciones.value.unshift(created)
    }
    cancelEdit()
    await refreshSummary()
  } catch (e) {
    formError.value = e.message
  } finally {
    saving.value = false
  }
}

async function toggleStatus(caucion) {
  try {
    const updated = await updateCaucion(caucion.id, {
      status: caucion.status === 'ACTIVA' ? 'FINALIZADA' : 'ACTIVA',
    })
    const idx = cauciones.value.findIndex((c) => c.id === caucion.id)
    if (idx !== -1) cauciones.value[idx] = updated
    await refreshSummary()
  } catch (e) {
    errorMsg.value = e.message
  }
}

async function removeCaucion(caucion) {
  const ok = window.confirm(
    `¿Borrar la caución de ${currencySymbol(caucion.currency)}${formatMoney(caucion.amount)} del ${formatDate(caucion.startDate)}?`
  )
  if (!ok) return
  try {
    await deleteCaucion(caucion.id)
    cauciones.value = cauciones.value.filter((c) => c.id !== caucion.id)
    if (editingId.value === caucion.id) cancelEdit()
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

onMounted(loadAll)
</script>

<template>
  <div class="cauciones-overlay" @click="onOverlayClick">
    <div class="cauciones-modal">
      <div class="cauciones-header">
        <div class="cauciones-title">
          <span class="cauciones-icon">💰</span>
          Cauciones
        </div>
        <button class="close-btn" @click="close" title="Cerrar">✕</button>
      </div>

      <div v-if="loading" class="cauciones-loading">Cargando cauciones...</div>

      <template v-else>
        <div v-if="errorMsg" class="cauciones-error">{{ errorMsg }}</div>

        <!-- Resumen general -->
        <div class="summary-bar">
          <div class="summary-card">
            <span class="summary-label">Colocado en activas</span>
            <strong>${{ formatMoney(summary.totals.totalColocadoActivas) }}</strong>
          </div>
          <div class="summary-card">
            <span class="summary-label">Ganancia neta proyectada</span>
            <strong class="pl-pos">+${{ formatMoney(summary.totals.gananciaNetaProyectada) }}</strong>
          </div>
          <div class="summary-card">
            <span class="summary-label">Ganancia neta realizada</span>
            <strong class="pl-pos">+${{ formatMoney(summary.totals.gananciaNetaRealizada) }}</strong>
          </div>
          <div class="summary-card">
            <span class="summary-label">Ganancia neta total</span>
            <strong class="pl-pos">+${{ formatMoney(summary.totals.gananciaNetaTotal) }}</strong>
          </div>
          <div class="summary-card">
            <span class="summary-label">TNA neta prom. ponderada</span>
            <strong>{{ formatMoney(summary.totals.tnaNetaPromedioPonderada) }}%</strong>
          </div>
          <div class="summary-card">
            <span class="summary-label">Activas / Finalizadas</span>
            <strong>{{ summary.totals.cantidadActivas }} / {{ summary.totals.cantidadFinalizadas }}</strong>
          </div>
        </div>

        <!-- Formulario alta / edición -->
        <form class="caucion-form" @submit.prevent="submitForm">
          <div class="section-title">{{ editingId ? 'Editar caución' : 'Nueva caución' }}</div>
          <div class="form-grid">
            <div class="form-field">
              <label>Fecha de la caución</label>
              <input type="date" v-model="form.startDate" required>
            </div>
            <div class="form-field">
              <label>Plazo (días)</label>
              <input type="number" min="1" step="1" v-model="form.termDays" placeholder="Ej: 7" required>
            </div>
            <div class="form-field">
              <label>Moneda</label>
              <select v-model="form.currency">
                <option value="ARS">Pesos (ARS)</option>
                <option value="USD">Dólares (USD)</option>
              </select>
            </div>
            <div class="form-field">
              <label>Monto colocado</label>
              <input type="number" min="0" step="any" v-model="form.amount" placeholder="Ej: 1000000" required>
            </div>
            <div class="form-field">
              <label>TNA pactada (%)</label>
              <input type="number" min="0" step="any" v-model="form.tna" placeholder="Ej: 35.5" required>
            </div>
            <div class="form-field">
              <label>Broker</label>
              <input type="text" v-model="form.broker" placeholder="Ej: IOL, Cocos">
            </div>
            <div class="form-field">
              <label>Interés/comisión cobrado por el broker</label>
              <select v-model="form.feeType">
                <option value="PERCENT">% sobre el interés bruto</option>
                <option value="FIXED">Monto fijo</option>
              </select>
            </div>
            <div class="form-field">
              <label>{{ form.feeType === 'PERCENT' ? 'Comisión (%)' : `Comisión (${currencySymbol(form.currency)})` }}</label>
              <input type="number" min="0" step="any" v-model="form.feeValue" placeholder="Ej: 8" required>
            </div>
            <div class="form-field">
              <label>Estado</label>
              <select v-model="form.status">
                <option value="ACTIVA">Activa</option>
                <option value="FINALIZADA">Finalizada</option>
              </select>
            </div>
            <div class="form-field form-field-wide">
              <label>Notas</label>
              <input type="text" v-model="form.notes" placeholder="Opcional">
            </div>
          </div>

          <!-- Vista previa en vivo del resultado -->
          <div v-if="preview" class="preview-box">
            <div class="preview-item">
              <span class="preview-label">Interés bruto</span>
              <strong>{{ currencySymbol(form.currency) }}{{ formatMoney(preview.grossInterest) }}</strong>
            </div>
            <div class="preview-item">
              <span class="preview-label">Comisión del broker</span>
              <strong class="pl-neg">-{{ currencySymbol(form.currency) }}{{ formatMoney(preview.brokerFee) }}</strong>
            </div>
            <div class="preview-item">
              <span class="preview-label">Ganancia neta (te queda)</span>
              <strong :class="preview.netGain >= 0 ? 'pl-pos' : 'pl-neg'">
                {{ preview.netGain >= 0 ? '+' : '' }}{{ currencySymbol(form.currency) }}{{ formatMoney(preview.netGain) }}
              </strong>
            </div>
            <div class="preview-item">
              <span class="preview-label">TNA neta real</span>
              <strong>{{ formatMoney(preview.netTNA) }}%</strong>
            </div>
            <div class="preview-item">
              <span class="preview-label">Total a cobrar al vencimiento</span>
              <strong>{{ currencySymbol(form.currency) }}{{ formatMoney(preview.totalToReceive) }}</strong>
            </div>
          </div>

          <div v-if="formError" class="form-error">{{ formError }}</div>

          <div class="form-actions">
            <button type="submit" class="btn-primary" :disabled="saving">
              {{ saving ? 'Guardando...' : editingId ? 'Guardar cambios' : 'Agregar caución' }}
            </button>
            <button v-if="editingId" type="button" class="btn-secondary" @click="cancelEdit">Cancelar</button>
          </div>
        </form>

        <!-- Listado -->
        <div class="list-section">
          <div class="table-header-row">
            <div class="section-title">Cauciones cargadas ({{ filteredCauciones.length }})</div>
            <div class="status-filters">
              <button
                type="button"
                class="filter-btn"
                :class="{ active: statusFilter === 'TODAS' }"
                @click="statusFilter = 'TODAS'"
              >Todas</button>
              <button
                type="button"
                class="filter-btn"
                :class="{ active: statusFilter === 'ACTIVA' }"
                @click="statusFilter = 'ACTIVA'"
              >Activas</button>
              <button
                type="button"
                class="filter-btn"
                :class="{ active: statusFilter === 'FINALIZADA' }"
                @click="statusFilter = 'FINALIZADA'"
              >Finalizadas</button>
            </div>
          </div>

          <div v-if="!filteredCauciones.length" class="empty-state">
            Todavía no hay cauciones en este filtro.
          </div>

          <div v-else class="entry-cards">
            <div v-for="c in filteredCauciones" :key="c.id" class="entry-card">
              <div class="entry-card-header">
                <div class="entry-card-title">
                  <span class="ticker-cell">{{ currencySymbol(c.currency) }}{{ formatMoney(c.amount) }}</span>
                  <span class="badge" :class="c.status === 'ACTIVA' ? 'badge-buy' : 'badge-neutral'">
                    {{ c.status === 'ACTIVA' ? 'Activa' : 'Finalizada' }}
                  </span>
                  <span v-if="c.broker" class="badge badge-cedear">{{ c.broker }}</span>
                </div>
                <div class="entry-card-actions">
                  <button
                    class="icon-btn"
                    :title="c.status === 'ACTIVA' ? 'Marcar como finalizada' : 'Reabrir'"
                    @click="toggleStatus(c)"
                  >{{ c.status === 'ACTIVA' ? '✅' : '↩' }}</button>
                  <button class="icon-btn" title="Editar" @click="startEdit(c)">✎</button>
                  <button class="icon-btn icon-btn-danger" title="Eliminar" @click="removeCaucion(c)">🗑</button>
                </div>
              </div>

              <div class="entry-card-dates">
                Del {{ formatDate(c.startDate) }} al {{ formatDate(c.endDate) }} · {{ c.termDays }} días · TNA {{ formatMoney(c.tna) }}%
              </div>

              <div class="entry-card-grid">
                <div class="detail-item">
                  <span class="detail-label">Interés bruto</span>
                  <span class="detail-value">{{ currencySymbol(c.currency) }}{{ formatMoney(c.grossInterest) }}</span>
                </div>
                <div class="detail-item">
                  <span class="detail-label">Comisión broker</span>
                  <span class="detail-value pl-neg">-{{ currencySymbol(c.currency) }}{{ formatMoney(c.brokerFee) }}</span>
                </div>
                <div class="detail-item">
                  <span class="detail-label">Ganancia neta</span>
                  <span class="detail-value" :class="c.netGain >= 0 ? 'pl-pos' : 'pl-neg'">
                    {{ c.netGain >= 0 ? '+' : '' }}{{ currencySymbol(c.currency) }}{{ formatMoney(c.netGain) }}
                  </span>
                </div>
                <div class="detail-item">
                  <span class="detail-label">TNA neta real</span>
                  <span class="detail-value">{{ formatMoney(c.netTNA) }}%</span>
                </div>
                <div class="detail-item">
                  <span class="detail-label">Total a cobrar</span>
                  <span class="detail-value">{{ currencySymbol(c.currency) }}{{ formatMoney(c.totalToReceive) }}</span>
                </div>
              </div>

              <div v-if="c.notes" class="entry-card-notes">
                <div class="detail-item">
                  <span class="detail-label">Notas</span>
                  <p class="detail-text">{{ c.notes }}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.cauciones-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 24px;
}

.cauciones-modal {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 14px;
  width: 100%;
  max-width: 1000px;
  max-height: 90vh;
  overflow-y: auto;
  padding: 24px 28px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  font-size: 14.5px;
  line-height: 1.5;
}

.cauciones-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--border);
  padding-bottom: 16px;
}

.cauciones-title {
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

.cauciones-loading,
.empty-state {
  text-align: center;
  color: var(--text-dim);
  font-size: 14px;
  padding: 32px 0;
}

.cauciones-error,
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
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
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
  font-size: 19px;
  color: var(--text);
  font-family: var(--font-num, inherit);
}

.section-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--text);
}

.caucion-form {
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

.preview-box {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 14px;
  background: var(--panel);
  border: 1px dashed var(--border);
  border-radius: 10px;
  padding: 16px;
}

.preview-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.preview-label {
  font-size: 11.5px;
  color: var(--text-dim);
}

.preview-item strong {
  font-size: 16px;
  font-family: var(--font-num, inherit);
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

.list-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.table-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
}

.status-filters {
  display: flex;
  gap: 8px;
}

.filter-btn {
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text-dim);
  border-radius: 999px;
  padding: 7px 14px;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}

.filter-btn:hover {
  color: var(--text);
}

.filter-btn.active {
  background: rgba(37, 99, 235, 0.15);
  border-color: #2563eb;
  color: var(--blue);
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
  grid-template-columns: 1fr;
  gap: 14px;
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

.ticker-cell {
  font-weight: 700;
  font-size: 15px;
  font-family: var(--font-num, inherit);
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

.badge-buy {
  background: rgba(34, 197, 94, 0.15);
  color: #22c55e;
}

.badge-neutral {
  background: rgba(176, 180, 188, 0.15);
  color: var(--text-dim);
}

.pl-pos {
  color: #22c55e !important;
}

.pl-neg {
  color: #ef4444 !important;
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

@media (max-width: 760px) {
  .cauciones-overlay {
    padding: 0;
  }
  .cauciones-modal {
    max-width: 100%;
    height: 100vh;
    height: 100dvh;
    border-radius: 0;
    padding: 16px 12px;
    gap: 14px;
    font-size: 14px;
  }
  .cauciones-title {
    font-size: 16px;
  }
  .form-field-wide {
    grid-column: span 1;
  }
  .caucion-form {
    padding: 16px;
  }
  .form-field input,
  .form-field select {
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
}
</style>
