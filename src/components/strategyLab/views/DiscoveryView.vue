<script setup>
import { ref, computed } from 'vue'
import { useStrategyLab } from '../../../composables/useStrategyLab.js'
import { applyFilters, groupMetrics, keyBy, conditionEffectiveness, inconsistencyFlags, backtestVsReal, classifyRows, WEEKDAY_LABELS, MIN_SAMPLE_INDICATIVE, MIN_SAMPLE_RELIABLE } from '../../../services/strategyLab/stats.js'
import { fmtValue, fmtPct, tone } from '../../../services/strategyLab/format.js'
import BreakdownTable from '../BreakdownTable.vue'
import SampleBadge from '../SampleBadge.vue'

const { strategies, trades, scopedTrades, filters } = useStrategyLab()
const strategyId = ref('')
const basis = computed(() => filters.basis)
const data = computed(() => scopedTrades.value.filter((t) => !strategyId.value || t.strategyId === Number(strategyId.value)))

const sections = computed(() => {
  const b = basis.value
  const mk = (key, opts = {}) => groupMetrics(data.value, key, b, opts)
  return [
    { id: 'assets', title: 'Activos', header: 'Activo', res: mk(keyBy.symbol), noun: 'activo' },
    { id: 'tf', title: 'Temporalidades', header: 'Temporalidad', res: mk(keyBy.timeframe), noun: 'temporalidad' },
    { id: 'hours', title: 'Horarios de entrada', header: 'Hora', res: mk(keyBy.hour, { labelFn: (k) => `${String(k).padStart(2, '0')}:00` }), noun: 'horario' },
    { id: 'days', title: 'Días de la semana', header: 'Día', res: mk(keyBy.weekday, { labelFn: (k) => WEEKDAY_LABELS[k] }), noun: 'día' },
  ].map((s) => {
    const c = classifyRows(s.res.rows)
    const top = c.reliable.find((r) => r.metrics.expectancy !== null)
    const worst = [...c.reliable].reverse().find((r) => r.metrics.expectancy !== null)
    let reading
    if (top && worst && top.key !== worst.key && top.metrics.expectancy > 0) reading = `Entre los grupos con 30+ operaciones, el de mejor expectativa fue ${top.label} (${fmtValue(top.metrics.expectancy, b)}, n=${top.metrics.n}) y el de peor ${worst.label} (${fmtValue(worst.metrics.expectancy, b)}, n=${worst.metrics.n}).`
    else if (top) reading = `Con 30+ operaciones solo hay un grupo con expectativa positiva o único: ${top.label} (${fmtValue(top.metrics.expectancy, b)}, n=${top.metrics.n}).`
    else reading = `Ningún ${s.noun} llega a 30 operaciones: lo que ves es orientativo y puede deberse al azar.`
    return { ...s, reading }
  })
})

const conds = computed(() => conditionEffectiveness(data.value, basis.value).filter((c) => c.met.n + c.notMet.n >= 1))
const perStrategy = computed(() => {
  const ids = [...new Set(data.value.map((t) => t.strategyId))]
  return ids.map((id) => {
    // La comparación backtesting vs real ignora el filtro de tipo (necesita ambos); respeta fechas.
    const both = applyFilters(trades.value, { dateFrom: filters.dateFrom, dateTo: filters.dateTo }).filter((t) => t.strategyId === id)
    const own = data.value.filter((t) => t.strategyId === id)
    return { id, name: strategies.value.find((s) => s.id === id)?.name ?? `#${id}`, incons: inconsistencyFlags(own, basis.value), bvr: backtestVsReal(both, basis.value) }
  })
})
</script>

<template>
  <div class="sl-wrap">
    <div class="sl-note warn">
      <b>Cómo leer esta sección:</b> describe lo que pasó en TU historial, no predice resultados. Los grupos con menos de {{ MIN_SAMPLE_INDICATIVE }} operaciones se marcan como insuficientes,
      entre {{ MIN_SAMPLE_INDICATIVE }} y {{ MIN_SAMPLE_RELIABLE - 1 }} como orientativos, y recién desde {{ MIN_SAMPLE_RELIABLE }} como confiables. Cuantos más grupos compares (activos × horarios × días), más probable es encontrar uno "ganador" solo por casualidad.
    </div>
    <div class="sl-panel"><div class="sl-panel-body sl-cols">
      <div class="sl-field"><span class="sl-label">Estrategia</span><select v-model="strategyId" class="sl-select"><option value="">Todas</option><option v-for="s in strategies" :key="s.id" :value="s.id">{{ s.name }}</option></select></div>
    </div></div>

    <div v-for="s in sections" :key="s.id" class="sl-panel">
      <div class="sl-panel-head"><span class="sl-panel-title">{{ s.title }}</span></div>
      <div class="sl-note" style="margin: 10px 14px">{{ s.reading }}</div>
      <BreakdownTable :rows="s.res.rows" :label-header="s.header" :basis="basis" sectioned :unclassified="s.res.unclassified" />
    </div>

    <div class="sl-panel">
      <div class="sl-panel-head"><span class="sl-panel-title">Condiciones con mayor efecto</span></div>
      <div v-if="!conds.length" class="sl-empty">Todavía no hay condiciones evaluadas en operaciones cerradas.</div>
      <div v-else class="sl-scroll"><table class="sl-table">
        <thead><tr><th>Condición</th><th class="num">Si se cumple</th><th class="num">Si no se cumple</th><th class="num">Diferencia</th><th>Muestra (mín.)</th></tr></thead>
        <tbody><tr v-for="c in conds" :key="c.key"><td>{{ c.label }}</td>
          <td class="num"><span :class="tone(c.met.expectancy)">{{ fmtValue(c.met.expectancy, basis) }}</span> <span class="dim">n={{ c.met.n }}</span></td>
          <td class="num"><span :class="tone(c.notMet.expectancy)">{{ fmtValue(c.notMet.expectancy, basis) }}</span> <span class="dim">n={{ c.notMet.n }}</span></td>
          <td class="num" :class="tone(c.delta)">{{ fmtValue(c.delta, basis) }}</td><td><SampleBadge :n="Math.min(c.met.n, c.notMet.n)" /></td></tr></tbody>
      </table></div>
    </div>

    <div class="sl-panel">
      <div class="sl-panel-head"><span class="sl-panel-title">Consistencia por estrategia</span></div>
      <div v-if="!perStrategy.length" class="sl-empty">Sin datos.</div>
      <div v-for="p in perStrategy" :key="p.id" class="sl-panel-body" style="border-bottom: 1px solid var(--border); display: flex; flex-direction: column; gap: 6px">
        <div><b>{{ p.name }}</b> <SampleBadge :n="p.incons.metrics.n" /></div>
        <div v-if="!p.incons.enough" class="dim">Menos de {{ MIN_SAMPLE_INDICATIVE }} operaciones cerradas: no alcanza para evaluar consistencia.</div>
        <div v-else-if="!p.incons.flags.length" class="dim">No se detectaron señales de inconsistencia con estos criterios (no implica que los resultados vayan a repetirse).</div>
        <div v-for="fl in p.incons.flags" :key="fl.code" class="sl-note warn">{{ fl.text }}</div>
      </div>
    </div>

    <div class="sl-panel">
      <div class="sl-panel-head"><span class="sl-panel-title">Backtesting vs. trading real</span></div>
      <div class="sl-scroll"><table class="sl-table">
        <thead><tr><th>Estrategia</th><th class="num">Ops BT</th><th class="num">Win rate BT</th><th class="num">Expect. BT</th><th class="num">Ops real</th><th class="num">Win rate real</th><th class="num">Expect. real</th><th class="num">Δ expectativa</th><th>Lectura</th></tr></thead>
        <tbody><tr v-for="p in perStrategy" :key="p.id"><td>{{ p.name }}</td>
          <td class="num">{{ p.bvr.backtest.n }}</td><td class="num">{{ fmtPct(p.bvr.backtest.winRate, 0) }}</td><td class="num" :class="tone(p.bvr.backtest.expectancy)">{{ fmtValue(p.bvr.backtest.expectancy, basis) }}</td>
          <td class="num">{{ p.bvr.real.n }}</td><td class="num">{{ fmtPct(p.bvr.real.winRate, 0) }}</td><td class="num" :class="tone(p.bvr.real.expectancy)">{{ fmtValue(p.bvr.real.expectancy, basis) }}</td>
          <td class="num" :class="tone(p.bvr.deltaExpectancy)">{{ p.bvr.comparable ? fmtValue(p.bvr.deltaExpectancy, basis) : '—' }}</td>
          <td class="dim">{{ p.bvr.comparable ? (p.bvr.deltaExpectancy < 0 ? 'Real rinde menos que el backtest' : 'Real rinde igual o más') : `Comparable desde ${MIN_SAMPLE_INDICATIVE} ops en cada tipo` }}</td></tr></tbody>
      </table></div>
    </div>
  </div>
</template>
