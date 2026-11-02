<script setup>
import { ref, computed, watch } from 'vue'
import { useStrategyLab } from '../../../composables/useStrategyLab.js'
import { computeMetrics, alignedEquity, monthlyReturns, groupMetrics, keyBy } from '../../../services/strategyLab/stats.js'
import { fmtValue, fmtPF, fmtPct, tone } from '../../../services/strategyLab/format.js'
import { COLORS } from '../chartTheme.js'
import ChartCanvas from '../ChartCanvas.vue'
import SampleBadge from '../SampleBadge.vue'

const { strategies, scopedTrades, filters, symbols } = useStrategyLab()
const selected = ref([])
const symbol = ref('')
const axis = ref('TRADES')
const basis = computed(() => filters.basis)
const withTrades = computed(() => strategies.value.filter((s) => scopedTrades.value.some((t) => t.strategyId === s.id)))
watch(withTrades, (list) => { if (!selected.value.length && list.length >= 2) selected.value = list.slice(0, 2).map((s) => s.id) }, { immediate: true })
const toggle = (id) => { selected.value = selected.value.includes(id) ? selected.value.filter((x) => x !== id) : [...selected.value, id] }

const groups = computed(() => selected.value.map((id) => {
  const s = strategies.value.find((x) => x.id === id)
  return { id, label: s?.name ?? `#${id}`, trades: scopedTrades.value.filter((t) => t.strategyId === id && (!symbol.value || t.symbol === symbol.value)) }
}))
const metrics = computed(() => groups.value.map((g) => ({ ...g, m: computeMetrics(g.trades, basis.value) })))

// [etiqueta, getter, "mejor" = max | min | null, formatter, tone]
const ROWS = [
  ['Operaciones', (m) => m.n, 'max', (v) => String(v)],
  ['Win rate', (m) => m.winRate, 'max', (v) => fmtPct(v, 1)],
  ['Profit factor', (m) => m.profitFactor, 'max', fmtPF],
  ['Expectativa matemática', (m) => m.expectancy, 'max', (v) => fmtValue(v, basis.value), true],
  ['R promedio', (m) => m.avgR, 'max', (v) => fmtValue(v, 'R'), true],
  ['Drawdown máximo', (m) => m.maxDrawdown, 'min', (v) => (v ? fmtValue(v, basis.value, { plus: false }) : '—')],
  ['Rendimiento acumulado', (m) => m.net, 'max', (v) => fmtValue(v, basis.value), true],
]
function bestIdx(getter, mode) {
  if (!mode || metrics.value.length < 2) return -1
  let best = -1, bv = null
  metrics.value.forEach((x, i) => {
    const v = getter(x.m)
    if (v === null || v === undefined || x.m.n === 0) return
    if (bv === null || (mode === 'max' ? v > bv : v < bv)) { bv = v; best = i }
  })
  return best
}

const eqData = computed(() => {
  const a = alignedEquity(groups.value, basis.value, axis.value)
  return { labels: a.labels, datasets: a.datasets.map((d, i) => ({ ...d, borderColor: COLORS.palette[i % 8], borderWidth: 1.6, pointRadius: 0, tension: 0, spanGaps: false })) }
})
const eqOpts = { plugins: { legend: { display: true, position: 'bottom' } } }
const monthData = computed(() => {
  const per = groups.value.map((g) => new Map(monthlyReturns(g.trades, basis.value).map((r) => [r.month, r.value])))
  const months = [...new Set(per.flatMap((p) => [...p.keys()]))].sort()
  return { labels: months, datasets: groups.value.map((g, i) => ({ label: g.label, data: months.map((mo) => per[i].get(mo) ?? null), backgroundColor: COLORS.palette[i % 8] })) }
})
const assetRows = computed(() => {
  const per = groups.value.map((g) => new Map(groupMetrics(g.trades, keyBy.symbol, basis.value).rows.map((r) => [r.key, r.metrics])))
  const all = [...new Set(per.flatMap((p) => [...p.keys()]))].sort()
  return all.map((sym) => ({ sym, cells: per.map((p) => p.get(sym) || null) }))
})
const assetChart = computed(() => ({
  labels: assetRows.value.map((r) => r.sym),
  datasets: groups.value.map((g, i) => ({ label: g.label, data: assetRows.value.map((r) => r.cells[i]?.expectancy ?? null), backgroundColor: COLORS.palette[i % 8] })),
}))
</script>

<template>
  <div class="sl-wrap">
    <div class="sl-panel">
      <div class="sl-panel-head"><span class="sl-panel-title">Estrategias a comparar (elegí 2 o más)</span></div>
      <div class="sl-panel-body" style="display: flex; flex-direction: column; gap: 12px">
        <div v-if="withTrades.length < 2" class="sl-note warn">Necesitás al menos 2 estrategias con operaciones en el período/tipo filtrado para comparar.</div>
        <div class="sl-chips"><label v-for="s in withTrades" :key="s.id" class="sl-chip" style="padding: 4px 10px; cursor: pointer"><input type="checkbox" :checked="selected.includes(s.id)" @change="toggle(s.id)" /> {{ s.name }}</label></div>
        <div class="sl-cols">
          <div class="sl-field"><span class="sl-label">Filtrar por activo</span><select v-model="symbol" class="sl-select"><option value="">Todos</option><option v-for="s in symbols" :key="s" :value="s">{{ s }}</option></select></div>
          <div class="sl-field"><span class="sl-label">Eje de la curva</span><div class="sl-seg"><button :class="{ active: axis === 'TRADES' }" @click="axis = 'TRADES'">Por operación</button><button :class="{ active: axis === 'DATE' }" @click="axis = 'DATE'">Por fecha</button></div></div>
        </div>
      </div>
    </div>

    <template v-if="selected.length >= 2">
      <div class="sl-panel">
        <div class="sl-panel-head"><span class="sl-panel-title">Comparación de métricas</span></div>
        <div class="sl-scroll"><table class="sl-table">
          <thead><tr><th>Métrica</th><th v-for="x in metrics" :key="x.id" class="num">{{ x.label }}</th></tr></thead>
          <tbody>
            <tr v-for="[label, getter, mode, fmt, colored] in ROWS" :key="label">
              <td class="dim">{{ label }}</td>
              <td v-for="(x, i) in metrics" :key="x.id" class="num" :class="[colored ? tone(getter(x.m)) : '']" :style="i === bestIdx(getter, mode) ? 'font-weight:700;text-decoration:underline' : ''">{{ fmt(getter(x.m)) }}</td>
            </tr>
            <tr><td class="dim">Muestra</td><td v-for="x in metrics" :key="x.id" class="num"><SampleBadge :n="x.m.n" /></td></tr>
          </tbody>
        </table></div>
        <div class="sl-note" style="margin: 10px 14px">Subrayado = mejor valor de la fila. Con muestras chicas la diferencia puede ser casualidad: mirá siempre el tamaño de muestra.</div>
      </div>

      <div class="sl-grid-2">
        <div class="sl-panel"><div class="sl-panel-head"><span class="sl-panel-title">Rendimiento acumulado</span></div><div class="sl-panel-body"><ChartCanvas type="line" :data="eqData" :options="eqOpts" /></div></div>
        <div class="sl-panel"><div class="sl-panel-head"><span class="sl-panel-title">Rendimiento mensual (mes de cierre)</span></div><div class="sl-panel-body"><ChartCanvas :data="monthData" :options="eqOpts" /></div></div>
      </div>

      <div class="sl-panel">
        <div class="sl-panel-head"><span class="sl-panel-title">Resultados por activo (expectativa · n)</span></div>
        <div v-if="!assetRows.length" class="sl-empty">Sin operaciones cerradas.</div>
        <template v-else>
          <div class="sl-panel-body"><ChartCanvas :data="assetChart" :options="eqOpts" :height="240" /></div>
          <div class="sl-scroll"><table class="sl-table">
            <thead><tr><th>Activo</th><th v-for="x in metrics" :key="x.id" class="num">{{ x.label }}</th></tr></thead>
            <tbody><tr v-for="r in assetRows" :key="r.sym"><td><b>{{ r.sym }}</b></td>
              <td v-for="(c, i) in r.cells" :key="i" class="num"><template v-if="c"><span :class="tone(c.expectancy)">{{ fmtValue(c.expectancy, basis) }}</span> <span class="dim">· {{ fmtPct(c.winRate, 0) }} · n={{ c.n }}</span></template><span v-else class="dim">—</span></td></tr></tbody>
          </table></div>
        </template>
      </div>
    </template>
  </div>
</template>
