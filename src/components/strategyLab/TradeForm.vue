<script setup>
// Formulario de registro/edición de operaciones. Valida y calcula en vivo con
// el MISMO módulo (tradeMath.js) que usa el backend, así lo que se ve acá es
// exactamente lo que se guarda.
import { reactive, ref, computed, watch, onMounted } from 'vue'
import { useStrategyLab } from '../../composables/useStrategyLab.js'
import { INSTRUMENT_TYPES, computeTrade, computeCompliance, validateTradeInput, normalizeTradingViewUrl, splitLinkInput } from '../../services/strategyLab/tradeMath.js'
import { MARKET_LABELS, OUTCOME_LABELS, fmtNum, fmtValue, tone } from '../../services/strategyLab/format.js'

const props = defineProps({ trade: { type: Object, default: null } })
const emit = defineEmits(['saved', 'cancel'])
const { strategies, activeStrategies, symbols, createTrade, updateTrade, api } = useStrategyLab()

const isEdit = computed(() => !!props.trade)
const today = () => new Date().toISOString().slice(0, 10)
const blank = () => ({
  recordType: 'BACKTEST', strategyId: null, versionId: null, symbol: '', assetName: '', market: '', instrumentType: 'ACCION',
  direction: 'LONG', timeframe: '', entryDate: today(), entryTime: '', entryPrice: '', stopLoss: '', takeProfit: '',
  riskAmount: '', riskPercent: '', quantity: '', fees: '', currency: '', exitDate: '', exitTime: '', exitPrice: '', notes: '',
})
const f = reactive(blank())
const results = reactive({}) // conditionId -> 'MET' | 'NOT_MET' | 'NA'
const pendingLinks = ref([]) // links de TradingView nuevos, todavía sin guardar [url]
const existing = ref([])     // links (y capturas heredadas) ya guardados (edición)
const linkInput = ref('')
const linkError = ref('')
const saving = ref(false)
const error = ref('')
const flash = ref('')
const attempted = ref(false)

const strategyOptions = computed(() => (isEdit.value ? strategies.value : activeStrategies.value))
const strategy = computed(() => strategies.value.find((s) => s.id === f.strategyId) || null)
const version = computed(() => strategy.value?.versions.find((v) => v.id === f.versionId) || null)
const enabledConds = computed(() => (version.value ? version.value.conditions.filter((c) => c.enabled) : []))
const directionLocked = computed(() => version.value && version.value.directionMode !== 'BOTH')

function onStrategyChange() {
  const s = strategy.value
  f.versionId = s?.current?.id ?? null
  applyVersionDefaults()
  Object.keys(results).forEach((k) => delete results[k])
}
function applyVersionDefaults() {
  const v = version.value
  if (!v) return
  if (v.directionMode !== 'BOTH') f.direction = v.directionMode
  if (v.timeframes.length && !v.timeframes.includes(f.timeframe)) f.timeframe = v.timeframes.length === 1 ? v.timeframes[0] : ''
}
function onVersionChange(prevConds) {
  applyVersionDefaults()
  // conserva las respuestas de condiciones con la misma clave estable
  const byKey = new Map((prevConds || []).map((c) => [c.key, results[c.id]]))
  Object.keys(results).forEach((k) => delete results[k])
  for (const c of enabledConds.value) if (byKey.get(c.key)) results[c.id] = byKey.get(c.key)
}
let prevConds = []
watch(() => f.versionId, () => { onVersionChange(prevConds); prevConds = version.value ? version.value.conditions : [] })

function setAll(status) { for (const c of enabledConds.value) results[c.id] = status }

const payload = computed(() => ({
  ...f,
  exitDate: f.exitDate || null,
  conditionResults: enabledConds.value.filter((c) => results[c.id]).map((c) => ({ conditionId: c.id, status: results[c.id] })),
}))
const ctx = computed(() => ({ directionMode: version.value?.directionMode, timeframes: version.value?.timeframes }))
const liveErrors = computed(() => {
  const errs = []
  if (!f.strategyId) errs.push('Elegí una estrategia')
  errs.push(...validateTradeInput(f, ctx.value))
  const missing = enabledConds.value.filter((c) => !results[c.id]).length
  if (missing) errs.push(`Falta marcar ${missing} condición(es) (cumplida / no cumplida / no aplica)`)
  if (isEdit.value === false && strategy.value?.status === 'ARCHIVED') errs.push('La estrategia está archivada')
  return errs
})
const calc = computed(() => computeTrade(f))
const compliance = computed(() => computeCompliance(enabledConds.value.map((c) => ({ status: results[c.id], required: c.required }))))
const riskPerUnit = computed(() => (Number(f.entryPrice) > 0 && Number(f.stopLoss) > 0 ? Math.abs(Number(f.entryPrice) - Number(f.stopLoss)) : null))
const rrBelowTarget = computed(() => version.value?.targetRr && calc.value.plannedRR !== null && calc.value.plannedRR < version.value.targetRr)

// ---------- Links de TradingView ----------
const existingLinks = computed(() => existing.value.filter((x) => x.kind === 'link').map((x) => x.url))
function addLinks() {
  linkError.value = ''
  const tokens = splitLinkInput(linkInput.value)
  if (!tokens.length) { linkError.value = 'Pegá un link de TradingView'; return }
  const bad = []
  for (const t of tokens) {
    const url = normalizeTradingViewUrl(t)
    if (!url) { bad.push(t); continue }
    if (pendingLinks.value.includes(url) || existingLinks.value.includes(url)) continue
    pendingLinks.value.push(url)
  }
  linkInput.value = bad.join('\n')
  if (bad.length) linkError.value = `${bad.length} link(s) no válidos: solo se aceptan links de tradingview.com`
}
async function removeExisting(att) {
  try { await api.deleteAttachment(props.trade.id, att.id); existing.value = existing.value.filter((a) => a.id !== att.id) } catch (e) { error.value = e.message }
}
const shortLink = (u) => u.replace(/^https?:\/\/(www\.)?/, '')

// ---------- Guardado ----------
async function save(andNew = false) {
  attempted.value = true; error.value = ''; flash.value = ''
  if (liveErrors.value.length) return
  saving.value = true
  try {
    const body = { ...payload.value }
    if (isEdit.value) { delete body.strategyId; delete body.versionId }
    const saved = isEdit.value ? await updateTrade(props.trade.id, body) : await createTrade(body)
    let uploadError = ''
    for (const url of pendingLinks.value) {
      try { await api.addAttachment(saved.id, { url }) } catch (e) { uploadError = e.message }
    }
    pendingLinks.value = []
    if (uploadError) flash.value = `Operación guardada, pero un link no se pudo guardar: ${uploadError}`
    emit('saved', saved, andNew)
    if (andNew && !isEdit.value) {
      Object.assign(f, { symbol: '', assetName: '', entryTime: '', entryPrice: '', stopLoss: '', takeProfit: '', riskAmount: '', riskPercent: '', quantity: '', fees: '', exitDate: '', exitTime: '', exitPrice: '', notes: '' })
      Object.keys(results).forEach((k) => delete results[k])
      attempted.value = false
      flash.value = flash.value || `Guardada (${saved.symbol}). Podés cargar la siguiente.`
    }
  } catch (e) { error.value = e.message } finally { saving.value = false }
}

onMounted(async () => {
  if (props.trade) {
    const t = props.trade
    Object.assign(f, {
      recordType: t.recordType, strategyId: t.strategyId, versionId: t.versionId, symbol: t.symbol, assetName: t.assetName || '', market: t.market || '',
      instrumentType: t.instrumentType, direction: t.direction, timeframe: t.timeframe, entryDate: t.entryDate, entryTime: t.entryTime || '',
      entryPrice: t.entryPrice, stopLoss: t.stopLoss ?? '', takeProfit: t.takeProfit ?? '', riskAmount: t.riskAmount ?? '', riskPercent: t.riskPercent ?? '',
      quantity: t.quantity ?? '', fees: t.fees || '', currency: t.currency || '', exitDate: t.exitDate || '', exitTime: t.exitTime || '', exitPrice: t.exitPrice ?? '', notes: t.notes || '',
    })
    for (const c of t.conditionResults) results[c.conditionId] = c.status
    prevConds = version.value ? version.value.conditions : []
    try { existing.value = await api.listAttachments(t.id) } catch { /* no bloquea la edición */ }
  } else if (activeStrategies.value.length) {
    f.strategyId = activeStrategies.value[0].id
    onStrategyChange()
    prevConds = version.value ? version.value.conditions : []
  }
})
const kindLabel = { ENTRY: 'Entrada', EXIT: 'Salida', FILTER: 'Filtro' }
</script>

<template>
  <div class="sl-wrap">
    <div v-if="!strategyOptions.length" class="sl-panel"><div class="sl-empty">Primero creá una estrategia activa para poder registrar operaciones.</div></div>
    <template v-else>
      <div v-if="error" class="sl-error">{{ error }}</div>
      <div v-if="flash" class="sl-note">{{ flash }}</div>

      <!-- 1. Clasificación e identificación -->
      <div class="sl-panel">
        <div class="sl-panel-head"><span class="sl-panel-title">1 · Identificación</span></div>
        <div class="sl-panel-body" style="display: flex; flex-direction: column; gap: 14px">
          <div class="sl-field">
            <span class="sl-label">Tipo de registro *</span>
            <div class="sl-seg" style="align-self: flex-start">
              <button type="button" :class="{ active: f.recordType === 'BACKTEST' }" @click="f.recordType = 'BACKTEST'">Backtesting manual (oportunidad histórica)</button>
              <button type="button" :class="{ active: f.recordType === 'REAL' }" @click="f.recordType = 'REAL'">Trading real (operación ejecutada)</button>
            </div>
          </div>
          <div class="sl-cols">
            <div class="sl-field"><span class="sl-label">Estrategia *</span>
              <select v-model="f.strategyId" class="sl-select" :disabled="isEdit" @change="onStrategyChange"><option v-for="s in strategyOptions" :key="s.id" :value="s.id">{{ s.name }}{{ s.status === 'ARCHIVED' ? ' (archivada)' : '' }}</option></select></div>
            <div class="sl-field"><span class="sl-label">Versión {{ isEdit ? '(fija)' : '' }}</span>
              <select v-model="f.versionId" class="sl-select" :disabled="isEdit"><option v-for="v in strategy?.versions || []" :key="v.id" :value="v.id">v{{ v.versionNumber }}{{ v.versionNumber === strategy.currentVersion ? ' (vigente)' : '' }}</option></select></div>
            <div class="sl-field"><span class="sl-label">Ticker *</span><input v-model="f.symbol" class="sl-input" list="sl-symbols" style="text-transform: uppercase" placeholder="NVDA" /><datalist id="sl-symbols"><option v-for="s in symbols" :key="s" :value="s" /></datalist></div>
            <div class="sl-field"><span class="sl-label">Nombre del activo</span><input v-model="f.assetName" class="sl-input" placeholder="NVIDIA Corp." /></div>
            <div class="sl-field"><span class="sl-label">Mercado</span><input v-model="f.market" class="sl-input" list="sl-markets" placeholder="NASDAQ, BYMA..." /><datalist id="sl-markets"><option value="NASDAQ" /><option value="NYSE" /><option value="BYMA" /><option value="Forex" /><option value="CME" /><option value="Crypto" /></datalist></div>
            <div class="sl-field"><span class="sl-label">Tipo de instrumento</span><select v-model="f.instrumentType" class="sl-select"><option v-for="t in INSTRUMENT_TYPES" :key="t" :value="t">{{ MARKET_LABELS[t] }}</option></select></div>
            <div class="sl-field"><span class="sl-label">Fecha de entrada *</span><input v-model="f.entryDate" type="date" class="sl-input" /></div>
            <div class="sl-field"><span class="sl-label">Hora de entrada</span><input v-model="f.entryTime" type="time" class="sl-input" /></div>
            <div class="sl-field"><span class="sl-label">Temporalidad *</span>
              <select v-if="version?.timeframes.length" v-model="f.timeframe" class="sl-select"><option value="">—</option><option v-for="t in version.timeframes" :key="t" :value="t">{{ t }}</option></select>
              <input v-else v-model="f.timeframe" class="sl-input" placeholder="15m, 1H, 1D..." /></div>
            <div class="sl-field"><span class="sl-label">Dirección *</span>
              <div class="sl-seg"><button type="button" :class="{ active: f.direction === 'LONG' }" :disabled="directionLocked && version.directionMode !== 'LONG'" @click="f.direction = 'LONG'">LONG</button><button type="button" :class="{ active: f.direction === 'SHORT' }" :disabled="directionLocked && version.directionMode !== 'SHORT'" @click="f.direction = 'SHORT'">SHORT</button></div></div>
          </div>
        </div>
      </div>

      <!-- 2. Entrada -->
      <div class="sl-panel">
        <div class="sl-panel-head"><span class="sl-panel-title">2 · Datos de entrada</span></div>
        <div class="sl-panel-body" style="display: flex; flex-direction: column; gap: 12px">
          <div class="sl-cols">
            <div class="sl-field"><span class="sl-label">Precio de entrada *</span><input v-model="f.entryPrice" type="number" step="any" class="sl-input num" /></div>
            <div class="sl-field"><span class="sl-label">Stop loss</span><input v-model="f.stopLoss" type="number" step="any" class="sl-input num" /></div>
            <div class="sl-field"><span class="sl-label">Take profit</span><input v-model="f.takeProfit" type="number" step="any" class="sl-input num" /></div>
            <div class="sl-field"><span class="sl-label">Cantidad de unidades</span><input v-model="f.quantity" type="number" step="any" min="0" class="sl-input num" /></div>
            <div class="sl-field"><span class="sl-label">Riesgo monetario</span><input v-model="f.riskAmount" type="number" step="any" min="0" class="sl-input num" placeholder="solo si no hay stop" /></div>
            <div class="sl-field"><span class="sl-label">Riesgo % del capital</span><input v-model="f.riskPercent" type="number" step="any" min="0" max="100" class="sl-input num" /></div>
            <div class="sl-field"><span class="sl-label">Comisiones</span><input v-model="f.fees" type="number" step="any" min="0" class="sl-input num" /></div>
            <div class="sl-field"><span class="sl-label">Moneda</span><input v-model="f.currency" class="sl-input" list="sl-cur" placeholder="USD, ARS" /><datalist id="sl-cur"><option value="USD" /><option value="ARS" /></datalist></div>
          </div>
          <div class="dim" style="display: flex; gap: 18px; flex-wrap: wrap">
            <span>Riesgo por unidad: <b class="neu">{{ riskPerUnit === null ? '—' : fmtNum(riskPerUnit, 4) }}</b></span>
            <span>Riesgo total: <b class="neu">{{ calc.riskMoney === null ? '—' : fmtNum(calc.riskMoney) }}</b></span>
            <span>R:R planeado: <b :class="rrBelowTarget ? 'neg' : 'neu'">{{ calc.plannedRR === null ? '—' : fmtNum(calc.plannedRR) }}</b><template v-if="version?.targetRr"> (objetivo {{ version.targetRr }})</template></span>
          </div>
          <div v-if="rrBelowTarget" class="sl-note warn">El R:R planeado es menor al objetivo de la estrategia ({{ version.targetRr }}). Se puede registrar igual, pero queda constancia.</div>
        </div>
      </div>

      <!-- 3. Reglas -->
      <div class="sl-panel">
        <div class="sl-panel-head">
          <span class="sl-panel-title">3 · Validación de reglas {{ version ? `(v${version.versionNumber})` : '' }}</span>
          <span style="display: flex; gap: 8px; align-items: center">
            <span class="dim">Cumplimiento: <b :class="compliance.pct === null ? 'dim' : compliance.pct === 100 ? 'pos' : compliance.pct === 0 ? 'neg' : 'neu'">{{ compliance.pct === null ? '—' : compliance.pct.toFixed(0) + '%' }}</b>
              <template v-if="compliance.requiredPct !== null"> · obligatorias {{ compliance.requiredPct.toFixed(0) }}%</template></span>
            <button v-if="enabledConds.length" type="button" class="sl-btn sm" @click="setAll('MET')">Todas cumplidas</button>
            <button v-if="enabledConds.length" type="button" class="sl-btn sm ghost" @click="setAll(undefined)">Limpiar</button>
          </span>
        </div>
        <div class="sl-panel-body">
          <div v-if="!enabledConds.length" class="dim">Esta versión no tiene condiciones activas, así que el cumplimiento queda sin datos.</div>
          <div v-for="c in enabledConds" :key="c.id" style="display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 7px 0; border-bottom: 1px solid var(--border)">
            <div style="min-width: 0"><span class="sl-badge" style="margin-right: 8px">{{ kindLabel[c.kind] }}</span>{{ c.label }}<span v-if="!c.required" class="dim"> · opcional</span></div>
            <div class="sl-seg">
              <button type="button" class="met" :class="{ active: results[c.id] === 'MET' }" @click="results[c.id] = 'MET'">Cumplida</button>
              <button type="button" class="notmet" :class="{ active: results[c.id] === 'NOT_MET' }" @click="results[c.id] = 'NOT_MET'">No cumplida</button>
              <button type="button" class="na" :class="{ active: results[c.id] === 'NA' }" @click="results[c.id] = 'NA'">No aplica</button>
            </div>
          </div>
        </div>
      </div>

      <!-- 4. Salida -->
      <div class="sl-panel">
        <div class="sl-panel-head"><span class="sl-panel-title">4 · Datos de salida (vacío = operación pendiente)</span>
          <span v-if="calc.status === 'CLOSED'" class="sl-badge" :class="calc.outcome === 'WIN' ? 'win' : calc.outcome === 'LOSS' ? 'loss' : ''">{{ OUTCOME_LABELS[calc.outcome] }}</span>
          <span v-else class="sl-badge warn">Pendiente — no cuenta como ganadora ni perdedora</span></div>
        <div class="sl-panel-body" style="display: flex; flex-direction: column; gap: 12px">
          <div class="sl-cols">
            <div class="sl-field"><span class="sl-label">Fecha de salida</span><input v-model="f.exitDate" type="date" class="sl-input" /></div>
            <div class="sl-field"><span class="sl-label">Hora de salida</span><input v-model="f.exitTime" type="time" class="sl-input" /></div>
            <div class="sl-field"><span class="sl-label">Precio de salida</span><input v-model="f.exitPrice" type="number" step="any" class="sl-input num" /></div>
          </div>
          <div v-if="calc.status === 'CLOSED'" style="display: flex; gap: 22px; flex-wrap: wrap; font-family: var(--font-num)">
            <span>Resultado %: <b :class="tone(calc.resultPct)">{{ fmtValue(calc.resultPct, 'PCT') }}</b></span>
            <span>Resultado $: <b :class="tone(calc.resultAmount)">{{ calc.resultAmount === null ? '— (falta cantidad)' : fmtValue(calc.resultAmount, 'AMOUNT') }}</b></span>
            <span>Resultado R: <b :class="tone(calc.resultR)">{{ calc.resultR === null ? '— (falta stop o riesgo)' : fmtValue(calc.resultR, 'R') }}</b><span v-if="calc.rBasis === 'GROSS'" class="dim"> (bruto, sin comisiones)</span></span>
          </div>
        </div>
      </div>

      <!-- 5. Observaciones -->
      <div class="sl-panel">
        <div class="sl-panel-head"><span class="sl-panel-title">5 · Observaciones y links de TradingView</span></div>
        <div class="sl-panel-body" style="display: flex; flex-direction: column; gap: 12px">
          <textarea v-model="f.notes" class="sl-textarea" rows="3" placeholder="Contexto, qué viste, errores, dudas..." />
          <div class="sl-field">
            <span class="sl-label">Links de TradingView (no se guarda ninguna imagen, solo el link)</span>
            <div style="display: flex; gap: 8px">
              <input v-model="linkInput" class="sl-input" placeholder="https://www.tradingview.com/x/..." @keydown.enter.prevent="addLinks" />
              <button type="button" class="sl-btn" @click="addLinks">Agregar link</button>
            </div>
            <span v-if="linkError" class="neg" style="font-size: 12px">{{ linkError }}</span>
            <span v-else class="dim" style="font-size: 12px">Podés pegar varios a la vez. No hay límite de links por operación.</span>
          </div>
          <div v-if="pendingLinks.length || existing.length" class="sl-list" style="border: 1px solid var(--border); border-radius: 4px">
            <div v-for="a in existing" :key="'e' + a.id" style="display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 6px 10px; border-bottom: 1px solid var(--border)">
              <a v-if="a.kind === 'link'" :href="a.url" target="_blank" rel="noopener noreferrer" class="info" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap">{{ shortLink(a.url) }}</a>
              <span v-else class="dim">Captura guardada anteriormente (imagen)</span>
              <button type="button" class="sl-btn sm danger" @click="removeExisting(a)">Quitar</button>
            </div>
            <div v-for="(u, i) in pendingLinks" :key="'p' + i" style="display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 6px 10px; border-bottom: 1px solid var(--border)">
              <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap">{{ shortLink(u) }} <span class="sl-badge warn">sin guardar</span></span>
              <button type="button" class="sl-btn sm danger" @click="pendingLinks.splice(i, 1)">Quitar</button>
            </div>
          </div>
        </div>
      </div>

      <div v-if="attempted && liveErrors.length" class="sl-error"><div v-for="e in liveErrors" :key="e">• {{ e }}</div></div>
      <div v-else-if="liveErrors.length" class="sl-note warn">Pendiente para poder guardar: {{ liveErrors.join(' · ') }}</div>
      <div style="display: flex; justify-content: flex-end; gap: 8px">
        <button v-if="isEdit" type="button" class="sl-btn" :disabled="saving" @click="emit('cancel')">Cancelar</button>
        <button v-if="!isEdit" type="button" class="sl-btn" :disabled="saving" @click="save(true)">Guardar y cargar otra</button>
        <button type="button" class="sl-btn primary" :disabled="saving" @click="save(false)">{{ saving ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Guardar operación' }}</button>
      </div>
    </template>
  </div>
</template>
