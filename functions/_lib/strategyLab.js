// functions/_lib/strategyLab.js
//
// Lógica de Strategy Lab sobre Cloudflare D1. Mismo estilo que
// functions/_lib/journal.js: los errores se lanzan como { status, message } y
// el router los traduce a JSON. Todo cálculo derivado sale de tradeMath.js
// (compartido con el frontend), no se reimplementa acá.

import {
  DIRECTION_MODES, CONDITION_KINDS, CONDITION_STATUSES, INSTRUMENT_TYPES, RECORD_TYPES,
  computeTrade, computeCompliance, validateTradeInput, toNum,
} from '../../src/services/strategyLab/tradeMath.js'

const fail = (status, message) => { throw { status, message } }
const str = (v, max = 2000) => String(v ?? '').trim().slice(0, max)
const numOrNull = (v) => (v === null || v === undefined || v === '' ? null : Number(v))
const parseJson = (s, fallback) => { try { return JSON.parse(s) } catch { return fallback } }
const uuid = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `k${Date.now()}${Math.random().toString(16).slice(2)}`)

function canonicalParams(obj) {
  const out = {}
  for (const k of Object.keys(obj || {}).sort()) out[k] = obj[k]
  return out
}

// ---------------------------------------------------------------------------
// ESTRATEGIAS
// ---------------------------------------------------------------------------

// Valida y normaliza la parte "versionable" (las reglas).
export function normalizeVersionInput(v) {
  const errors = []
  if (!v || typeof v !== 'object') return { errors: ['Faltan las reglas de la estrategia'] }
  const directionMode = v.directionMode || 'BOTH'
  if (!DIRECTION_MODES.includes(directionMode)) errors.push('El tipo de operación debe ser LONG, SHORT o BOTH')

  const clean = (arr) => [...new Set((Array.isArray(arr) ? arr : []).map((x) => str(x, 40)).filter(Boolean))]
  const timeframes = clean(v.timeframes)
  const indicators = clean(v.indicators)
  const targetRr = numOrNull(v.targetRr)
  if (targetRr !== null && !(targetRr > 0)) errors.push('La relación riesgo/beneficio objetivo debe ser mayor a 0')

  const seen = new Set()
  const conditions = (Array.isArray(v.conditions) ? v.conditions : []).map((c, i) => {
    const kind = c.kind || 'ENTRY'
    if (!CONDITION_KINDS.includes(kind)) errors.push(`Condición ${i + 1}: tipo inválido`)
    const label = str(c.label, 200)
    if (!label) errors.push(`Condición ${i + 1}: el texto es requerido`)
    const key = str(c.key, 80) || uuid()
    if (seen.has(key)) errors.push(`Condición ${i + 1}: clave duplicada`)
    seen.add(key)
    const params = c.params && typeof c.params === 'object' && !Array.isArray(c.params) ? canonicalParams(c.params) : {}
    return {
      key, kind, label,
      indicator: str(c.indicator, 80), operator: str(c.operator, 40), params,
      required: c.required === false || c.required === 0 ? 0 : 1,
      enabled: c.enabled === false || c.enabled === 0 ? 0 : 1,
      position: i,
    }
  })

  const normalized = {
    directionMode, timeframes, indicators,
    stopLossRule: str(v.stopLossRule), takeProfitRule: str(v.takeProfitRule), targetRr,
    conditions,
  }
  // La firma ignora el orden (position) y el orden de timeframes/indicadores:
  // reordenar no cambia las reglas.
  const signature = JSON.stringify({
    directionMode, timeframes: [...timeframes].sort(), indicators: [...indicators].sort(),
    stopLossRule: normalized.stopLossRule, takeProfitRule: normalized.takeProfitRule, targetRr,
    conditions: [...conditions].sort((a, b) => a.key.localeCompare(b.key)).map((c) => ({
      key: c.key, kind: c.kind, label: c.label, indicator: c.indicator, operator: c.operator,
      params: c.params, required: c.required, enabled: c.enabled,
    })),
  })
  return { errors, normalized, signature }
}

function formatCondition(r) {
  return {
    id: r.id, key: r.condition_key, kind: r.kind, label: r.label, indicator: r.indicator,
    operator: r.operator, params: parseJson(r.params, {}), required: !!r.required,
    enabled: !!r.enabled, position: r.position,
  }
}

function formatVersion(row, conditions, tradeCount) {
  return {
    id: row.id, strategyId: row.strategy_id, versionNumber: row.version_number,
    directionMode: row.direction_mode, timeframes: parseJson(row.timeframes, []),
    indicators: parseJson(row.indicators, []), stopLossRule: row.stop_loss_rule,
    takeProfitRule: row.take_profit_rule, targetRr: row.target_rr,
    changeNote: row.change_note, createdAt: row.created_at,
    tradeCount: tradeCount ?? 0,
    conditions: (conditions || []).sort((a, b) => a.position - b.position).map(formatCondition),
  }
}

async function loadStrategies(db, onlyId = null) {
  const where = onlyId ? 'WHERE s.id = ?' : ''
  const bind = onlyId ? [onlyId] : []
  const { results: strategies } = await db
    .prepare(`SELECT s.*, (SELECT COUNT(*) FROM strategy_trades t WHERE t.strategy_id = s.id) AS trade_count
              FROM strategies s ${where} ORDER BY s.status ASC, s.name COLLATE NOCASE ASC`)
    .bind(...bind).all()
  if (!strategies.length) return []
  const { results: versions } = await db
    .prepare(`SELECT v.*, (SELECT COUNT(*) FROM strategy_trades t WHERE t.version_id = v.id) AS trade_count
              FROM strategy_versions v ${onlyId ? 'WHERE v.strategy_id = ?' : ''} ORDER BY v.version_number DESC`)
    .bind(...bind).all()
  const { results: conds } = await db
    .prepare(`SELECT c.* FROM strategy_conditions c JOIN strategy_versions v ON v.id = c.version_id
              ${onlyId ? 'WHERE v.strategy_id = ?' : ''}`)
    .bind(...bind).all()
  const condsByVersion = new Map()
  for (const c of conds) {
    if (!condsByVersion.has(c.version_id)) condsByVersion.set(c.version_id, [])
    condsByVersion.get(c.version_id).push(c)
  }
  return strategies.map((s) => {
    const vs = versions.filter((v) => v.strategy_id === s.id).map((v) => formatVersion(v, condsByVersion.get(v.id), v.trade_count))
    return {
      id: s.id, name: s.name, description: s.description, category: s.category, notes: s.notes,
      status: s.status, currentVersion: s.current_version, tradeCount: s.trade_count,
      createdAt: s.created_at, updatedAt: s.updated_at,
      versions: vs,
      current: vs.find((v) => v.versionNumber === s.current_version) || vs[0] || null,
    }
  })
}

export const listStrategies = (db) => loadStrategies(db)

export async function getStrategy(db, id) {
  const [s] = await loadStrategies(db, Number(id))
  if (!s) fail(404, 'Estrategia no encontrada')
  return s
}

function validateMeta(body, requireName) {
  const errors = []
  const name = str(body.name, 80)
  if (requireName && !name) errors.push('El nombre es requerido')
  if (body.status !== undefined && !['ACTIVE', 'ARCHIVED'].includes(body.status)) errors.push('Estado inválido')
  return errors
}

const versionInsert = (db, strategyIdSql, strategyIdBind, versionNumber, n, signature, note) =>
  db.prepare(
    `INSERT INTO strategy_versions (strategy_id, version_number, direction_mode, timeframes, indicators,
       stop_loss_rule, take_profit_rule, target_rr, signature, change_note)
     VALUES (${strategyIdSql}, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(...strategyIdBind, versionNumber, n.directionMode, JSON.stringify(n.timeframes), JSON.stringify(n.indicators),
    n.stopLossRule, n.takeProfitRule, n.targetRr, signature, note)

const conditionInserts = (db, versionIdSql, versionIdBind, conditions) =>
  conditions.map((c) =>
    db.prepare(
      `INSERT INTO strategy_conditions (version_id, condition_key, kind, label, indicator, operator, params, required, enabled, position)
       VALUES (${versionIdSql}, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(...versionIdBind, c.key, c.kind, c.label, c.indicator, c.operator, JSON.stringify(c.params), c.required, c.enabled, c.position)
  )

const isUniqueError = (e) => /UNIQUE|constraint/i.test(String(e?.message || e))

export async function createStrategy(db, body) {
  const errors = validateMeta(body, true)
  const v = normalizeVersionInput(body.version || {})
  errors.push(...v.errors)
  if (errors.length) fail(400, errors.join('. '))

  const name = str(body.name, 80)
  const exists = await db.prepare('SELECT id FROM strategies WHERE name = ? COLLATE NOCASE').bind(name).first()
  if (exists) fail(409, `Ya existe una estrategia llamada "${name}"`)

  const stmts = [
    db.prepare('INSERT INTO strategies (name, description, category, notes, status, current_version) VALUES (?, ?, ?, ?, ?, 1)')
      .bind(name, str(body.description), str(body.category, 80), str(body.notes), body.status === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE'),
    versionInsert(db, '(SELECT id FROM strategies WHERE name = ? COLLATE NOCASE)', [name], 1, v.normalized, v.signature, 'Versión inicial'),
    ...conditionInserts(db, '(SELECT sv.id FROM strategy_versions sv JOIN strategies s ON s.id = sv.strategy_id WHERE s.name = ? COLLATE NOCASE AND sv.version_number = 1)', [name], v.normalized.conditions),
  ]
  try { await db.batch(stmts) } catch (e) {
    if (isUniqueError(e)) fail(409, `Ya existe una estrategia llamada "${name}"`)
    throw e
  }
  const created = await db.prepare('SELECT id FROM strategies WHERE name = ? COLLATE NOCASE').bind(name).first()
  return getStrategy(db, created.id)
}

// Edita metadatos y/o reglas.
//  - Cambios de metadatos (nombre, descripción, categoría, notas, estado): nunca versionan.
//  - Si las reglas cambian (firma distinta):
//      * versión vigente CON operaciones -> se crea una versión nueva (la vieja queda intacta);
//      * versión vigente SIN operaciones -> se corrige en el lugar (nadie la usó todavía),
//        salvo que el usuario pida `forceNewVersion`.
export async function updateStrategy(db, id, body) {
  const s = await getStrategy(db, id)
  const errors = validateMeta({ ...body, name: body.name ?? s.name }, true)
  let v = null
  if (body.version) {
    v = normalizeVersionInput(body.version)
    errors.push(...v.errors)
  }
  if (errors.length) fail(400, errors.join('. '))

  const name = body.name !== undefined ? str(body.name, 80) : s.name
  if (name.toLowerCase() !== s.name.toLowerCase()) {
    const dup = await db.prepare('SELECT id FROM strategies WHERE name = ? COLLATE NOCASE AND id <> ?').bind(name, s.id).first()
    if (dup) fail(409, `Ya existe una estrategia llamada "${name}"`)
  }

  const metaStmt = db.prepare(
    `UPDATE strategies SET name = ?, description = ?, category = ?, notes = ?, status = ?, updated_at = datetime('now') WHERE id = ?`
  ).bind(
    name, body.description !== undefined ? str(body.description) : s.description,
    body.category !== undefined ? str(body.category, 80) : s.category,
    body.notes !== undefined ? str(body.notes) : s.notes,
    body.status ?? s.status, s.id
  )
  const stmts = [metaStmt]
  let outcome = 'META_ONLY'

  if (v) {
    const cur = await db.prepare('SELECT * FROM strategy_versions WHERE strategy_id = ? AND version_number = ?').bind(s.id, s.currentVersion).first()
    const changed = cur.signature !== v.signature
    if (changed || body.forceNewVersion) {
      const used = s.current.tradeCount > 0
      if (!used && !body.forceNewVersion) {
        outcome = 'UPDATED_IN_PLACE'
        stmts.push(
          db.prepare('DELETE FROM strategy_conditions WHERE version_id = ?').bind(cur.id),
          db.prepare(`UPDATE strategy_versions SET direction_mode = ?, timeframes = ?, indicators = ?, stop_loss_rule = ?,
                      take_profit_rule = ?, target_rr = ?, signature = ? WHERE id = ?`)
            .bind(v.normalized.directionMode, JSON.stringify(v.normalized.timeframes), JSON.stringify(v.normalized.indicators),
              v.normalized.stopLossRule, v.normalized.takeProfitRule, v.normalized.targetRr, v.signature, cur.id),
          ...conditionInserts(db, '?', [cur.id], v.normalized.conditions)
        )
      } else {
        outcome = 'NEW_VERSION'
        const next = (await db.prepare('SELECT MAX(version_number) AS m FROM strategy_versions WHERE strategy_id = ?').bind(s.id).first()).m + 1
        stmts.push(
          versionInsert(db, '?', [s.id], next, v.normalized, v.signature, str(body.changeNote, 300)),
          ...conditionInserts(db, '(SELECT id FROM strategy_versions WHERE strategy_id = ? AND version_number = ?)', [s.id, next], v.normalized.conditions),
          db.prepare('UPDATE strategies SET current_version = ? WHERE id = ?').bind(next, s.id)
        )
      }
    }
  }

  try { await db.batch(stmts) } catch (e) {
    if (isUniqueError(e)) fail(409, 'Conflicto al guardar: probá de nuevo')
    throw e
  }
  return { ...(await getStrategy(db, s.id)), saveOutcome: outcome }
}

export async function removeStrategy(db, id) {
  const s = await getStrategy(db, id)
  if (s.tradeCount > 0) {
    fail(409, `La estrategia tiene ${s.tradeCount} operaciones registradas. Para no perder el historial, archivala en lugar de eliminarla (o eliminá primero sus operaciones).`)
  }
  await db.prepare('DELETE FROM strategies WHERE id = ?').bind(s.id).run()
}

// ---------------------------------------------------------------------------
// OPERACIONES
// ---------------------------------------------------------------------------

function toInputShape(row) {
  return {
    recordType: row.record_type, symbol: row.symbol, direction: row.direction, timeframe: row.timeframe,
    entryDate: row.entry_date, entryTime: row.entry_time, entryPrice: row.entry_price,
    stopLoss: row.stop_loss, takeProfit: row.take_profit, quantity: row.quantity,
    riskAmount: row.risk_amount, riskPercent: row.risk_percent,
    exitDate: row.exit_date, exitTime: row.exit_time, exitPrice: row.exit_price, fees: row.fees,
  }
}

function formatTrade(row, condRows) {
  const derived = computeTrade(toInputShape(row))
  const conditionResults = (condRows || []).map((c) => ({
    conditionId: c.condition_id, key: c.condition_key, label: c.label, kind: c.kind,
    required: !!c.required, enabled: !!c.enabled, status: c.status,
  }))
  const compliance = computeCompliance(conditionResults.filter((c) => c.enabled))
  return {
    id: row.id, strategyId: row.strategy_id, strategyName: row.strategy_name, versionId: row.version_id,
    versionNumber: row.version_number, recordType: row.record_type, symbol: row.symbol, assetName: row.asset_name,
    market: row.market, instrumentType: row.instrument_type, direction: row.direction, timeframe: row.timeframe,
    entryDate: row.entry_date, entryTime: row.entry_time, entryPrice: row.entry_price, stopLoss: row.stop_loss,
    takeProfit: row.take_profit, riskAmount: row.risk_amount, riskPercent: row.risk_percent, quantity: row.quantity,
    exitDate: row.exit_date, exitTime: row.exit_time, exitPrice: row.exit_price, fees: row.fees,
    currency: row.currency, notes: row.notes, attachmentCount: row.attachment_count ?? 0,
    createdAt: row.created_at, updatedAt: row.updated_at,
    ...derived, conditionResults, compliance,
  }
}

const TRADE_SELECT = `
  SELECT t.*, s.name AS strategy_name, v.version_number,
         (SELECT COUNT(*) FROM trade_attachments a WHERE a.trade_id = t.id) AS attachment_count
  FROM strategy_trades t
  JOIN strategies s ON s.id = t.strategy_id
  JOIN strategy_versions v ON v.id = t.version_id`

const RESULT_SELECT = `
  SELECT r.trade_id, r.condition_id, r.status, c.condition_key, c.label, c.kind, c.required, c.enabled
  FROM trade_condition_results r JOIN strategy_conditions c ON c.id = r.condition_id`

function groupBy(rows, key) {
  const m = new Map()
  for (const r of rows) { if (!m.has(r[key])) m.set(r[key], []); m.get(r[key]).push(r) }
  return m
}

export async function listTrades(db) {
  const { results: trades } = await db.prepare(`${TRADE_SELECT} ORDER BY t.entry_date DESC, t.entry_time DESC, t.id DESC`).all()
  const { results: res } = await db.prepare(RESULT_SELECT).all()
  const byTrade = groupBy(res, 'trade_id')
  return trades.map((t) => formatTrade(t, byTrade.get(t.id)))
}

export async function getTrade(db, id) {
  const row = await db.prepare(`${TRADE_SELECT} WHERE t.id = ?`).bind(id).first()
  if (!row) fail(404, 'Operación no encontrada')
  const { results: res } = await db.prepare(`${RESULT_SELECT} WHERE r.trade_id = ?`).bind(id).all()
  return formatTrade(row, res)
}

// Prepara y valida el payload de una operación contra su estrategia/versión.
async function prepareTrade(db, body, { strategyId, versionId }) {
  const strategy = await db.prepare('SELECT * FROM strategies WHERE id = ?').bind(strategyId).first()
  if (!strategy) fail(400, 'La estrategia indicada no existe')
  const version = await db.prepare('SELECT * FROM strategy_versions WHERE id = ? AND strategy_id = ?').bind(versionId, strategyId).first()
  if (!version) fail(400, 'La versión indicada no pertenece a la estrategia')

  const input = {
    recordType: body.recordType, symbol: str(body.symbol, 30).toUpperCase(), direction: body.direction,
    timeframe: str(body.timeframe, 20), entryDate: body.entryDate, entryTime: str(body.entryTime, 5),
    entryPrice: body.entryPrice, stopLoss: body.stopLoss, takeProfit: body.takeProfit, quantity: body.quantity,
    riskAmount: body.riskAmount, riskPercent: body.riskPercent, exitDate: body.exitDate || null,
    exitTime: str(body.exitTime, 5), exitPrice: body.exitPrice, fees: body.fees,
  }
  const errors = validateTradeInput(input, { directionMode: version.direction_mode, timeframes: parseJson(version.timeframes, []) })
  const instrumentType = body.instrumentType || 'ACCION'
  if (!INSTRUMENT_TYPES.includes(instrumentType)) errors.push('Tipo de instrumento inválido')
  if (!RECORD_TYPES.includes(body.recordType)) errors.push('Tipo de registro inválido')

  // Condiciones: cada condición HABILITADA de la versión necesita un estado explícito.
  const { results: conds } = await db.prepare('SELECT id, enabled FROM strategy_conditions WHERE version_id = ?').bind(versionId).all()
  const enabledIds = new Set(conds.filter((c) => c.enabled).map((c) => c.id))
  const allIds = new Set(conds.map((c) => c.id))
  let results = null
  if (body.conditionResults !== undefined) {
    results = new Map()
    for (const r of body.conditionResults || []) {
      const cid = Number(r.conditionId)
      if (!allIds.has(cid)) { errors.push('Se envió el resultado de una condición que no pertenece a esta versión'); continue }
      if (!CONDITION_STATUSES.includes(r.status)) { errors.push('Estado de condición inválido'); continue }
      results.set(cid, r.status)
    }
    for (const cid of enabledIds) if (!results.has(cid)) errors.push('Falta marcar el estado de todas las condiciones de la estrategia')
  }
  return { errors, strategy, version, input, instrumentType, results }
}

const tradeValues = (b, input, instrumentType) => [
  input.recordType, input.symbol, str(b.assetName, 120), str(b.market, 60), instrumentType, input.direction,
  input.timeframe, input.entryDate, input.entryTime || '', Number(input.entryPrice),
  numOrNull(input.stopLoss), numOrNull(input.takeProfit), numOrNull(input.riskAmount), numOrNull(input.riskPercent),
  numOrNull(input.quantity), input.exitDate || null, input.exitTime || '', numOrNull(input.exitPrice),
  toNum(input.fees) || 0, str(b.currency, 10), str(b.notes, 4000),
]

const DUP_MSG = 'Ya existe una operación idéntica (misma estrategia, tipo, activo, temporalidad, dirección, fecha, hora y precio de entrada)'

export async function createTrade(db, body) {
  const strategyId = Number(body.strategyId)
  if (!strategyId) fail(400, 'La estrategia es requerida')
  let versionId = Number(body.versionId)
  if (!versionId) {
    const s = await db.prepare('SELECT current_version FROM strategies WHERE id = ?').bind(strategyId).first()
    if (!s) fail(400, 'La estrategia indicada no existe')
    versionId = (await db.prepare('SELECT id FROM strategy_versions WHERE strategy_id = ? AND version_number = ?').bind(strategyId, s.current_version).first()).id
  }
  const p = await prepareTrade(db, body, { strategyId, versionId })
  if (p.strategy.status === 'ARCHIVED') p.errors.push('La estrategia está archivada: reactivala para registrar nuevas operaciones')
  if (p.results === null) p.errors.push('Falta marcar el estado de las condiciones')
  if (p.errors.length) fail(400, p.errors.join('. '))

  let info
  try {
    info = await db.prepare(
      `INSERT INTO strategy_trades (strategy_id, version_id, record_type, symbol, asset_name, market, instrument_type,
         direction, timeframe, entry_date, entry_time, entry_price, stop_loss, take_profit, risk_amount, risk_percent,
         quantity, exit_date, exit_time, exit_price, fees, currency, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(strategyId, versionId, ...tradeValues(body, p.input, p.instrumentType)).run()
  } catch (e) {
    if (isUniqueError(e)) fail(409, DUP_MSG)
    throw e
  }
  const tradeId = info.meta.last_row_id
  try {
    if (p.results.size) {
      await db.batch([...p.results].map(([cid, status]) =>
        db.prepare('INSERT INTO trade_condition_results (trade_id, condition_id, status) VALUES (?, ?, ?)').bind(tradeId, cid, status)))
    }
  } catch (e) {
    await db.prepare('DELETE FROM strategy_trades WHERE id = ?').bind(tradeId).run()
    throw e
  }
  return getTrade(db, tradeId)
}

// La estrategia y la versión de una operación son inmutables: es lo que
// garantiza que las reglas históricas nunca cambian retroactivamente.
export async function updateTrade(db, id, body) {
  const existing = await db.prepare('SELECT * FROM strategy_trades WHERE id = ?').bind(id).first()
  if (!existing) fail(404, 'Operación no encontrada')
  if ((body.strategyId && Number(body.strategyId) !== existing.strategy_id) || (body.versionId && Number(body.versionId) !== existing.version_id)) {
    fail(400, 'No se puede cambiar la estrategia ni la versión de una operación ya registrada. Eliminala y cargala de nuevo.')
  }
  const merged = { ...toInputShape(existing), assetName: existing.asset_name, market: existing.market,
    instrumentType: existing.instrument_type, currency: existing.currency, notes: existing.notes, ...body }
  const p = await prepareTrade(db, merged, { strategyId: existing.strategy_id, versionId: existing.version_id })
  if (p.errors.length) fail(400, p.errors.join('. '))

  const stmts = [
    db.prepare(
      `UPDATE strategy_trades SET record_type = ?, symbol = ?, asset_name = ?, market = ?, instrument_type = ?, direction = ?,
         timeframe = ?, entry_date = ?, entry_time = ?, entry_price = ?, stop_loss = ?, take_profit = ?, risk_amount = ?,
         risk_percent = ?, quantity = ?, exit_date = ?, exit_time = ?, exit_price = ?, fees = ?, currency = ?, notes = ?,
         updated_at = datetime('now') WHERE id = ?`
    ).bind(...tradeValues(merged, p.input, p.instrumentType), id),
  ]
  if (p.results !== null) {
    stmts.push(db.prepare('DELETE FROM trade_condition_results WHERE trade_id = ?').bind(id))
    for (const [cid, status] of p.results) {
      stmts.push(db.prepare('INSERT INTO trade_condition_results (trade_id, condition_id, status) VALUES (?, ?, ?)').bind(id, cid, status))
    }
  }
  try { await db.batch(stmts) } catch (e) {
    if (isUniqueError(e)) fail(409, DUP_MSG)
    throw e
  }
  return getTrade(db, id)
}

export async function removeTrade(db, id) {
  const r = await db.prepare('DELETE FROM strategy_trades WHERE id = ?').bind(id).run()
  if (r.meta.changes === 0) fail(404, 'Operación no encontrada')
}

// ---------------------------------------------------------------------------
// CAPTURAS
// ---------------------------------------------------------------------------
const MAX_ATTACHMENTS = 3
const MAX_DATA_URL_CHARS = 1_400_000
const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp']

export async function listAttachments(db, tradeId) {
  const { results } = await db.prepare('SELECT * FROM trade_attachments WHERE trade_id = ? ORDER BY id').bind(tradeId).all()
  return results.map((a) => ({ id: a.id, tradeId: a.trade_id, filename: a.filename, mime: a.mime, sizeBytes: a.size_bytes, dataUrl: a.data_url, createdAt: a.created_at }))
}

export async function addAttachment(db, tradeId, body) {
  const trade = await db.prepare('SELECT id FROM strategy_trades WHERE id = ?').bind(tradeId).first()
  if (!trade) fail(404, 'Operación no encontrada')
  const m = /^data:(image\/(?:png|jpeg|webp));base64,[A-Za-z0-9+/=]+$/.exec(body.dataUrl || '')
  if (!m || !ALLOWED_MIME.includes(m[1])) fail(400, 'La captura debe ser una imagen PNG, JPEG o WEBP')
  if (body.dataUrl.length > MAX_DATA_URL_CHARS) fail(413, 'La imagen es demasiado grande (máx. ~1 MB). Probá con una captura más chica.')
  const { c } = await db.prepare('SELECT COUNT(*) AS c FROM trade_attachments WHERE trade_id = ?').bind(tradeId).first()
  if (c >= MAX_ATTACHMENTS) fail(409, `Máximo ${MAX_ATTACHMENTS} capturas por operación`)
  const info = await db.prepare('INSERT INTO trade_attachments (trade_id, filename, mime, size_bytes, data_url) VALUES (?, ?, ?, ?, ?)')
    .bind(tradeId, str(body.filename, 120), m[1], Math.floor((body.dataUrl.length * 3) / 4), body.dataUrl).run()
  const row = await db.prepare('SELECT * FROM trade_attachments WHERE id = ?').bind(info.meta.last_row_id).first()
  return { id: row.id, tradeId: row.trade_id, filename: row.filename, mime: row.mime, sizeBytes: row.size_bytes, dataUrl: row.data_url, createdAt: row.created_at }
}

export async function removeAttachment(db, tradeId, attachmentId) {
  const r = await db.prepare('DELETE FROM trade_attachments WHERE id = ? AND trade_id = ?').bind(attachmentId, tradeId).run()
  if (r.meta.changes === 0) fail(404, 'Captura no encontrada')
}
