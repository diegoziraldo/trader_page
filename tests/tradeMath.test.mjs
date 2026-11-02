import test from 'node:test'
import assert from 'node:assert/strict'
import { computeTrade, computeCompliance, validateTradeInput } from '../src/services/strategyLab/tradeMath.js'

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`)
const base = { recordType: 'BACKTEST', symbol: 'NVDA', direction: 'LONG', entryDate: '2026-03-02', entryTime: '10:30', timeframe: '1H', entryPrice: 100 }

test('LONG ganador con cantidad y comisiones: R neto', () => {
  const r = computeTrade({ ...base, stopLoss: 95, takeProfit: 110, quantity: 10, fees: 2, exitPrice: 108, exitDate: '2026-03-02', exitTime: '15:30' })
  close(r.resultAmount, 78)
  close(r.riskMoney, 50)
  close(r.resultR, 1.56)
  assert.equal(r.rBasis, 'NET'); assert.equal(r.outcome, 'WIN')
  close(r.plannedRR, 2)
  close(r.resultPct, 7.8)
  assert.equal(r.durationMinutes, 300)
})

test('SHORT ganador sin cantidad: R bruto por precio', () => {
  const r = computeTrade({ ...base, direction: 'SHORT', stopLoss: 105, exitPrice: 90, exitDate: '2026-03-03' })
  close(r.resultR, 2); assert.equal(r.rBasis, 'GROSS'); assert.equal(r.resultAmount, null)
  close(r.resultPct, 10); assert.equal(r.outcome, 'WIN'); assert.equal(r.durationDays, 1)
})

test('LONG perdedor exacto en el stop = -1R', () => {
  const r = computeTrade({ ...base, stopLoss: 95, exitPrice: 95, exitDate: '2026-03-02' })
  close(r.resultR, -1); assert.equal(r.outcome, 'LOSS')
})

test('breakeven por tolerancia de R', () => {
  const r = computeTrade({ ...base, stopLoss: 90, exitPrice: 100.2, exitDate: '2026-03-02' })
  assert.equal(r.outcome, 'BE')
})

test('sin stop ni riesgo: R null, clasifica por %', () => {
  const r = computeTrade({ ...base, exitPrice: 103, exitDate: '2026-03-02' })
  assert.equal(r.resultR, null); close(r.resultPct, 3); assert.equal(r.outcome, 'WIN')
})

test('sin stop pero con riesgo declarado y cantidad', () => {
  const r = computeTrade({ ...base, quantity: 5, riskAmount: 25, exitPrice: 110, exitDate: '2026-03-02' })
  close(r.resultAmount, 50); close(r.resultR, 2)
})

test('pendiente no tiene resultado ni outcome', () => {
  const r = computeTrade({ ...base, stopLoss: 95 })
  assert.equal(r.status, 'PENDING'); assert.equal(r.outcome, null); assert.equal(r.resultR, null)
})

test('weekday / hora / mes', () => {
  const r = computeTrade(base)
  assert.equal(r.weekday, 1); assert.equal(r.entryHour, 10); assert.equal(r.entryMonth, '2026-03')
})

test('cumplimiento: NA no cuenta, buckets', () => {
  const c = computeCompliance([{ status: 'MET', required: true }, { status: 'NOT_MET', required: false }, { status: 'NA', required: true }, { status: 'MET', required: false }])
  assert.equal(c.applicable, 3); close(c.pct, 66.6666666667, 1e-6); assert.equal(c.bucket, 'PARTIAL')
  assert.equal(c.requiredApplicable, 1); close(c.requiredPct, 100)
  assert.equal(computeCompliance([{ status: 'MET' }]).bucket, 'FULL')
  assert.equal(computeCompliance([{ status: 'NOT_MET' }]).bucket, 'NONE')
  assert.equal(computeCompliance([{ status: 'NA' }]).bucket, 'UNKNOWN')
})

test('validación: lados de stop/tp, par de salida, restricciones de versión', () => {
  assert.equal(validateTradeInput({ ...base, stopLoss: 95, takeProfit: 110 }).length, 0)
  assert.ok(validateTradeInput({ ...base, stopLoss: 105 }).some((e) => /stop loss/.test(e)))
  assert.ok(validateTradeInput({ ...base, direction: 'SHORT', takeProfit: 110 }).some((e) => /take profit/.test(e)))
  assert.ok(validateTradeInput({ ...base, exitPrice: 100 }).some((e) => /fecha Y precio/.test(e)))
  assert.ok(validateTradeInput({ ...base, exitPrice: 100, exitDate: '2026-03-01' }).some((e) => /anterior/.test(e)))
  assert.ok(validateTradeInput(base, { directionMode: 'SHORT' }).some((e) => /solo admite/.test(e)))
  assert.ok(validateTradeInput(base, { timeframes: ['1D'] }).some((e) => /temporalidad/i.test(e)))
  assert.ok(validateTradeInput({ ...base, entryDate: '2026-02-30' }).some((e) => /fecha de entrada/.test(e)))
})
