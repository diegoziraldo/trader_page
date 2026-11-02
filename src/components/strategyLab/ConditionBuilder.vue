<script setup>
// Constructor de reglas. No limita a una lista de indicadores: `label` es
// texto libre y `indicator` / `operator` / `params` son opcionales. Las
// listas de sugerencias (datalist) son solo ayuda para tipear más rápido.
import { CONDITION_KINDS } from '../../services/strategyLab/tradeMath.js'

const props = defineProps({
  modelValue: { type: Array, required: true },
  readonly: { type: Boolean, default: false },
  indicatorHints: { type: Array, default: () => [] },
})
const emit = defineEmits(['update:modelValue'])

const KIND_LABELS = { ENTRY: 'Reglas de entrada', EXIT: 'Reglas de salida', FILTER: 'Filtros / confirmaciones' }
const OPERATOR_HINTS = ['>', '<', '>=', '<=', '=', 'entre', 'cruza al alza', 'cruza a la baja', 'cierra por encima', 'cierra por debajo', 'pendiente alcista', 'pendiente bajista']
const INDICATOR_HINTS = ['Precio', 'HMA', 'EMA', 'SMA', 'VWAP', 'RSI', 'MACD', 'Estocástico', 'ATR', 'Bandas de Bollinger', 'ADX', 'Volumen', 'Soporte/Resistencia', 'Patrón de velas']

const newKey = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `k${Date.now()}${Math.random().toString(16).slice(2)}`)

// "periodo=50, min=50" <-> { periodo: 50, min: 50 }
function paramsToText(p) { return Object.entries(p || {}).map(([k, v]) => `${k}=${v}`).join(', ') }
function textToParams(t) {
  const out = {}
  for (const part of String(t || '').split(',')) {
    const i = part.indexOf('=')
    if (i < 1) continue
    const k = part.slice(0, i).trim()
    const raw = part.slice(i + 1).trim()
    if (!k) continue
    out[k] = raw !== '' && Number.isFinite(Number(raw)) ? Number(raw) : raw
  }
  return out
}

function emitList(list) { emit('update:modelValue', list.map((c, i) => ({ ...c, position: i }))) }
function patch(key, changes) { emitList(props.modelValue.map((c) => (c.key === key ? { ...c, ...changes } : c))) }
function add(kind) {
  emitList([...props.modelValue, { key: newKey(), kind, label: '', indicator: '', operator: '', params: {}, required: kind !== 'FILTER', enabled: true }])
}
function remove(key) { emitList(props.modelValue.filter((c) => c.key !== key)) }
function move(key, dir) {
  const list = [...props.modelValue]
  const i = list.findIndex((c) => c.key === key)
  const kind = list[i].kind
  let j = i + dir
  while (j >= 0 && j < list.length && list[j].kind !== kind) j += dir
  if (j < 0 || j >= list.length) return
  ;[list[i], list[j]] = [list[j], list[i]]
  emitList(list)
}
const ofKind = (kind) => props.modelValue.filter((c) => c.kind === kind)
</script>

<template>
  <div style="display: flex; flex-direction: column; gap: 18px">
    <datalist id="sl-indicator-hints"><option v-for="h in [...new Set([...indicatorHints, ...INDICATOR_HINTS])]" :key="h" :value="h" /></datalist>
    <datalist id="sl-operator-hints"><option v-for="h in OPERATOR_HINTS" :key="h" :value="h" /></datalist>

    <div v-for="kind in CONDITION_KINDS" :key="kind">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px">
        <span class="sl-panel-title">{{ KIND_LABELS[kind] }}</span>
        <button v-if="!readonly" class="sl-btn sm" @click="add(kind)">+ Agregar condición</button>
      </div>
      <div v-if="!ofKind(kind).length" class="dim" style="padding: 6px 0">Sin condiciones.</div>
      <div v-for="c in ofKind(kind)" :key="c.key" class="sl-cond-row" :class="{ off: !c.enabled }">
        <label class="sl-check" title="Activa: se evalúa en cada operación. Desactivada: se conserva pero no se pide ni cuenta."><input type="checkbox" :checked="c.enabled" :disabled="readonly" @change="patch(c.key, { enabled: $event.target.checked })" /> Activa</label>
        <label class="sl-check" title="Obligatoria u opcional (se refleja en el cumplimiento de reglas obligatorias)"><input type="checkbox" :checked="c.required" :disabled="readonly" @change="patch(c.key, { required: $event.target.checked })" /> Oblig.</label>
        <input class="sl-input" :value="c.label" :disabled="readonly" placeholder="Ej: Precio cierra por encima de HMA 50" @input="patch(c.key, { label: $event.target.value })" />
        <input class="sl-input" :value="c.indicator" :disabled="readonly" list="sl-indicator-hints" placeholder="Indicador" @input="patch(c.key, { indicator: $event.target.value })" />
        <input class="sl-input" :value="c.operator" :disabled="readonly" list="sl-operator-hints" placeholder="Operador" @input="patch(c.key, { operator: $event.target.value })" />
        <input class="sl-input num" :value="paramsToText(c.params)" :disabled="readonly" placeholder="parámetros: periodo=50, min=50" @change="patch(c.key, { params: textToParams($event.target.value) })" />
        <span v-if="!readonly" style="display: flex; gap: 2px">
          <button class="sl-btn sm ghost" title="Subir" @click="move(c.key, -1)">↑</button>
          <button class="sl-btn sm ghost" title="Bajar" @click="move(c.key, 1)">↓</button>
          <button class="sl-btn sm ghost" title="Eliminar" @click="remove(c.key)">✕</button>
        </span>
      </div>
    </div>
  </div>
</template>
