<script setup>
// Tabla genérica de métricas por grupo (activo, día, hora, temporalidad...).
// Muestra SIEMPRE el tamaño de muestra y, con `sectioned`, separa las filas
// por confiabilidad para no presentar casualidades como conclusiones.
import { ref, computed } from 'vue'
import SampleBadge from './SampleBadge.vue'
import { classifyRows } from '../../services/strategyLab/stats.js'
import { fmtValue, fmtPF, fmtPct, tone, toneForPF } from '../../services/strategyLab/format.js'

const props = defineProps({
  rows: { type: Array, required: true },       // [{ key, label, metrics }]
  labelHeader: { type: String, default: 'Grupo' },
  basis: { type: String, default: 'R' },
  sectioned: { type: Boolean, default: false },
  keepOrder: { type: Boolean, default: false }, // respeta el orden recibido (días, horas...)
  unclassified: { type: Number, default: 0 },
})

const sortKey = ref(null)
const sortDir = ref(-1)
const COLS = [
  { k: 'n', label: 'Ops', get: (m) => m.n },
  { k: 'wlb', label: 'G / P / BE', get: null },
  { k: 'winRate', label: 'Win rate', get: (m) => m.winRate },
  { k: 'profitFactor', label: 'Profit factor', get: (m) => m.profitFactor },
  { k: 'expectancy', label: 'Expectativa', get: (m) => m.expectancy },
  { k: 'net', label: 'Neto', get: (m) => m.net },
  { k: 'maxDrawdown', label: 'Drawdown', get: (m) => m.maxDrawdown },
]
function setSort(k) {
  if (k === 'wlb') return
  if (sortKey.value === k) sortDir.value *= -1
  else { sortKey.value = k; sortDir.value = -1 }
}
function sorted(list) {
  if (!sortKey.value) return list
  const col = COLS.find((c) => c.k === sortKey.value)
  return [...list].sort((a, b) => {
    const va = col.get(a.metrics) ?? -Infinity
    const vb = col.get(b.metrics) ?? -Infinity
    return (va === vb ? 0 : va > vb ? 1 : -1) * sortDir.value
  })
}
const sections = computed(() => {
  if (!props.sectioned) return [{ title: null, rows: sorted(props.rows) }]
  const c = classifyRows(props.rows)
  return [
    { title: 'Muestra confiable (30 o más operaciones)', rows: sorted(c.reliable) },
    { title: 'Orientativo (10 a 29 operaciones)', rows: sorted(c.indicative) },
    { title: 'Muestra insuficiente (menos de 10) — no sacar conclusiones', rows: sorted(c.insufficient), dim: true },
  ].filter((s) => s.rows.length)
})
const ciText = (m) => (m.winRateCI ? `IC 95%: ${m.winRateCI.low.toFixed(0)}% – ${m.winRateCI.high.toFixed(0)}%` : '')
</script>

<template>
  <div v-if="!rows.length" class="sl-empty">Sin operaciones cerradas para este análisis.</div>
  <div v-else class="sl-scroll">
    <table class="sl-table">
      <thead>
        <tr>
          <th>{{ labelHeader }}</th>
          <th v-for="c in COLS" :key="c.k" :class="[c.k === 'wlb' ? '' : 'sortable', 'num']" @click="setSort(c.k)">
            {{ c.label }}<span v-if="sortKey === c.k">{{ sortDir > 0 ? ' ▲' : ' ▼' }}</span>
          </th>
          <th>Muestra</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="(s, i) in sections" :key="i">
          <tr v-if="s.title" class="sl-subhead"><td :colspan="COLS.length + 2">{{ s.title }}</td></tr>
          <tr v-for="r in s.rows" :key="r.key" :class="{ dimmed: s.dim }">
            <td>{{ r.label }}</td>
            <td class="num">{{ r.metrics.n }}</td>
            <td class="num dim">{{ r.metrics.wins }} / {{ r.metrics.losses }} / {{ r.metrics.be }}</td>
            <td class="num" :title="ciText(r.metrics)">{{ fmtPct(r.metrics.winRate, 0) }}</td>
            <td class="num" :class="toneForPF(r.metrics.profitFactor)">{{ fmtPF(r.metrics.profitFactor) }}</td>
            <td class="num" :class="tone(r.metrics.expectancy)">{{ fmtValue(r.metrics.expectancy, basis) }}</td>
            <td class="num" :class="tone(r.metrics.net)">{{ fmtValue(r.metrics.net, basis) }}</td>
            <td class="num dim">{{ r.metrics.maxDrawdown ? fmtValue(r.metrics.maxDrawdown, basis, { plus: false }) : '—' }}</td>
            <td><SampleBadge :n="r.metrics.n" /></td>
          </tr>
        </template>
      </tbody>
    </table>
    <div v-if="unclassified" class="sl-kpi-sub" style="padding: 6px 10px">
      {{ unclassified }} operación(es) cerradas no se pudieron clasificar acá por falta del dato (por ejemplo, sin hora de entrada).
    </div>
  </div>
</template>
