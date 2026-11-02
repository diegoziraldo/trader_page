import test from 'node:test'
import assert from 'node:assert/strict'
import { computeMetrics, wilsonInterval, equityCurve, monthlyReturns, groupMetrics, keyBy, applyFilters, inconsistencyFlags, conditionEffectiveness, durationBucket } from '../src/services/strategyLab/stats.js'

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`)
let id = 0
const mk = (r, extra = {}) => ({
  id: ++id, status: 'CLOSED', symbol: 'AAA', strategyId: 1, recordType: 'BACKTEST',
  resultR: r, resultPct: r * 2, resultAmount: r * 100,
  outcome: r > 0.05 ? 'WIN' : r < -0.05 ? 'LOSS' : 'BE',
  entryTimestamp: id * 1000, exitTimestamp: id * 1000 + 1,
  entryDate: '2026-01-05', exitDate: `2026-0${1 + (id % 2)}-10`, ...extra,
})
const seq = (vals, extra) => vals.map((v) => mk(v, extra))

test('métricas a mano: W L L W L L W  (+2,-1,-1,+3,-1,-1,+1)', () => {
  const m = computeMetrics(seq([2, -1, -1, 3, -1, -1, 1]), 'R')
  assert.equal(m.n, 7); assert.equal(m.wins, 3); assert.equal(m.losses, 4); assert.equal(m.be, 0)
  close(m.winRate, (3 / 7) * 100)
  close(m.grossProfit, 6); close(m.grossLoss, -4); close(m.net, 2)
  close(m.profitFactor, 1.5); close(m.expectancy, 2 / 7)
  close(m.avgWin, 2); close(m.avgLoss, -1); close(m.payoffRatio, 2)
  close(m.maxDrawdown, 2); assert.equal(m.maxWinStreak, 1); assert.equal(m.maxLossStreak, 2)
  close(m.avgR, 2 / 7)
})

test('expectativa = WR·avgWin + (1-WR)·avgLoss cuando no hay BE', () => {
  const m = computeMetrics(seq([2, -1, -1, 3, -1, -1, 1]), 'R')
  const wr = m.wins / m.n
  close(m.expectancy, wr * m.avgWin + (1 - wr) * m.avgLoss)
})

test('Wilson 3/7 ≈ [0.158, 0.750]', () => {
  const w = wilsonInterval(3, 7)
  assert.ok(Math.abs(w.low - 0.158) < 0.002, w.low); assert.ok(Math.abs(w.high - 0.750) < 0.002, w.high)
  assert.equal(wilsonInterval(0, 0), null)
})

test('sin pérdidas: PF infinito; sin operaciones: todo nulo y seguro', () => {
  assert.equal(computeMetrics(seq([1, 2]), 'R').profitFactor, Infinity)
  const e = computeMetrics([], 'R')
  assert.equal(e.n, 0); assert.equal(e.winRate, null); assert.equal(e.profitFactor, null); assert.equal(e.expectancy, null); assert.equal(e.net, 0)
  assert.equal(computeMetrics(seq([-1, -2]), 'R').profitFactor, 0)
})

test('breakeven corta rachas y cuenta en el denominador del win rate', () => {
  const m = computeMetrics(seq([1, 1, 0, 1, -1]), 'R')
  assert.equal(m.be, 1); assert.equal(m.maxWinStreak, 2); close(m.winRate, 60)
})

test('pendientes se informan y no cuentan; sin valor en la base se excluye', () => {
  const trades = [...seq([1, -1]), { id: 99, status: 'PENDING' }, mk(null, { resultR: null, resultPct: 1, outcome: 'WIN' })]
  const m = computeMetrics(trades, 'R')
  assert.equal(m.n, 2); assert.equal(m.pending, 1); assert.equal(m.excluded, 1)
  assert.equal(computeMetrics(trades, 'PCT').n, 3)
})

test('drawdown con curva que empieza perdiendo', () => {
  close(computeMetrics(seq([-1, -1, 3, -2]), 'R').maxDrawdown, 2) // eq -1,-2,1,-1 ; peak 0,0,1,1 -> dd 1,2,0,2
})

test('equityCurve y monthlyReturns', () => {
  id = 0
  const t = seq([1, 2, -1])
  const eq = equityCurve(t, 'R')
  assert.deepEqual(eq.map((p) => p.cumulative), [1, 3, 2])
  const mr = monthlyReturns(t, 'R')
  assert.equal(mr.reduce((a, b) => a + b.value, 0), 2)
})

test('groupMetrics informa no clasificados', () => {
  const t = [mk(1, { symbol: 'A' }), mk(-1, { symbol: 'A' }), mk(2, { symbol: 'B' }), mk(2, { symbol: null })]
  const g = groupMetrics(t, keyBy.symbol, 'R')
  assert.equal(g.unclassified, 1); assert.equal(g.rows.length, 2)
  assert.equal(g.rows[0].key, 'B') // mayor expectativa primero
})

test('filtros', () => {
  const t = [mk(1, { symbol: 'NVDA', recordType: 'REAL' }), mk(-1, { symbol: 'MELI' }), { id: 50, status: 'PENDING', symbol: 'NU', entryDate: '2026-01-05', recordType: 'BACKTEST' }]
  assert.equal(applyFilters(t, { recordType: 'REAL' }).length, 1)
  assert.equal(applyFilters(t, { query: 'mel' }).length, 1)
  assert.equal(applyFilters(t, { outcome: 'PENDING' }).length, 1)
  assert.equal(applyFilters(t, { dateFrom: '2026-02-01' }).length, 0)
})

test('inconsistencia: mitades con signo opuesto', () => {
  const r = inconsistencyFlags(seq([1, 1, 1, 1, 1, 1, -1, -1, -1, -1, -1, -1]), 'R')
  assert.ok(r.flags.some((f) => f.code === 'HALVES_FLIP'))
  assert.equal(inconsistencyFlags(seq([1, -1, 1]), 'R').enough, false)
})

test('efectividad de condiciones', () => {
  const cr = (s) => [{ key: 'k1', label: 'RSI>50', required: true, status: s }]
  const t = [mk(2, { conditionResults: cr('MET') }), mk(1, { conditionResults: cr('MET') }), mk(-1, { conditionResults: cr('NOT_MET') })]
  const e = conditionEffectiveness(t, 'R')[0]
  close(e.met.expectancy, 1.5); close(e.notMet.expectancy, -1); close(e.delta, 2.5)
})

test('buckets de duración', () => {
  assert.equal(durationBucket({ durationMinutes: 30 }), '< 1 h')
  assert.equal(durationBucket({ durationMinutes: 300 }), '4 h – 1 día')
  assert.equal(durationBucket({ durationMinutes: null, durationDays: 0 }), null)
  assert.equal(durationBucket({ durationMinutes: null, durationDays: 10 }), '> 7 días')
})

import { alignedEquity } from '../src/services/strategyLab/stats.js'
test('alignedEquity: por operación y por fecha (arrastra el último valor)', () => {
  const t = (v, d, ts) => ({ id: ts, status: 'CLOSED', resultR: v, outcome: v > 0 ? 'WIN' : 'LOSS', exitDate: d, exitTimestamp: ts, entryTimestamp: ts })
  const A = [t(1, '2026-01-01', 1), t(1, '2026-01-03', 3)]
  const B = [t(-1, '2026-01-02', 2)]
  const byTrade = alignedEquity([{ label: 'A', trades: A }, { label: 'B', trades: B }], 'R', 'TRADES')
  assert.deepEqual(byTrade.datasets[0].data, [1, 2]); assert.deepEqual(byTrade.datasets[1].data, [-1, null])
  const byDate = alignedEquity([{ label: 'A', trades: A }, { label: 'B', trades: B }], 'R', 'DATE')
  assert.deepEqual(byDate.labels, ['2026-01-01', '2026-01-02', '2026-01-03'])
  assert.deepEqual(byDate.datasets[0].data, [1, 1, 2]); assert.deepEqual(byDate.datasets[1].data, [null, -1, -1])
})
