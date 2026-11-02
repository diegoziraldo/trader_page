// src/services/strategyLab/tradeMath.js
//
// ÚNICA fuente de verdad para validar una operación y calcular sus métricas
// derivadas (R, %, monto, resultado, duración, cumplimiento de reglas).
// Es JS puro, sin dependencias: lo importan tanto el frontend (Vue) como el
// backend (functions/_lib/strategyLab.js), así el cálculo nunca se desincroniza.
//
// Convenciones (documentadas porque afectan a todas las estadísticas):
//  - R (múltiplo de riesgo) = resultado neto / riesgo inicial.
//      * Con stop + cantidad: riesgo = |entrada - stop| × cantidad, y el
//        resultado descuenta comisiones (R neto).
//      * Con stop pero sin cantidad: R bruto por precio (sin comisiones).
//      * Sin stop: se usa el riesgo monetario declarado, si hay cantidad.
//      * Si nada de eso existe, R = null (la operación se excluye de las
//        métricas en R; nunca se inventa un valor).
//  - % = resultado neto / capital invertido (entrada × cantidad); sin
//    cantidad, variación bruta del precio.
//  - Monto = (salida - entrada) × cantidad × signo - comisiones. Sin
//    cantidad queda null. NO se aplica apalancamiento.
//  - Breakeven: |R| < BE_EPSILON_R (o |%| < BE_EPSILON_PCT si no hay R).

export const DIRECTIONS = ['LONG', 'SHORT']
export const DIRECTION_MODES = ['LONG', 'SHORT', 'BOTH']
export const RECORD_TYPES = ['BACKTEST', 'REAL']
export const CONDITION_KINDS = ['ENTRY', 'EXIT', 'FILTER']
export const CONDITION_STATUSES = ['MET', 'NOT_MET', 'NA']
export const INSTRUMENT_TYPES = [
  'ACCION', 'CEDEAR', 'FOREX', 'FUTURO', 'CRIPTO', 'OPCION', 'INDICE', 'MATERIA_PRIMA', 'BONO', 'OTRO',
]
export const BE_EPSILON_R = 0.05
export const BE_EPSILON_PCT = 0.05

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

export function toNum(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function isValidDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

export function toTimestamp(date, time) {
  if (!isValidDate(date)) return null
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = time && TIME_RE.test(time) ? time.split(':').map(Number) : [0, 0]
  return Date.UTC(y, m - 1, d, hh, mm)
}

const dirSign = (direction) => (direction === 'SHORT' ? -1 : 1)
const provided = (v) => v !== null && v !== undefined && v !== ''

// ---------------------------------------------------------------------------
// Validación de una operación. `ctx` es opcional y trae las reglas de la
// estrategia/versión: { directionMode, timeframes }.
// ---------------------------------------------------------------------------
export function validateTradeInput(t, ctx = {}) {
  const errors = []
  const entry = toNum(t.entryPrice)
  const stop = toNum(t.stopLoss)
  const tp = toNum(t.takeProfit)
  const exit = toNum(t.exitPrice)
  const qty = toNum(t.quantity)

  if (!RECORD_TYPES.includes(t.recordType)) errors.push('El tipo de registro debe ser BACKTEST o REAL')
  if (!t.symbol || !String(t.symbol).trim()) errors.push('El ticker es requerido')
  if (!DIRECTIONS.includes(t.direction)) errors.push('La dirección debe ser LONG o SHORT')
  if (!isValidDate(t.entryDate)) errors.push('La fecha de entrada es inválida (AAAA-MM-DD)')
  if (t.entryTime && !TIME_RE.test(t.entryTime)) errors.push('La hora de entrada es inválida (HH:MM)')
  if (!t.timeframe || !String(t.timeframe).trim()) errors.push('La temporalidad es requerida')
  if (!(entry > 0)) errors.push('El precio de entrada debe ser mayor a 0')

  if (provided(t.stopLoss) && !(stop > 0)) errors.push('El stop loss debe ser mayor a 0')
  if (provided(t.takeProfit) && !(tp > 0)) errors.push('El take profit debe ser mayor a 0')
  if (provided(t.quantity) && !(qty > 0)) errors.push('La cantidad debe ser mayor a 0')

  if (entry > 0 && DIRECTIONS.includes(t.direction)) {
    const isLong = t.direction === 'LONG'
    if (stop > 0 && (isLong ? stop >= entry : stop <= entry)) {
      errors.push(isLong ? 'En LONG el stop loss debe estar por debajo de la entrada' : 'En SHORT el stop loss debe estar por encima de la entrada')
    }
    if (tp > 0 && (isLong ? tp <= entry : tp >= entry)) {
      errors.push(isLong ? 'En LONG el take profit debe estar por encima de la entrada' : 'En SHORT el take profit debe estar por debajo de la entrada')
    }
  }

  if (provided(t.fees) && !(toNum(t.fees) >= 0)) errors.push('Las comisiones no pueden ser negativas')
  if (provided(t.riskAmount) && !(toNum(t.riskAmount) >= 0)) errors.push('El riesgo monetario no puede ser negativo')
  if (provided(t.riskPercent) && !(toNum(t.riskPercent) >= 0 && toNum(t.riskPercent) <= 100)) errors.push('El riesgo porcentual debe estar entre 0 y 100')

  // Salida: fecha y precio van de a par (igual criterio que la planilla Pro).
  const hasExitDate = !!t.exitDate
  const hasExitPrice = provided(t.exitPrice)
  if (hasExitDate !== hasExitPrice) {
    errors.push('Para cerrar la operación completá fecha Y precio de salida (o dejá ambos vacíos para dejarla pendiente)')
  }
  if (hasExitPrice && !(exit > 0)) errors.push('El precio de salida debe ser mayor a 0')
  if (hasExitDate && !isValidDate(t.exitDate)) errors.push('La fecha de salida es inválida (AAAA-MM-DD)')
  if (t.exitTime && !TIME_RE.test(t.exitTime)) errors.push('La hora de salida es inválida (HH:MM)')
  if (hasExitDate && isValidDate(t.exitDate) && isValidDate(t.entryDate)) {
    const bothTimes = !!t.entryTime && !!t.exitTime
    const a = toTimestamp(t.entryDate, bothTimes ? t.entryTime : '')
    const b = toTimestamp(t.exitDate, bothTimes ? t.exitTime : '')
    if (b < a) errors.push('La salida no puede ser anterior a la entrada')
  }

  if (ctx.directionMode && ctx.directionMode !== 'BOTH' && DIRECTIONS.includes(t.direction) && t.direction !== ctx.directionMode) {
    errors.push(`Esta versión de la estrategia solo admite operaciones ${ctx.directionMode}`)
  }
  if (Array.isArray(ctx.timeframes) && ctx.timeframes.length && t.timeframe && !ctx.timeframes.includes(t.timeframe)) {
    errors.push(`La temporalidad ${t.timeframe} no está admitida por esta versión (${ctx.timeframes.join(', ')})`)
  }
  return errors
}

// ---------------------------------------------------------------------------
// Métricas derivadas de UNA operación.
// ---------------------------------------------------------------------------
export function computeTrade(t) {
  const entry = toNum(t.entryPrice)
  const stop = toNum(t.stopLoss)
  const tp = toNum(t.takeProfit)
  const exit = toNum(t.exitPrice)
  const qty = toNum(t.quantity)
  const fees = toNum(t.fees) || 0
  const declaredRisk = toNum(t.riskAmount)
  const s = dirSign(t.direction)

  const closed = exit !== null && !!t.exitDate
  const riskPerUnit = stop !== null && entry !== null && Math.abs(entry - stop) > 0 ? Math.abs(entry - stop) : null
  const plannedRR = riskPerUnit && tp !== null ? Math.abs(tp - entry) / riskPerUnit : null

  let riskMoney = null
  if (riskPerUnit && qty > 0) riskMoney = riskPerUnit * qty
  else if (declaredRisk > 0 && qty > 0) riskMoney = declaredRisk

  const base = {
    status: closed ? 'CLOSED' : 'PENDING',
    plannedRR,
    riskMoney,
    resultR: null,
    rBasis: null,
    resultPct: null,
    resultAmount: null,
    outcome: null,
    entryTimestamp: toTimestamp(t.entryDate, t.entryTime),
    exitTimestamp: closed ? toTimestamp(t.exitDate, t.exitTime) : null,
    durationMinutes: null,
    durationDays: null,
    weekday: null,
    entryHour: null,
    entryMonth: isValidDate(t.entryDate) ? t.entryDate.slice(0, 7) : null,
    entryYear: isValidDate(t.entryDate) ? Number(t.entryDate.slice(0, 4)) : null,
  }
  if (isValidDate(t.entryDate)) base.weekday = new Date(base.entryTimestamp).getUTCDay()
  if (t.entryTime && TIME_RE.test(t.entryTime)) base.entryHour = Number(t.entryTime.slice(0, 2))

  if (!closed || entry === null) return base

  const move = s * (exit - entry)
  const amount = qty > 0 ? move * qty - fees : null
  const grossR = riskPerUnit ? move / riskPerUnit : null

  let resultR = null
  let rBasis = null
  if (amount !== null && riskMoney > 0) { resultR = amount / riskMoney; rBasis = 'NET' }
  else if (grossR !== null) { resultR = grossR; rBasis = 'GROSS' }

  const resultPct = amount !== null && entry > 0 ? (amount / (entry * qty)) * 100 : (move / entry) * 100

  let outcome
  if (resultR !== null) outcome = resultR > BE_EPSILON_R ? 'WIN' : resultR < -BE_EPSILON_R ? 'LOSS' : 'BE'
  else outcome = resultPct > BE_EPSILON_PCT ? 'WIN' : resultPct < -BE_EPSILON_PCT ? 'LOSS' : 'BE'

  const a = base.entryTimestamp
  const b = base.exitTimestamp
  if (a !== null && b !== null) {
    if (t.entryTime && t.exitTime) base.durationMinutes = Math.round((b - a) / 60000)
    base.durationDays = Math.round((toTimestamp(t.exitDate, '') - toTimestamp(t.entryDate, '')) / 86400000)
  }

  return { ...base, resultR, rBasis, resultPct, resultAmount: amount, outcome }
}

// ---------------------------------------------------------------------------
// Cumplimiento de reglas. `results`: [{ status, required }] solo de
// condiciones HABILITADAS de la versión. Las 'NA' no cuentan en ningún
// denominador.
// ---------------------------------------------------------------------------
export function computeCompliance(results) {
  let met = 0, notMet = 0, na = 0, reqMet = 0, reqApplicable = 0
  for (const r of results || []) {
    if (r.status === 'MET') { met++; if (r.required) { reqMet++; reqApplicable++ } }
    else if (r.status === 'NOT_MET') { notMet++; if (r.required) reqApplicable++ }
    else if (r.status === 'NA') na++
  }
  const applicable = met + notMet
  const pct = applicable > 0 ? (met / applicable) * 100 : null
  const requiredPct = reqApplicable > 0 ? (reqMet / reqApplicable) * 100 : null
  let bucket = 'UNKNOWN'
  if (applicable > 0) bucket = notMet === 0 ? 'FULL' : met === 0 ? 'NONE' : 'PARTIAL'
  return { met, notMet, na, applicable, pct, requiredMet: reqMet, requiredApplicable: reqApplicable, requiredPct, bucket }
}

// ---------------------------------------------------------------------------
// Links de TradingView (reemplazan a las capturas de imagen: no se guarda
// ningún archivo, solo la URL). Acepta tradingview.com y sus subdominios
// (www., es., in.), exige una ruta (no la home) y siempre devuelve https.
// ---------------------------------------------------------------------------
export function normalizeTradingViewUrl(raw) {
  const s = String(raw ?? '').trim()
  if (!s || s.length > 500) return null
  let u
  try { u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`) } catch { return null }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  if (u.username || u.password) return null
  const h = u.hostname.toLowerCase()
  if (h !== 'tradingview.com' && !h.endsWith('.tradingview.com')) return null
  if (u.pathname.length <= 1) return null
  u.protocol = 'https:'
  return u.toString()
}

// Separa un texto pegado (uno o varios links, por espacios o saltos de línea).
export function splitLinkInput(text) {
  return String(text ?? '').split(/[\s,;]+/).map((t) => t.trim()).filter(Boolean)
}
