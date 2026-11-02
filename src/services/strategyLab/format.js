// src/services/strategyLab/format.js — helpers de presentación (no hacen cálculos).
export const BASIS_SHORT = { R: 'R', PCT: '%', AMOUNT: '$' }

export function fmtValue(v, basis = 'R', { plus = true } = {}) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  if (v === Infinity) return '∞'
  const s = (plus && v > 0 ? '+' : '') + v.toFixed(2)
  return basis === 'R' ? `${s}R` : basis === 'PCT' ? `${s}%` : s
}
export const fmtPF = (v) => (v === Infinity ? '∞' : v === null || v === undefined ? '—' : v.toFixed(2))
export const fmtPct = (v, d = 1) => (v === null || v === undefined ? '—' : `${v.toFixed(d)}%`)
export const fmtNum = (v, d = 2) => (v === null || v === undefined || Number.isNaN(v) ? '—' : Number(v).toFixed(d))
export const tone = (v) => (v === null || v === undefined || v === 0 ? 'neu' : v > 0 ? 'pos' : 'neg')
export const toneForPF = (v) => (v === null || v === undefined ? 'dim' : v > 1 ? 'pos' : v < 1 ? 'neg' : 'neu')
export const fmtDateTime = (d, t) => (d ? `${d}${t ? ' ' + t : ''}` : '—')
export const MARKET_LABELS = {
  ACCION: 'Acción', CEDEAR: 'CEDEAR', FOREX: 'Forex', FUTURO: 'Futuro', CRIPTO: 'Cripto', OPCION: 'Opción',
  INDICE: 'Índice', MATERIA_PRIMA: 'Materia prima', BONO: 'Bono', OTRO: 'Otro',
}
export const OUTCOME_LABELS = { WIN: 'Ganadora', LOSS: 'Perdedora', BE: 'Breakeven' }
export const RECORD_LABELS = { BACKTEST: 'Backtesting', REAL: 'Real' }
