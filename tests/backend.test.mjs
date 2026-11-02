import test from 'node:test'
import assert from 'node:assert/strict'
import { makeD1 } from './d1shim.mjs'
import * as lab from '../functions/_lib/strategyLab.js'

const rejects = async (p, status, re) => {
  try { await p } catch (e) { assert.equal(e.status, status, `status ${e.status} (${e.message})`); if (re) assert.match(e.message, re); return }
  assert.fail('debía fallar')
}
const db = makeD1(['migrations/004_strategy_lab.sql'])
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`)

const rules = (extra = {}) => ({
  directionMode: 'BOTH', timeframes: ['1H', '1D'], indicators: ['HMA 50', 'RSI 14', 'MACD'],
  stopLossRule: 'Bajo el mínimo anterior', takeProfitRule: '2R', targetRr: 2,
  conditions: [
    { key: 'c-hma', kind: 'ENTRY', label: 'Precio cierra sobre HMA 50', indicator: 'HMA', operator: '>', params: { period: 50 }, required: true },
    { key: 'c-rsi', kind: 'ENTRY', label: 'RSI entre 50 y 70', indicator: 'RSI', params: { min: 50, max: 70 }, required: true },
    { key: 'c-vol', kind: 'FILTER', label: 'Confirmación por volumen', required: false },
  ],
  ...extra,
})

let S, v1, T1

test('crea estrategia con versión 1 y condiciones', async () => {
  S = await lab.createStrategy(db, { name: 'HMA 50 + RSI + MACD', description: 'tendencia', category: 'Tendencia', version: rules() })
  assert.equal(S.currentVersion, 1); assert.equal(S.versions.length, 1)
  v1 = S.current
  assert.equal(v1.conditions.length, 3); assert.deepEqual(v1.timeframes, ['1H', '1D'])
  assert.equal(v1.conditions.find((c) => c.key === 'c-rsi').params.max, 70)
  await rejects(lab.createStrategy(db, { name: 'hma 50 + rsi + macd', version: rules() }), 409)
  await rejects(lab.createStrategy(db, { name: '', version: rules() }), 400)
  await rejects(lab.createStrategy(db, { name: 'X', version: rules({ conditions: [{ label: '' }] }) }), 400)
})

const tradeBody = (o = {}) => ({
  strategyId: undefined, recordType: 'BACKTEST', symbol: 'nvda', direction: 'LONG', timeframe: '1H',
  entryDate: '2026-03-02', entryTime: '10:30', entryPrice: 100, stopLoss: 95, takeProfit: 110, quantity: 10, fees: 2,
  exitDate: '2026-03-02', exitTime: '15:30', exitPrice: 108,
  conditionResults: v1.conditions.map((c) => ({ conditionId: c.id, status: 'MET' })), ...o,
})

test('registra operación: R neto, cumplimiento, versión congelada', async () => {
  T1 = await lab.createTrade(db, tradeBody({ strategyId: S.id }))
  assert.equal(T1.symbol, 'NVDA'); assert.equal(T1.versionId, v1.id); assert.equal(T1.versionNumber, 1)
  close(T1.resultR, 1.56); close(T1.resultAmount, 78); assert.equal(T1.outcome, 'WIN')
  assert.equal(T1.compliance.bucket, 'FULL'); close(T1.compliance.pct, 100)
  assert.equal(T1.conditionResults.length, 3)
})

test('validaciones de operación', async () => {
  const b = (o) => tradeBody({ strategyId: S.id, ...o })
  await rejects(lab.createTrade(db, b({})), 409, /idéntica/)
  await rejects(lab.createTrade(db, b({ entryPrice: 101, timeframe: '15m' })), 400, /temporalidad/i)
  await rejects(lab.createTrade(db, b({ entryPrice: 101, stopLoss: 105 })), 400, /stop loss/)
  await rejects(lab.createTrade(db, b({ entryPrice: 101, conditionResults: [] })), 400, /condiciones/)
  await rejects(lab.createTrade(db, b({ entryPrice: 101, conditionResults: [{ conditionId: 9999, status: 'MET' }] })), 400)
  await rejects(lab.createTrade(db, b({ entryPrice: 101, exitPrice: undefined })), 400, /fecha Y precio/)
  await rejects(lab.createTrade(db, b({ entryPrice: 101, versionId: 9999 })), 400, /versión/)
})

test('operación pendiente: sin resultado ni outcome', async () => {
  const p = await lab.createTrade(db, tradeBody({ strategyId: S.id, recordType: 'REAL', entryPrice: 102, exitDate: null, exitTime: '', exitPrice: null,
    conditionResults: v1.conditions.map((c, i) => ({ conditionId: c.id, status: i === 0 ? 'MET' : i === 1 ? 'NOT_MET' : 'NA' })) }))
  assert.equal(p.status, 'PENDING'); assert.equal(p.outcome, null); assert.equal(p.resultR, null)
  assert.equal(p.compliance.bucket, 'PARTIAL'); close(p.compliance.pct, 50)
})

test('cambio de reglas con operaciones => versión 2; la 1 queda intacta', async () => {
  const newRules = rules({ conditions: rules().conditions.map((c) => (c.key === 'c-vol' ? { ...c, enabled: false } : c)).concat({ kind: 'ENTRY', label: 'MACD cruce alcista', required: true }) })
  const S2 = await lab.updateStrategy(db, S.id, { version: newRules, changeNote: 'Agrego MACD, desactivo volumen' })
  assert.equal(S2.saveOutcome, 'NEW_VERSION'); assert.equal(S2.currentVersion, 2); assert.equal(S2.versions.length, 2)
  const old = S2.versions.find((v) => v.versionNumber === 1)
  assert.equal(old.conditions.length, 3); assert.ok(old.conditions.every((c) => c.enabled)); assert.equal(old.tradeCount, 2)
  assert.equal(S2.versions.find((v) => v.versionNumber === 2).conditions.length, 4)
  const t = await lab.getTrade(db, T1.id)
  assert.equal(t.versionNumber, 1); assert.equal(t.compliance.bucket, 'FULL')
  // misma regla otra vez => no crea versión
  const S3 = await lab.updateStrategy(db, S.id, { version: S2.current }) // reenvío tal cual lo devolvió la API (con las keys)
  assert.equal(S3.saveOutcome, 'META_ONLY'); assert.equal(S3.versions.length, 2)
})

test('reordenar condiciones no genera versión; metadatos tampoco', async () => {
  const cur = (await lab.getStrategy(db, S.id)).current
  const reordered = { ...cur, conditions: [...cur.conditions].reverse() }
  const r = await lab.updateStrategy(db, S.id, { description: 'nueva desc', category: 'Momentum', version: reordered })
  assert.equal(r.saveOutcome, 'META_ONLY'); assert.equal(r.versions.length, 2); assert.equal(r.description, 'nueva desc')
})

test('versión 2: exige estado para las condiciones habilitadas, no para las deshabilitadas', async () => {
  const v2 = (await lab.getStrategy(db, S.id)).current
  const enabled = v2.conditions.filter((c) => c.enabled)
  assert.equal(enabled.length, 3)
  const t = await lab.createTrade(db, { ...tradeBody({ strategyId: S.id, entryPrice: 103 }), versionId: v2.id,
    conditionResults: enabled.map((c) => ({ conditionId: c.id, status: 'MET' })) })
  assert.equal(t.versionNumber, 2); assert.equal(t.compliance.applicable, 3)
  // una condición de v1 no vale en v2
  await rejects(lab.createTrade(db, { ...tradeBody({ strategyId: S.id, entryPrice: 104 }), versionId: v2.id }), 400)
})

test('estrategia sin operaciones: se corrige en el lugar, salvo forceNewVersion', async () => {
  const A = await lab.createStrategy(db, { name: 'Borrador', version: rules() })
  const A2 = await lab.updateStrategy(db, A.id, { version: rules({ timeframes: ['1D'] }) })
  assert.equal(A2.saveOutcome, 'UPDATED_IN_PLACE'); assert.equal(A2.versions.length, 1); assert.deepEqual(A2.current.timeframes, ['1D'])
  const A3 = await lab.updateStrategy(db, A.id, { version: rules({ timeframes: ['1D'] }), forceNewVersion: true })
  assert.equal(A3.saveOutcome, 'NEW_VERSION'); assert.equal(A3.versions.length, 2)
  await lab.removeStrategy(db, A.id)
  await rejects(lab.getStrategy(db, A.id), 404)
})

test('estrategia con operaciones no se elimina; archivada no acepta nuevas', async () => {
  await rejects(lab.removeStrategy(db, S.id), 409, /archivala/)
  await lab.updateStrategy(db, S.id, { status: 'ARCHIVED' })
  await rejects(lab.createTrade(db, tradeBody({ strategyId: S.id, entryPrice: 111 })), 400, /archivada/)
  await lab.updateStrategy(db, S.id, { status: 'ACTIVE' })
})

test('SHORT only: rechaza LONG', async () => {
  const B = await lab.createStrategy(db, { name: 'Solo cortos', version: rules({ directionMode: 'SHORT', conditions: [] }) })
  await rejects(lab.createTrade(db, { ...tradeBody({ strategyId: B.id }), conditionResults: [] }), 400, /solo admite/)
})

test('editar operación: cierra pendiente; versión/estrategia inmutables', async () => {
  const list = await lab.listTrades(db)
  const pending = list.find((t) => t.status === 'PENDING')
  const closed = await lab.updateTrade(db, pending.id, { exitDate: '2026-03-03', exitTime: '', exitPrice: 98, notes: 'cerrada' })
  assert.equal(closed.status, 'CLOSED'); assert.equal(closed.outcome, 'LOSS'); assert.equal(closed.notes, 'cerrada')
  close(closed.resultAmount, (98 - 102) * 10 - 2)
  await rejects(lab.updateTrade(db, pending.id, { versionId: 999 }), 400, /No se puede cambiar/)
  await rejects(lab.updateTrade(db, pending.id, { exitPrice: -1 }), 400)
  await rejects(lab.updateTrade(db, 99999, {}), 404)
  const re = await lab.updateTrade(db, pending.id, { conditionResults: v1.conditions.map((c) => ({ conditionId: c.id, status: 'NOT_MET' })) })
  assert.equal(re.compliance.bucket, 'NONE')
})

test('capturas: alta, límite, mime inválido, tamaño', async () => {
  const px = 'data:image/png;base64,iVBORw0KGgo='
  const a = await lab.addAttachment(db, T1.id, { filename: 'g.png', dataUrl: px })
  assert.equal((await lab.listAttachments(db, T1.id)).length, 1)
  assert.equal((await lab.getTrade(db, T1.id)).attachmentCount, 1)
  await rejects(lab.addAttachment(db, T1.id, { dataUrl: 'data:text/html;base64,AAAA' }), 400)
  await rejects(lab.addAttachment(db, T1.id, { dataUrl: 'data:image/png;base64,' + 'A'.repeat(1_500_000) }), 413)
  await lab.addAttachment(db, T1.id, { dataUrl: px }); await lab.addAttachment(db, T1.id, { dataUrl: px })
  await rejects(lab.addAttachment(db, T1.id, { dataUrl: px }), 409)
  await lab.removeAttachment(db, T1.id, a.id)
  await rejects(lab.removeAttachment(db, T1.id, a.id), 404)
})

test('eliminar operación borra resultados y capturas en cascada', async () => {
  await lab.removeTrade(db, T1.id)
  await rejects(lab.getTrade(db, T1.id), 404)
  const left = await db.prepare('SELECT COUNT(*) c FROM trade_condition_results WHERE trade_id = ?').bind(T1.id).first()
  const att = await db.prepare('SELECT COUNT(*) c FROM trade_attachments WHERE trade_id = ?').bind(T1.id).first()
  assert.equal(left.c, 0); assert.equal(att.c, 0)
  await rejects(lab.removeTrade(db, T1.id), 404)
})

test('la migración es idempotente', async () => {
  const fs = await import('node:fs')
  db.raw.exec(fs.readFileSync('migrations/004_strategy_lab.sql', 'utf8'))
  assert.ok((await lab.listStrategies(db)).length >= 2)
})
