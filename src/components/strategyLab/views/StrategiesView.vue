<script setup>
import { ref, reactive, computed, watch } from 'vue'
import { useStrategyLab } from '../../../composables/useStrategyLab.js'
import ConditionBuilder from '../ConditionBuilder.vue'
import TagInput from '../TagInput.vue'
import ConfirmDialog from '../ConfirmDialog.vue'

const emit = defineEmits(['navigate'])
const { strategies, createStrategy, updateStrategy, deleteStrategy } = useStrategyLab()

const TF_HINTS = ['1m', '5m', '15m', '30m', '1H', '2H', '4H', '1D', '1W', '1M']
const IND_HINTS = ['HMA 50', 'EMA 20', 'EMA 200', 'SMA 50', 'RSI 14', 'MACD', 'VWAP', 'ATR 14', 'Volumen', 'Bollinger 20,2', 'ADX 14']
const MODE_LABELS = { BOTH: 'Long y Short', LONG: 'Solo Long', SHORT: 'Solo Short' }

const filterStatus = ref('ACTIVE')
const list = computed(() => strategies.value.filter((s) => filterStatus.value === 'ALL' || s.status === filterStatus.value))

const selectedId = ref(null) // number | 'new' | null
const form = reactive({ name: '', category: '', description: '', notes: '', status: 'ACTIVE', rules: blankRules(), changeNote: '', forceNewVersion: false })
const initialRulesSig = ref('')
const viewVersion = ref(null)
const saving = ref(false)
const error = ref('')
const flash = ref('')
const confirmDelete = ref(false)

function blankRules() {
  return { directionMode: 'BOTH', timeframes: [], indicators: [], stopLossRule: '', takeProfitRule: '', targetRr: null, conditions: [] }
}
const clone = (o) => JSON.parse(JSON.stringify(o))
const rulesSig = (r) => JSON.stringify({ ...r, targetRr: r.targetRr === '' ? null : r.targetRr, conditions: [...r.conditions].map((c) => ({ ...c, position: 0 })).sort((a, b) => a.key.localeCompare(b.key)), timeframes: [...r.timeframes].sort(), indicators: [...r.indicators].sort() })

const current = computed(() => (typeof selectedId.value === 'number' ? strategies.value.find((s) => s.id === selectedId.value) : null))

function loadFrom(s) {
  Object.assign(form, { name: s.name, category: s.category, description: s.description, notes: s.notes, status: s.status, changeNote: '', forceNewVersion: false })
  const v = s.current
  form.rules = v ? { directionMode: v.directionMode, timeframes: [...v.timeframes], indicators: [...v.indicators], stopLossRule: v.stopLossRule, takeProfitRule: v.takeProfitRule, targetRr: v.targetRr, conditions: clone(v.conditions) } : blankRules()
  initialRulesSig.value = rulesSig(form.rules)
  viewVersion.value = null
}
function select(id) {
  error.value = ''; flash.value = ''
  selectedId.value = id
  if (id === 'new') { Object.assign(form, { name: '', category: '', description: '', notes: '', status: 'ACTIVE', changeNote: '', forceNewVersion: false }); form.rules = blankRules(); initialRulesSig.value = rulesSig(form.rules); viewVersion.value = null }
  else { const s = strategies.value.find((x) => x.id === id); if (s) loadFrom(s) }
}
function duplicate() {
  const s = current.value
  if (!s) return
  select('new')
  Object.assign(form, { name: `${s.name} (copia)`, category: s.category, description: s.description, notes: s.notes })
  const v = s.current
  const newKey = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `k${Date.now()}${Math.random().toString(16).slice(2)}`)
  form.rules = { directionMode: v.directionMode, timeframes: [...v.timeframes], indicators: [...v.indicators], stopLossRule: v.stopLossRule, takeProfitRule: v.takeProfitRule, targetRr: v.targetRr, conditions: clone(v.conditions).map((c) => ({ ...c, key: newKey() })) }
  initialRulesSig.value = ''
}

const rulesChanged = computed(() => selectedId.value !== 'new' && rulesSig(form.rules) !== initialRulesSig.value)
const versionHint = computed(() => {
  const s = current.value
  if (!s || !rulesChanged.value) return ''
  const used = s.current?.tradeCount || 0
  return used > 0
    ? `La versión v${s.currentVersion} ya tiene ${used} operación(es). Al guardar se creará la v${s.currentVersion + 1} y la v${s.currentVersion} quedará intacta.`
    : `La versión v${s.currentVersion} todavía no tiene operaciones: los cambios se aplican sobre ella sin crear versión nueva (a menos que fuerces una nueva).`
})
const canSave = computed(() => form.name.trim().length > 0 && !saving.value)

async function save() {
  error.value = ''; flash.value = ''; saving.value = true
  try {
    const rules = clone(form.rules)
    rules.targetRr = rules.targetRr === '' || rules.targetRr === null ? null : Number(rules.targetRr)
    const base = { name: form.name, category: form.category, description: form.description, notes: form.notes, status: form.status, version: rules }
    if (selectedId.value === 'new') {
      const created = await createStrategy(base)
      selectedId.value = created.id
      loadFrom(strategies.value.find((s) => s.id === created.id) || created)
      flash.value = 'Estrategia creada (versión 1).'
    } else {
      const res = await updateStrategy(selectedId.value, { ...base, changeNote: form.changeNote, forceNewVersion: form.forceNewVersion })
      loadFrom(strategies.value.find((s) => s.id === selectedId.value) || res)
      flash.value = res.saveOutcome === 'NEW_VERSION' ? `Se creó la versión ${res.currentVersion}. Las operaciones anteriores conservan sus reglas.`
        : res.saveOutcome === 'UPDATED_IN_PLACE' ? 'Reglas actualizadas (la versión vigente no tenía operaciones).' : 'Cambios guardados.'
    }
  } catch (e) { error.value = e.message } finally { saving.value = false }
}
async function remove() {
  saving.value = true
  try { await deleteStrategy(selectedId.value); selectedId.value = null; confirmDelete.value = false }
  catch (e) { error.value = e.message; confirmDelete.value = false } finally { saving.value = false }
}

watch(strategies, () => { if (typeof selectedId.value === 'number' && !strategies.value.some((s) => s.id === selectedId.value)) selectedId.value = null })
const shownVersion = computed(() => (viewVersion.value ? current.value?.versions.find((v) => v.versionNumber === viewVersion.value) : null))
</script>

<template>
  <div class="sl-wrap">
    <div class="sl-split">
      <!-- Lista -->
      <div class="sl-panel">
        <div class="sl-panel-head">
          <span class="sl-panel-title">Estrategias</span>
          <button class="sl-btn primary sm" @click="select('new')">+ Nueva</button>
        </div>
        <div style="padding: 8px 12px; border-bottom: 1px solid var(--border)">
          <div class="sl-seg">
            <button :class="{ active: filterStatus === 'ACTIVE' }" @click="filterStatus = 'ACTIVE'">Activas</button>
            <button :class="{ active: filterStatus === 'ARCHIVED' }" @click="filterStatus = 'ARCHIVED'">Archivadas</button>
            <button :class="{ active: filterStatus === 'ALL' }" @click="filterStatus = 'ALL'">Todas</button>
          </div>
        </div>
        <div v-if="!list.length" class="sl-empty">No hay estrategias {{ filterStatus === 'ARCHIVED' ? 'archivadas' : 'en esta vista' }}.</div>
        <div class="sl-list">
          <button v-for="s in list" :key="s.id" class="sl-list-item" :class="{ active: selectedId === s.id }" @click="select(s.id)">
            <span class="sl-list-title">{{ s.name }}</span>
            <span class="sl-list-sub">{{ s.category || 'Sin categoría' }} · v{{ s.currentVersion }} · {{ s.tradeCount }} ops <span v-if="s.status === 'ARCHIVED'" class="sl-badge" style="margin-left: 4px">Archivada</span></span>
          </button>
        </div>
      </div>

      <!-- Editor -->
      <div class="sl-panel">
        <div v-if="selectedId === null" class="sl-empty">Elegí una estrategia de la lista o creá una nueva.</div>
        <template v-else>
          <div class="sl-panel-head">
            <span class="sl-panel-title">{{ selectedId === 'new' ? 'Nueva estrategia' : `Editar · versión vigente v${current?.currentVersion}` }}</span>
            <span style="display: flex; gap: 8px">
              <button v-if="current" class="sl-btn sm" @click="emit('navigate', 'register')">Registrar operación</button>
              <button v-if="current" class="sl-btn sm" @click="duplicate">Duplicar</button>
              <button v-if="current" class="sl-btn sm danger" @click="confirmDelete = true">Eliminar</button>
            </span>
          </div>
          <div class="sl-panel-body" style="display: flex; flex-direction: column; gap: 18px">
            <div v-if="error" class="sl-error">{{ error }}</div>
            <div v-if="flash" class="sl-note">{{ flash }}</div>

            <div class="sl-cols">
              <div class="sl-field" style="grid-column: span 2"><span class="sl-label">Nombre *</span><input v-model="form.name" class="sl-input" maxlength="80" placeholder="Ej: HMA 50 + RSI + MACD" /></div>
              <div class="sl-field"><span class="sl-label">Categoría</span><input v-model="form.category" class="sl-input" placeholder="Tendencia, reversión, breakout..." /></div>
              <div class="sl-field"><span class="sl-label">Estado</span>
                <select v-model="form.status" class="sl-select"><option value="ACTIVE">Activa</option><option value="ARCHIVED">Archivada</option></select></div>
            </div>
            <div class="sl-field"><span class="sl-label">Descripción</span><textarea v-model="form.description" class="sl-textarea" rows="2" /></div>

            <div class="sl-panel" style="background: var(--bg)">
              <div class="sl-panel-head"><span class="sl-panel-title">Reglas (versionadas)</span><span v-if="rulesChanged" class="sl-badge warn">Reglas modificadas sin guardar</span></div>
              <div class="sl-panel-body" style="display: flex; flex-direction: column; gap: 16px">
                <div class="sl-cols">
                  <div class="sl-field"><span class="sl-label">Tipo de operación</span>
                    <select v-model="form.rules.directionMode" class="sl-select"><option v-for="(l, k) in MODE_LABELS" :key="k" :value="k">{{ l }}</option></select></div>
                  <div class="sl-field"><span class="sl-label">R:R objetivo</span><input v-model.number="form.rules.targetRr" type="number" step="0.1" min="0" class="sl-input num" placeholder="Ej: 2" /></div>
                  <div class="sl-field" style="grid-column: span 2"><span class="sl-label">Temporalidades admitidas (vacío = cualquiera)</span><TagInput v-model="form.rules.timeframes" :suggestions="TF_HINTS" placeholder="15m, 1H, 1D + Enter" /></div>
                </div>
                <div class="sl-field"><span class="sl-label">Indicadores utilizados</span><TagInput v-model="form.rules.indicators" :suggestions="IND_HINTS" placeholder="HMA 50, RSI 14... + Enter" /></div>
                <div class="sl-cols">
                  <div class="sl-field" style="grid-column: span 2"><span class="sl-label">Stop loss (regla)</span><input v-model="form.rules.stopLossRule" class="sl-input" placeholder="Ej: debajo del último mínimo, o 1.5 ATR" /></div>
                  <div class="sl-field" style="grid-column: span 2"><span class="sl-label">Take profit (regla)</span><input v-model="form.rules.takeProfitRule" class="sl-input" placeholder="Ej: 2R, o resistencia previa" /></div>
                </div>
                <ConditionBuilder v-model="form.rules.conditions" :indicator-hints="form.rules.indicators" />
              </div>
            </div>

            <div class="sl-field"><span class="sl-label">Observaciones</span><textarea v-model="form.notes" class="sl-textarea" rows="2" /></div>

            <div v-if="versionHint" class="sl-note warn">{{ versionHint }}</div>
            <div v-if="rulesChanged && current" class="sl-cols">
              <div class="sl-field" style="grid-column: span 2"><span class="sl-label">Nota del cambio (opcional)</span><input v-model="form.changeNote" class="sl-input" maxlength="300" placeholder="Qué cambiaste y por qué" /></div>
              <label class="sl-check" style="align-self: end"><input v-model="form.forceNewVersion" type="checkbox" /> Forzar versión nueva</label>
            </div>

            <div style="display: flex; justify-content: flex-end; gap: 8px">
              <button class="sl-btn" :disabled="saving" @click="selectedId === 'new' ? (selectedId = null) : select(selectedId)">Descartar cambios</button>
              <button class="sl-btn primary" :disabled="!canSave" @click="save">{{ saving ? 'Guardando…' : selectedId === 'new' ? 'Crear estrategia' : 'Guardar' }}</button>
            </div>

            <!-- Historial de versiones -->
            <div v-if="current" class="sl-panel" style="background: var(--bg)">
              <div class="sl-panel-head"><span class="sl-panel-title">Historial de versiones</span></div>
              <div class="sl-scroll">
                <table class="sl-table">
                  <thead><tr><th>Versión</th><th>Creada</th><th>Nota</th><th class="num">Ops</th><th class="num">Condiciones</th><th></th></tr></thead>
                  <tbody>
                    <tr v-for="v in current.versions" :key="v.id">
                      <td>v{{ v.versionNumber }} <span v-if="v.versionNumber === current.currentVersion" class="sl-badge ok">vigente</span></td>
                      <td class="dim">{{ v.createdAt }}</td>
                      <td>{{ v.changeNote || '—' }}</td>
                      <td class="num">{{ v.tradeCount }}</td>
                      <td class="num">{{ v.conditions.filter((c) => c.enabled).length }} / {{ v.conditions.length }}</td>
                      <td><button class="sl-btn sm ghost" @click="viewVersion = viewVersion === v.versionNumber ? null : v.versionNumber">{{ viewVersion === v.versionNumber ? 'Ocultar' : 'Ver reglas' }}</button></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div v-if="shownVersion" class="sl-panel-body" style="border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 10px">
                <div class="sl-note">Versión v{{ shownVersion.versionNumber }} (solo lectura) · {{ MODE_LABELS[shownVersion.directionMode] }} · TF: {{ shownVersion.timeframes.join(', ') || 'cualquiera' }} · SL: {{ shownVersion.stopLossRule || '—' }} · TP: {{ shownVersion.takeProfitRule || '—' }} · R:R objetivo: {{ shownVersion.targetRr ?? '—' }}</div>
                <ConditionBuilder :model-value="shownVersion.conditions" readonly />
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>

    <ConfirmDialog v-if="confirmDelete" title="Eliminar estrategia" :message="`¿Eliminar «${current?.name}»? Solo es posible si no tiene operaciones registradas; si las tiene, archivala.`" confirm-text="Eliminar" :busy="saving" @confirm="remove" @cancel="confirmDelete = false" />
  </div>
</template>
