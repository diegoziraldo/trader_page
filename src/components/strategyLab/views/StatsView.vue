<script setup>
import { ref, computed } from 'vue'
import { useStrategyLab } from '../../../composables/useStrategyLab.js'
import { computeMetrics, equityCurve, groupMetrics, keyBy, conditionEffectiveness, WEEKDAY_LABELS, DURATION_BUCKETS, COMPLIANCE_LABELS, COMPLIANCE_ORDER, BASIS_LABELS } from '../../../services/strategyLab/stats.js'
import { fmtValue, fmtPF, fmtPct, tone, toneForPF } from '../../../services/strategyLab/format.js'
import { COLORS, signColors } from '../chartTheme.js'
import MetricGrid from '../MetricGrid.vue'
import ChartCanvas from '../ChartCanvas.vue'
import BreakdownTable from '../BreakdownTable.vue'
import SampleBadge from '../SampleBadge.vue'

const { strategies, scopedTrades, filters, symbols } = useStrategyLab()
const strategyId = ref('')
const symbol = ref('')
const dim = ref('weekday')
const basis = computed(() => filters.basis)

const data = computed(() => scopedTrades.value.filter((t) => (!strategyId.value || t.strategyId === Number(strategyId.value)) && (!symbol.value || t.symbol === symbol.value)))
const m = computed(() => computeMetrics(data.value, basis.value))
const b = (v, o) => fmtValue(v, basis.value, o)

const items = computed(() => {
  const x = m.value
  return [
    { label: 'Total de operaciones', value: String(x.n), sub: `${x.pending} pendientes${x.excluded ? ` · ${x.excluded} sin valor en la base` : ''}` },
    { label: 'Ganadoras', value: String(x.wins), tone: 'pos' }, { label: 'Perdedoras', value: String(x.losses), tone: 'neg' }, { label: 'Breakeven', value: String(x.be) },
    { label: 'Win rate', value: fmtPct(x.winRate), sub: x.winRateCI ? `IC 95%: ${x.winRateCI.low.toFixed(0)}–${x.winRateCI.high.toFixed(0)}%` : '' },
    { label: 'Profit factor', value: fmtPF(x.profitFactor), tone: toneForPF(x.profitFactor) },
    { label: 'Ganancia promedio', value: b(x.avgWin), tone: 'pos' }, { label: 'Pérdida promedio', value: b(x.avgLoss), tone: 'neg' },
    { label: 'Expectativa matemática', value: b(x.expectancy), tone: tone(x.expectancy), sub: x.tStat !== null ? `t = ${x.tStat.toFixed(2)}` : '' },
    { label: 'R promedio', value: fmtValue(x.avgR, 'R'), tone: tone(x.avgR), sub: `${x.nWithR} ops con R` },
    { label: 'Drawdown máximo', value: x.maxDrawdown ? b(x.maxDrawdown, { plus: false }) : '—', tone: x.maxDrawdown ? 'neg' : 'neu' },
    { label: 'Racha máx. de ganancias', value: String(x.maxWinStreak), tone: 'pos' }, { label: 'Racha máx. de pérdidas', value: String(x.maxLossStreak), tone: 'neg' },
    { label: 'Ganancia acumulada', value: b(x.grossProfit), tone: 'pos' }, { label: 'Pérdida acumulada', value: b(x.grossLoss), tone: 'neg' },
  ]
})
const eq = computed(() => equityCurve(data.value, basis.value))
const eqData = computed(() => ({ labels: eq.value.map((p) => p.date), datasets: [{ data: eq.value.map((p) => p.cumulative), borderColor: COLORS.blue, borderWidth: 1.5, pointRadius: eq.value.length > 80 ? 0 : 2, tension: 0 }] }))

const byAsset = computed(() => groupMetrics(data.value, keyBy.symbol, basis.value))

const DIMS = {
  weekday: { label: 'Día de la semana', header: 'Día', key: keyBy.weekday, labelFn: (k) => WEEKDAY_LABELS[k], sortFn: (a, c) => ((a.key + 6) % 7) - ((c.key + 6) % 7) },
  hour: { label: 'Horario de entrada', header: 'Hora', key: keyBy.hour, labelFn: (k) => `${String(k).padStart(2, '0')}:00 – ${String(k).padStart(2, '0')}:59`, sortFn: (a, c) => a.key - c.key },
  month: { label: 'Mes', header: 'Mes', key: keyBy.entryMonth, sortFn: (a, c) => a.key.localeCompare(c.key) },
  year: { label: 'Año', header: 'Año', key: keyBy.entryYear, sortFn: (a, c) => a.key - c.key },
  timeframe: { label: 'Temporalidad', header: 'Temporalidad', key: keyBy.timeframe },
  duration: { label: 'Duración', header: 'Duración', key: keyBy.duration, sortFn: (a, c) => DURATION_BUCKETS.indexOf(a.key) - DURATION_BUCKETS.indexOf(c.key) },
  direction: { label: 'Dirección', header: 'Dirección', key: keyBy.direction },
}
const dimResult = computed(() => { const d = DIMS[dim.value]; return groupMetrics(data.value, d.key, basis.value, { labelFn: d.labelFn, sortFn: d.sortFn }) })
const dimChart = computed(() => ({ labels: dimResult.value.rows.map((r) => `${r.label} (n=${r.metrics.n})`), datasets: [{ data: dimResult.value.rows.map((r) => r.metrics.expectancy), backgroundColor: signColors(dimResult.value.rows.map((r) => r.metrics.expectancy)) }] }))

const comp = computed(() => groupMetrics(data.value, keyBy.compliance, basis.value, { labelFn: (k) => COMPLIANCE_LABELS[k], sortFn: (a, c) => COMPLIANCE_ORDER.indexOf(a.key) - COMPLIANCE_ORDER.indexOf(c.key) }))
const conds = computed(() => conditionEffectiveness(data.value, basis.value))
</script>

<template>
  <div class="sl-wrap">
    <div class="sl-panel">
      <div class="sl-panel-body sl-cols">
        <div class="sl-field"><span class="sl-label">Estrategia</span><select v-model="strategyId" class="sl-select"><option value="">Todas</option><option v-for="s in strategies" :key="s.id" :value="s.id">{{ s.name }}</option></select></div>
        <div class="sl-field"><span class="sl-label">Activo</span><select v-model="symbol" class="sl-select"><option value="">Todos</option><option v-for="s in symbols" :key="s" :value="s">{{ s }}</option></select></div>
        <div class="dim" style="align-self: end">Base: {{ BASIS_LABELS[basis] }}</div>
      </div>
    </div>

    <div v-if="!m.n" class="sl-panel"><div class="sl-empty">No hay operaciones cerradas con estos filtros.</div></div>
    <template v-else>
      <div class="sl-panel"><div class="sl-panel-head"><span class="sl-panel-title">Métricas</span><SampleBadge :n="m.n" /></div><MetricGrid :items="items" /></div>
      <div class="sl-panel"><div class="sl-panel-head"><span class="sl-panel-title">Curva de rendimiento acumulado</span></div><div class="sl-panel-body"><ChartCanvas type="line" :data="eqData" /></div></div>

      <div class="sl-panel">
        <div class="sl-panel-head"><span class="sl-panel-title">Análisis por activo</span><span class="dim">{{ strategyId ? 'de la estrategia elegida' : 'de todas las estrategias' }}</span></div>
        <BreakdownTable :rows="byAsset.rows" label-header="Activo" :basis="basis" sectioned :unclassified="byAsset.unclassified" />
      </div>

      <div class="sl-panel">
        <div class="sl-panel-head">
          <span class="sl-panel-title">Análisis temporal</span>
          <div class="sl-seg"><button v-for="(d, k) in DIMS" :key="k" :class="{ active: dim === k }" @click="dim = k">{{ d.label }}</button></div>
        </div>
        <div class="sl-panel-body" v-if="dimResult.rows.length"><ChartCanvas :data="dimChart" :height="220" /></div>
        <BreakdownTable :rows="dimResult.rows" :label-header="DIMS[dim].header" :basis="basis" :unclassified="dimResult.unclassified" />
        <div v-if="dim === 'hour' || dim === 'duration'" class="sl-note" style="margin: 10px 14px">Este análisis solo incluye operaciones con hora de entrada{{ dim === 'duration' ? ' y salida' : '' }} cargada.</div>
      </div>

      <div class="sl-panel">
        <div class="sl-panel-head"><span class="sl-panel-title">Análisis por cumplimiento de reglas</span></div>
        <BreakdownTable :rows="comp.rows" label-header="Cumplimiento" :basis="basis" :unclassified="comp.unclassified" />
        <div class="sl-panel-head" style="border-top: 1px solid var(--border)"><span class="sl-panel-title">Efectividad de cada condición (cumplida vs. no cumplida)</span></div>
        <div v-if="!conds.length" class="sl-empty">Sin condiciones evaluadas todavía.</div>
        <div v-else class="sl-scroll">
          <table class="sl-table">
            <thead><tr><th>Condición</th><th class="num">Ops cumplida</th><th class="num">Expectativa si se cumple</th><th class="num">Ops no cumplida</th><th class="num">Expectativa si no</th><th class="num">Diferencia</th><th>Muestra (mín.)</th></tr></thead>
            <tbody><tr v-for="c in conds" :key="c.key">
              <td>{{ c.label }}</td><td class="num">{{ c.met.n }}</td><td class="num" :class="tone(c.met.expectancy)">{{ fmtValue(c.met.expectancy, basis) }}</td>
              <td class="num">{{ c.notMet.n }}</td><td class="num" :class="tone(c.notMet.expectancy)">{{ fmtValue(c.notMet.expectancy, basis) }}</td>
              <td class="num" :class="tone(c.delta)">{{ fmtValue(c.delta, basis) }}</td><td><SampleBadge :n="Math.min(c.met.n, c.notMet.n)" /></td>
            </tr></tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>
