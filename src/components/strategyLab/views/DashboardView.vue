<script setup>
import { computed } from 'vue'
import { useStrategyLab } from '../../../composables/useStrategyLab.js'
import { computeMetrics, equityCurve, monthlyReturns, groupMetrics, keyBy, bestPerformers, applyFilters, MIN_SAMPLE_INDICATIVE } from '../../../services/strategyLab/stats.js'
import { fmtValue, fmtPF, fmtPct, fmtNum, tone, toneForPF } from '../../../services/strategyLab/format.js'
import { COLORS, signColors } from '../chartTheme.js'
import MetricGrid from '../MetricGrid.vue'
import ChartCanvas from '../ChartCanvas.vue'
import SampleBadge from '../SampleBadge.vue'

defineEmits(['navigate'])
const { strategies, trades, scopedTrades, filters, strategyById } = useStrategyLab()
const basis = computed(() => filters.basis)
const m = computed(() => computeMetrics(scopedTrades.value, basis.value))
const best = computed(() => bestPerformers(scopedTrades.value, basis.value))
const stratName = (id) => strategyById.value.get(id)?.name ?? `#${id}`

const kpis = computed(() => {
  const x = m.value
  const b = best.value
  const none = `Sin muestra (mín. ${MIN_SAMPLE_INDICATIVE} ops)`
  return [
    { label: 'Estrategias', value: String(strategies.value.length), sub: `${strategies.value.filter((s) => s.status === 'ACTIVE').length} activas` },
    { label: 'Operaciones', value: String(scopedTrades.value.length), sub: `${x.nClosed} cerradas · ${x.pending} pendientes` },
    { label: 'Win rate', value: fmtPct(x.winRate), sub: x.winRateCI ? `IC 95%: ${x.winRateCI.low.toFixed(0)}–${x.winRateCI.high.toFixed(0)}% · n=${x.n}` : 'sin datos', tone: x.winRate === null ? 'dim' : x.winRate >= 50 ? 'pos' : 'neu' },
    { label: 'Profit factor', value: fmtPF(x.profitFactor), tone: toneForPF(x.profitFactor) },
    { label: 'Expectativa', value: fmtValue(x.expectancy, basis.value), tone: tone(x.expectancy), sub: 'promedio por operación' },
    { label: 'Ganancia acumulada', value: fmtValue(x.grossProfit, basis.value), tone: x.grossProfit > 0 ? 'pos' : 'neu' },
    { label: 'Pérdida acumulada', value: fmtValue(x.grossLoss, basis.value), tone: x.grossLoss < 0 ? 'neg' : 'neu' },
    { label: 'R promedio', value: fmtValue(x.avgR, 'R'), tone: tone(x.avgR), sub: `${x.nWithR} ops con R` },
    { label: 'Drawdown máximo', value: x.maxDrawdown ? fmtValue(x.maxDrawdown, basis.value, { plus: false }) : '—', tone: x.maxDrawdown ? 'neg' : 'neu' },
    { label: 'Mejor estrategia', value: b.bestStrategy ? stratName(b.bestStrategy.key) : '—', tone: 'info', sub: b.bestStrategy ? `${fmtValue(b.bestStrategy.metrics.expectancy, basis.value)} · n=${b.bestStrategy.metrics.n}` : none },
    { label: 'Mejor activo', value: b.bestAsset ? b.bestAsset.symbol : '—', tone: 'info', sub: b.bestAsset ? `${stratName(b.bestAsset.strategyId)} · ${fmtValue(b.bestAsset.metrics.expectancy, basis.value)} · n=${b.bestAsset.metrics.n}` : none },
  ]
})

const equityData = computed(() => {
  const c = equityCurve(scopedTrades.value, basis.value)
  return { labels: c.map((p) => p.date), datasets: [{ label: 'Acumulado', data: c.map((p) => p.cumulative), borderColor: COLORS.blue, backgroundColor: COLORS.blue, pointRadius: c.length > 80 ? 0 : 2, borderWidth: 1.5, stepped: false, tension: 0 }] }
})
const distData = computed(() => ({
  labels: ['Ganadoras', 'Perdedoras', 'Breakeven'],
  datasets: [{ data: [m.value.wins, m.value.losses, m.value.be], backgroundColor: [COLORS.up, COLORS.down, COLORS.dim], borderColor: '#14171f', borderWidth: 2 }],
}))
const distOpts = { plugins: { legend: { display: true, position: 'bottom' } }, cutout: '62%' }

const byStrategy = computed(() => groupMetrics(scopedTrades.value, keyBy.strategy, basis.value, { labelFn: (k) => stratName(k), sortFn: (a, b) => b.metrics.net - a.metrics.net }).rows)
const stratData = computed(() => ({
  labels: byStrategy.value.map((r) => `${r.label} (n=${r.metrics.n})`),
  datasets: [{ data: byStrategy.value.map((r) => r.metrics.net), backgroundColor: signColors(byStrategy.value.map((r) => r.metrics.net)) }],
}))
const byAsset = computed(() => groupMetrics(scopedTrades.value, keyBy.symbol, basis.value, { sortFn: (a, b) => b.metrics.net - a.metrics.net }).rows.slice(0, 15))
const assetData = computed(() => ({
  labels: byAsset.value.map((r) => `${r.label} (n=${r.metrics.n})`),
  datasets: [{ data: byAsset.value.map((r) => r.metrics.net), backgroundColor: signColors(byAsset.value.map((r) => r.metrics.net)) }],
}))
const horizontal = { indexAxis: 'y' }
const monthly = computed(() => monthlyReturns(scopedTrades.value, basis.value))
const monthData = computed(() => ({
  labels: monthly.value.map((r) => r.month),
  datasets: [{ data: monthly.value.map((r) => r.value), backgroundColor: signColors(monthly.value.map((r) => r.value)) }],
}))

// Backtesting vs real: usa solo el filtro de fechas para que ambos tipos queden visibles.
const dateScoped = computed(() => applyFilters(trades.value, { dateFrom: filters.dateFrom, dateTo: filters.dateTo }))
const btm = computed(() => computeMetrics(dateScoped.value.filter((t) => t.recordType === 'BACKTEST'), basis.value))
const rlm = computed(() => computeMetrics(dateScoped.value.filter((t) => t.recordType === 'REAL'), basis.value))
const cmpRows = computed(() => {
  const ids = [...new Set(dateScoped.value.map((t) => t.strategyId))]
  return ids.map((id) => ({
    name: stratName(id),
    bt: computeMetrics(dateScoped.value.filter((t) => t.strategyId === id && t.recordType === 'BACKTEST'), basis.value),
    rl: computeMetrics(dateScoped.value.filter((t) => t.strategyId === id && t.recordType === 'REAL'), basis.value),
  }))
})
const cmpData = computed(() => ({
  labels: cmpRows.value.map((r) => r.name),
  datasets: [
    { label: 'Backtesting', data: cmpRows.value.map((r) => r.bt.expectancy), backgroundColor: COLORS.blue },
    { label: 'Trading real', data: cmpRows.value.map((r) => r.rl.expectancy), backgroundColor: COLORS.amber },
  ],
}))
const cmpOpts = { plugins: { legend: { display: true, position: 'bottom' } } }
</script>

<template>
  <div class="sl-wrap">
    <div v-if="!trades.length" class="sl-panel">
      <div class="sl-empty">
        <div style="margin-bottom: 10px">Todavía no hay operaciones registradas.</div>
        <div style="display: flex; gap: 8px; justify-content: center">
          <button v-if="!strategies.length" class="sl-btn primary" @click="$emit('navigate', 'strategies')">Crear primera estrategia</button>
          <button v-else class="sl-btn primary" @click="$emit('navigate', 'register')">Registrar primera operación</button>
        </div>
      </div>
    </div>

    <template v-else>
      <div class="sl-panel">
        <div class="sl-panel-head"><span class="sl-panel-title">Indicadores globales</span><span class="dim">Solo operaciones cerradas · base {{ basis === 'PCT' ? '%' : basis === 'AMOUNT' ? '$' : 'R' }}</span></div>
        <MetricGrid :items="kpis" />
        <div v-if="m.excluded" class="sl-note warn" style="margin: 10px 14px">
          <b>{{ m.excluded }}</b> operación(es) cerrada(s) no tienen valor en esta base y quedaron fuera de las métricas (por ejemplo, sin stop loss no hay R). Probá con otra base.
        </div>
      </div>

      <div class="sl-grid-2">
        <div class="sl-panel"><div class="sl-panel-head"><span class="sl-panel-title">Evolución del rendimiento (acumulado)</span></div>
          <div class="sl-panel-body"><ChartCanvas v-if="equityData.labels.length" type="line" :data="equityData" /><div v-else class="sl-empty">Sin operaciones cerradas.</div></div></div>
        <div class="sl-panel"><div class="sl-panel-head"><span class="sl-panel-title">Ganadoras / perdedoras</span></div>
          <div class="sl-panel-body"><ChartCanvas v-if="m.n" type="doughnut" :data="distData" :options="distOpts" /><div v-else class="sl-empty">Sin operaciones cerradas.</div></div></div>
      </div>

      <div class="sl-grid-2">
        <div class="sl-panel"><div class="sl-panel-head"><span class="sl-panel-title">Resultado neto por estrategia</span></div>
          <div class="sl-panel-body"><ChartCanvas v-if="byStrategy.length" :data="stratData" /><div v-else class="sl-empty">Sin datos.</div></div></div>
        <div class="sl-panel"><div class="sl-panel-head"><span class="sl-panel-title">Resultado neto por activo (top 15)</span></div>
          <div class="sl-panel-body"><ChartCanvas v-if="byAsset.length" :data="assetData" :options="horizontal" :height="Math.max(260, byAsset.length * 24)" /><div v-else class="sl-empty">Sin datos.</div></div></div>
      </div>

      <div class="sl-grid-2">
        <div class="sl-panel"><div class="sl-panel-head"><span class="sl-panel-title">Evolución mensual (por mes de cierre)</span></div>
          <div class="sl-panel-body"><ChartCanvas v-if="monthly.length" :data="monthData" /><div v-else class="sl-empty">Sin datos.</div></div></div>
        <div class="sl-panel"><div class="sl-panel-head"><span class="sl-panel-title">Expectativa: backtesting vs. trading real</span></div>
          <div class="sl-panel-body"><ChartCanvas v-if="cmpRows.length" :data="cmpData" :options="cmpOpts" /><div v-else class="sl-empty">Sin datos.</div></div></div>
      </div>

      <div class="sl-panel">
        <div class="sl-panel-head"><span class="sl-panel-title">Backtesting vs. trading real (siempre separados)</span></div>
        <div class="sl-scroll">
          <table class="sl-table">
            <thead><tr><th>Tipo</th><th class="num">Ops</th><th class="num">Win rate</th><th class="num">Profit factor</th><th class="num">Expectativa</th><th class="num">Neto</th><th class="num">Drawdown</th><th>Muestra</th></tr></thead>
            <tbody>
              <tr v-for="row in [{ k: 'Backtesting manual', m: btm, c: 'bt' }, { k: 'Trading real', m: rlm, c: 'real' }]" :key="row.k">
                <td><span class="sl-badge" :class="row.c">{{ row.k }}</span></td>
                <td class="num">{{ row.m.n }}</td><td class="num">{{ fmtPct(row.m.winRate, 0) }}</td>
                <td class="num" :class="toneForPF(row.m.profitFactor)">{{ fmtPF(row.m.profitFactor) }}</td>
                <td class="num" :class="tone(row.m.expectancy)">{{ fmtValue(row.m.expectancy, basis) }}</td>
                <td class="num" :class="tone(row.m.net)">{{ fmtValue(row.m.net, basis) }}</td>
                <td class="num dim">{{ row.m.maxDrawdown ? fmtValue(row.m.maxDrawdown, basis, { plus: false }) : '—' }}</td>
                <td><SampleBadge :n="row.m.n" /></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>
