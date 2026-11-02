// src/services/strategyLab/stats.js
//
// Capa de servicios con TODOS los cálculos estadísticos del Strategy Lab.
// Funciones puras: reciben operaciones ya enriquecidas por el backend (con
// los campos de tradeMath.computeTrade) y devuelven números. Ningún
// componente Vue calcula estadísticas por su cuenta.
//
// Reglas de cálculo (se muestran también en la UI):
//  - Solo cuentan operaciones CERRADAS. Las pendientes se informan aparte.
//  - Cada métrica se calcula sobre una BASE elegida: 'R', 'PCT' o 'AMOUNT'.
//    Las operaciones sin valor en esa base se EXCLUYEN y se informa cuántas
//    (`excluded`). Nunca se mezclan bases ni se inventan valores.
//  - Win rate = ganadoras / operaciones con valor (los breakeven suman al
//    denominador).
//  - Profit factor = suma de valores positivos / |suma de valores negativos|.
//  - Expectativa = promedio de TODAS las operaciones (incluye BE en 0).
//  - Drawdown = mayor caída, en unidades de la base, desde un máximo previo
//    de la curva acumulada (arranca en 0, suma simple, sin reinversión).
//  - Rachas: un breakeven corta ambas rachas.
//  - Orden temporal: por fecha/hora de CIERRE.

export const BASES = ['R', 'PCT', 'AMOUNT']
export const BASIS_LABELS = { R: 'R (múltiplos de riesgo)', PCT: '% por operación', AMOUNT: 'Monto ($)' }
export const MIN_SAMPLE_INDICATIVE = 10
export const MIN_SAMPLE_RELIABLE = 30

export const WEEKDAY_LABELS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']

export function valueOf(trade, basis = 'R') {
  const v = basis === 'PCT' ? trade.resultPct : basis === 'AMOUNT' ? trade.resultAmount : trade.resultR
  return v === null || v === undefined || !Number.isFinite(v) ? null : v
}

export const isClosed = (t) => t.status === 'CLOSED'
export const isPending = (t) => t.status === 'PENDING'

export function sortByClose(trades) {
  return [...trades].sort(
    (a, b) =>
      (a.exitTimestamp ?? 0) - (b.exitTimestamp ?? 0) ||
      (a.entryTimestamp ?? 0) - (b.entryTimestamp ?? 0) ||
      (a.id ?? 0) - (b.id ?? 0)
  )
}

// Intervalo de confianza de Wilson (95%) para una proporción k/n. Devuelve
// fracciones (0..1) o null si n = 0.
export function wilsonInterval(k, n, z = 1.96) {
  if (!n) return null
  const p = k / n
  const z2 = z * z
  const denom = 1 + z2 / n
  const center = (p + z2 / (2 * n)) / denom
  const margin = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom
  return { low: Math.max(0, center - margin), high: Math.min(1, center + margin) }
}

export function sampleReliability(n) {
  if (n < MIN_SAMPLE_INDICATIVE) return { level: 'INSUFFICIENT', label: 'Muestra insuficiente', warn: true }
  if (n < MIN_SAMPLE_RELIABLE) return { level: 'LOW', label: 'Muestra baja (orientativa)', warn: true }
  if (n < 100) return { level: 'MODERATE', label: 'Muestra moderada', warn: false }
  return { level: 'ADEQUATE', label: 'Muestra adecuada', warn: false }
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const sum = (xs) => xs.reduce((a, b) => a + b, 0)

export function emptyMetrics(basis = 'R') {
  return computeMetrics([], basis)
}

export function computeMetrics(trades, basis = 'R') {
  const closed = sortByClose(trades.filter(isClosed))
  const pending = trades.filter(isPending).length
  const rows = closed.map((t) => ({ t, v: valueOf(t, basis) })).filter((r) => r.v !== null)
  const values = rows.map((r) => r.v)
  const n = rows.length

  const winsRows = rows.filter((r) => r.t.outcome === 'WIN')
  const lossRows = rows.filter((r) => r.t.outcome === 'LOSS')
  const wins = winsRows.length
  const losses = lossRows.length
  const be = n - wins - losses

  const pos = sum(values.filter((v) => v > 0))
  const neg = sum(values.filter((v) => v < 0))
  const profitFactor = neg < 0 ? pos / Math.abs(neg) : pos > 0 ? Infinity : null

  const avgWin = mean(winsRows.map((r) => r.v))
  const avgLoss = mean(lossRows.map((r) => r.v))

  // Equity acumulada, drawdown y rachas en orden de cierre.
  let eq = 0, peak = 0, maxDD = 0, curW = 0, curL = 0, maxW = 0, maxL = 0
  for (const { t, v } of rows) {
    eq += v
    if (eq > peak) peak = eq
    if (peak - eq > maxDD) maxDD = peak - eq
    if (t.outcome === 'WIN') { curW++; curL = 0 }
    else if (t.outcome === 'LOSS') { curL++; curW = 0 }
    else { curW = 0; curL = 0 }
    if (curW > maxW) maxW = curW
    if (curL > maxL) maxL = curL
  }

  const m = mean(values)
  let stdev = null, tStat = null
  if (n >= 2) {
    const variance = values.reduce((a, v) => a + (v - m) ** 2, 0) / (n - 1)
    stdev = Math.sqrt(variance)
    tStat = stdev > 0 ? m / (stdev / Math.sqrt(n)) : null
  }

  const rVals = closed.map((t) => t.resultR).filter((v) => v !== null && v !== undefined)
  const ci = wilsonInterval(wins, n)

  return {
    basis,
    n,
    nClosed: closed.length,
    excluded: closed.length - n,
    pending,
    wins,
    losses,
    be,
    winRate: n ? (wins / n) * 100 : null,
    winRateCI: ci ? { low: ci.low * 100, high: ci.high * 100 } : null,
    avgWin,
    avgLoss,
    payoffRatio: avgWin !== null && avgLoss !== null && avgLoss !== 0 ? avgWin / Math.abs(avgLoss) : null,
    profitFactor,
    grossProfit: pos,
    grossLoss: neg,
    net: n ? pos + neg : 0,
    expectancy: m,
    avgR: mean(rVals),
    nWithR: rVals.length,
    maxDrawdown: maxDD,
    maxWinStreak: maxW,
    maxLossStreak: maxL,
    stdev,
    tStat,
    best: n ? Math.max(...values) : null,
    worst: n ? Math.min(...values) : null,
    reliability: sampleReliability(n),
  }
}

// Curva de rendimiento acumulado en orden de cierre.
export function equityCurve(trades, basis = 'R') {
  let eq = 0
  const out = []
  for (const t of sortByClose(trades.filter(isClosed))) {
    const v = valueOf(t, basis)
    if (v === null) continue
    eq += v
    out.push({ date: t.exitDate, value: v, cumulative: eq, tradeId: t.id })
  }
  return out
}

// Rendimiento por mes de CIERRE (suma de la base elegida).
export function monthlyReturns(trades, basis = 'R') {
  const map = new Map()
  for (const t of trades.filter(isClosed)) {
    const v = valueOf(t, basis)
    if (v === null || !t.exitDate) continue
    const key = t.exitDate.slice(0, 7)
    const cur = map.get(key) || { month: key, value: 0, n: 0 }
    cur.value += v
    cur.n += 1
    map.set(key, cur)
  }
  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month))
}

// ---------------------------------------------------------------------------
// Agrupaciones. `keyFn` devuelve null para excluir (dato faltante); la
// cantidad de excluidos se informa para que no se pierdan en silencio.
// ---------------------------------------------------------------------------
export function groupMetrics(trades, keyFn, basis = 'R', { labelFn, sortFn } = {}) {
  const closed = trades.filter(isClosed)
  const groups = new Map()
  let unclassified = 0
  for (const t of closed) {
    const key = keyFn(t)
    if (key === null || key === undefined || key === '') { unclassified++; continue }
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(t)
  }
  const rows = [...groups.entries()].map(([key, list]) => ({
    key,
    label: labelFn ? labelFn(key, list) : String(key),
    metrics: computeMetrics(list, basis),
  }))
  rows.sort(sortFn || ((a, b) => (b.metrics.expectancy ?? -Infinity) - (a.metrics.expectancy ?? -Infinity)))
  return { rows, unclassified }
}

export const keyBy = {
  symbol: (t) => t.symbol,
  timeframe: (t) => t.timeframe,
  direction: (t) => t.direction,
  recordType: (t) => t.recordType,
  weekday: (t) => t.weekday,
  hour: (t) => t.entryHour,
  entryMonth: (t) => t.entryMonth,
  entryYear: (t) => t.entryYear,
  strategy: (t) => t.strategyId,
  version: (t) => t.versionId,
  compliance: (t) => (t.compliance && t.compliance.bucket !== 'UNKNOWN' ? t.compliance.bucket : null),
  duration: (t) => durationBucket(t),
}

export const DURATION_BUCKETS = ['< 1 h', '1 – 4 h', '4 h – 1 día', '1 – 3 días', '3 – 7 días', '> 7 días']
export function durationBucket(t) {
  let minutes = t.durationMinutes
  if (minutes === null || minutes === undefined) {
    if (t.durationDays === null || t.durationDays === undefined || t.durationDays < 1) return null
    minutes = t.durationDays * 1440
  }
  if (minutes < 60) return DURATION_BUCKETS[0]
  if (minutes < 240) return DURATION_BUCKETS[1]
  if (minutes < 1440) return DURATION_BUCKETS[2]
  if (minutes < 3 * 1440) return DURATION_BUCKETS[3]
  if (minutes <= 7 * 1440) return DURATION_BUCKETS[4]
  return DURATION_BUCKETS[5]
}

export const COMPLIANCE_LABELS = { FULL: 'Todas las reglas cumplidas', PARTIAL: 'Cumplimiento parcial', NONE: 'Ninguna regla cumplida' }
export const COMPLIANCE_ORDER = ['FULL', 'PARTIAL', 'NONE']

// Efectividad de cada condición: resultado cuando se cumplió vs. cuando no.
// Agrupa por la clave estable de la condición (sobrevive entre versiones).
export function conditionEffectiveness(trades, basis = 'R') {
  const byKey = new Map()
  for (const t of trades.filter(isClosed)) {
    for (const c of t.conditionResults || []) {
      if (c.status !== 'MET' && c.status !== 'NOT_MET') continue
      if (!byKey.has(c.key)) byKey.set(c.key, { key: c.key, label: c.label, required: c.required, met: [], notMet: [] })
      const e = byKey.get(c.key)
      e.label = c.label
      ;(c.status === 'MET' ? e.met : e.notMet).push(t)
    }
  }
  return [...byKey.values()]
    .map((e) => {
      const met = computeMetrics(e.met, basis)
      const notMet = computeMetrics(e.notMet, basis)
      const delta = met.expectancy !== null && notMet.expectancy !== null ? met.expectancy - notMet.expectancy : null
      return { key: e.key, label: e.label, required: e.required, met, notMet, delta }
    })
    .sort((a, b) => (b.delta ?? -Infinity) - (a.delta ?? -Infinity))
}

// ---------------------------------------------------------------------------
// Filtros
// ---------------------------------------------------------------------------
export function applyFilters(trades, f = {}) {
  const q = (f.query || '').trim().toUpperCase()
  return trades.filter((t) => {
    if (f.recordType && f.recordType !== 'ALL' && t.recordType !== f.recordType) return false
    if (f.strategyIds && f.strategyIds.length && !f.strategyIds.includes(t.strategyId)) return false
    if (f.symbols && f.symbols.length && !f.symbols.includes(t.symbol)) return false
    if (f.timeframe && t.timeframe !== f.timeframe) return false
    if (f.direction && t.direction !== f.direction) return false
    if (f.dateFrom && t.entryDate < f.dateFrom) return false
    if (f.dateTo && t.entryDate > f.dateTo) return false
    if (f.outcome) {
      if (f.outcome === 'PENDING' ? t.status !== 'PENDING' : t.outcome !== f.outcome) return false
    }
    if (q && !t.symbol.includes(q) && !(t.assetName || '').toUpperCase().includes(q)) return false
    return true
  })
}

// ---------------------------------------------------------------------------
// Descubrimiento: solo devuelve datos y banderas; la UI decide cómo avisar.
// ---------------------------------------------------------------------------

// Separa filas por confiabilidad de muestra, sin descartar ninguna.
export function classifyRows(rows) {
  return {
    reliable: rows.filter((r) => r.metrics.n >= MIN_SAMPLE_RELIABLE),
    indicative: rows.filter((r) => r.metrics.n >= MIN_SAMPLE_INDICATIVE && r.metrics.n < MIN_SAMPLE_RELIABLE),
    insufficient: rows.filter((r) => r.metrics.n < MIN_SAMPLE_INDICATIVE),
  }
}

// Señales de inconsistencia para una estrategia (sobre sus operaciones).
export function inconsistencyFlags(trades, basis = 'R') {
  const flags = []
  const closed = sortByClose(trades.filter(isClosed)).filter((t) => valueOf(t, basis) !== null)
  const all = computeMetrics(closed, basis)
  if (all.n < MIN_SAMPLE_INDICATIVE) return { flags, metrics: all, enough: false }

  const mid = Math.floor(closed.length / 2)
  const h1 = computeMetrics(closed.slice(0, mid), basis)
  const h2 = computeMetrics(closed.slice(mid), basis)
  if (h1.n >= 5 && h2.n >= 5 && h1.expectancy !== null && h2.expectancy !== null && Math.sign(h1.expectancy) !== Math.sign(h2.expectancy) && h1.expectancy !== 0 && h2.expectancy !== 0) {
    flags.push({ code: 'HALVES_FLIP', text: 'El signo de la expectativa cambia entre la primera y la segunda mitad del historial.', h1: h1.expectancy, h2: h2.expectancy })
  }
  if (all.n >= MIN_SAMPLE_RELIABLE && all.tStat !== null && Math.abs(all.tStat) < 1) {
    flags.push({ code: 'NOT_DISTINGUISHABLE', text: 'La expectativa no se distingue estadísticamente de cero (|t| < 1).', tStat: all.tStat })
  }
  if (all.n >= MIN_SAMPLE_INDICATIVE && all.maxLossStreak >= 6) {
    flags.push({ code: 'LONG_LOSS_STREAK', text: `Racha máxima de ${all.maxLossStreak} pérdidas consecutivas.` })
  }
  return { flags, metrics: all, enough: true, halves: [h1, h2] }
}

// Backtesting vs. trading real de una misma estrategia.
export function backtestVsReal(trades, basis = 'R') {
  const bt = computeMetrics(trades.filter((t) => t.recordType === 'BACKTEST'), basis)
  const rl = computeMetrics(trades.filter((t) => t.recordType === 'REAL'), basis)
  const comparable = bt.n >= MIN_SAMPLE_INDICATIVE && rl.n >= MIN_SAMPLE_INDICATIVE
  return {
    backtest: bt,
    real: rl,
    comparable,
    deltaWinRate: bt.winRate !== null && rl.winRate !== null ? rl.winRate - bt.winRate : null,
    deltaExpectancy: bt.expectancy !== null && rl.expectancy !== null ? rl.expectancy - bt.expectancy : null,
  }
}

// Resumen global para el dashboard: mejor estrategia y mejor activo por
// estrategia, exigiendo muestra mínima para no destacar casualidades.
export function bestPerformers(trades, basis = 'R', minN = MIN_SAMPLE_INDICATIVE) {
  const strategies = groupMetrics(trades, keyBy.strategy, basis).rows.filter((r) => r.metrics.n >= minN && r.metrics.expectancy !== null)
  const bestStrategy = strategies[0] || null
  let bestAsset = null
  const byStrategy = new Map()
  for (const t of trades.filter(isClosed)) {
    if (!byStrategy.has(t.strategyId)) byStrategy.set(t.strategyId, [])
    byStrategy.get(t.strategyId).push(t)
  }
  for (const [strategyId, list] of byStrategy) {
    const rows = groupMetrics(list, keyBy.symbol, basis).rows.filter((r) => r.metrics.n >= minN && r.metrics.expectancy !== null)
    if (rows[0] && (!bestAsset || rows[0].metrics.expectancy > bestAsset.metrics.expectancy)) {
      bestAsset = { strategyId, symbol: rows[0].key, metrics: rows[0].metrics }
    }
  }
  return { bestStrategy, bestAsset, minN }
}

export function formatMetric(v, { digits = 2, suffix = '', plus = false } = {}) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  if (v === Infinity) return '∞'
  const s = v.toFixed(digits)
  return (plus && v > 0 ? '+' : '') + s + suffix
}

// Curvas acumuladas alineadas para comparar varias estrategias.
//  mode 'TRADES': eje = número de operación (1..N de cada una).
//  mode 'DATE'  : eje = fechas de cierre; cada serie arrastra su último valor.
// `groups`: [{ label, trades }]  ->  { labels, datasets: [{ label, data }] }
export function alignedEquity(groups, basis = 'R', mode = 'TRADES') {
  const curves = groups.map((g) => ({ label: g.label, curve: equityCurve(g.trades, basis) }))
  if (mode === 'TRADES') {
    const max = Math.max(0, ...curves.map((c) => c.curve.length))
    return {
      labels: Array.from({ length: max }, (_, i) => String(i + 1)),
      datasets: curves.map((c) => ({ label: c.label, data: Array.from({ length: max }, (_, i) => (i < c.curve.length ? c.curve[i].cumulative : null)) })),
    }
  }
  const labels = [...new Set(curves.flatMap((c) => c.curve.map((p) => p.date)))].sort()
  return {
    labels,
    datasets: curves.map((c) => {
      let last = null, idx = 0
      const data = labels.map((d) => {
        while (idx < c.curve.length && c.curve[idx].date <= d) { last = c.curve[idx].cumulative; idx++ }
        return last
      })
      return { label: c.label, data }
    }),
  }
}
