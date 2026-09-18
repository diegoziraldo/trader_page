// Respaldo local de persistencia para cuando no existe API/D1/SQLite.
// Los IDs negativos identifican registros creados únicamente en el navegador.
// Los registros remotos se cachean también para permitir continuar trabajando
// durante una caída temporal del backend.

const KEYS = Object.freeze({
  alerts: 'vue-finanzas:alerts:v2',
  watchlist: 'vue-finanzas:watchlist-us:v2',
  checklist: 'vue-finanzas:checklist:v2',
  trades: 'vue-finanzas:trades:v2',
  journal: 'vue-finanzas:journal:v2',
})

const memoryStore = new Map()
let localSequence = 0

function nowSql() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ')
}

function nextLocalId() {
  localSequence = (localSequence + 1) % 1000
  return -(Date.now() * 1000 + localSequence)
}

export function isLocalId(id) {
  const n = Number(id)
  return Number.isFinite(n) && n < 0
}

function read(key, fallback) {
  if (!globalThis.localStorage) {
    return memoryStore.has(key) ? memoryStore.get(key) : fallback
  }
  try {
    const raw = globalThis.localStorage.getItem(key)
    if (raw == null) return memoryStore.has(key) ? memoryStore.get(key) : fallback
    return JSON.parse(raw)
  } catch {
    return memoryStore.has(key) ? memoryStore.get(key) : fallback
  }
}

function write(key, value) {
  memoryStore.set(key, value)
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value))
  } catch {
    // El modo memoria mantiene el funcionamiento durante cuotas/incógnito.
  }
}

function removeFrom(array, predicate) {
  return array.filter((item) => !predicate(item))
}

function mergeRemoteAndLocal(remoteRows, key, isLocalOnly = (row) => isLocalId(row.id)) {
  const localRows = read(key, []).filter(isLocalOnly)
  const remoteIds = new Set(remoteRows.map((row) => String(row.id)))
  const uniqueLocal = localRows.filter((row) => !remoteIds.has(String(row.id)))
  return [...remoteRows, ...uniqueLocal]
}

function saveCollection(key, remoteRows) {
  const localOnly = read(key, []).filter((row) => isLocalId(row.id))
  const seen = new Set()
  const merged = []
  for (const row of [...remoteRows, ...localOnly]) {
    const identity = String(row.id)
    if (seen.has(identity)) continue
    seen.add(identity)
    merged.push(row)
  }
  write(key, merged)
}

// ---------- Alerts ----------
function formatAlert(row) {
  return {
    id: row.id,
    ticker: row.ticker,
    type: row.type,
    price: row.price,
    triggered: !!row.triggered,
    created_at: row.created_at || nowSql(),
    updated_at: row.updated_at || nowSql(),
  }
}

export function localGetAlerts() {
  return read(KEYS.alerts, []).map(formatAlert).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
}

export function localCreateAlert(body) {
  const ticker = String(body.ticker || '').trim().toUpperCase()
  if (!ticker) throw new Error('ticker es requerido')
  const type = body.type || 'IN'
  if (!['IN', 'TARGET', 'STOP_LOSS'].includes(type)) throw new Error("type debe ser 'IN', 'TARGET' o 'STOP_LOSS'")
  const row = formatAlert({
    id: nextLocalId(),
    ticker,
    type,
    price: body.price ?? null,
    triggered: false,
    created_at: nowSql(),
    updated_at: nowSql(),
  })
  write(KEYS.alerts, [row, ...read(KEYS.alerts, [])])
  return row
}

export function localUpdateAlert(id, body) {
  const rows = read(KEYS.alerts, [])
  const index = rows.findIndex((row) => String(row.id) === String(id))
  if (index < 0) throw new Error('Alerta no encontrada')
  const current = rows[index]
  const updated = formatAlert({
    ...current,
    ticker: body.ticker !== undefined ? String(body.ticker).trim().toUpperCase() : current.ticker,
    type: body.type !== undefined ? body.type : current.type,
    price: body.price !== undefined ? body.price : current.price,
    triggered: body.triggered !== undefined ? !!body.triggered : !!current.triggered,
    updated_at: nowSql(),
  })
  rows[index] = updated
  write(KEYS.alerts, rows)
  return updated
}

export function localDeleteAlert(id) {
  const rows = read(KEYS.alerts, [])
  const next = removeFrom(rows, (row) => String(row.id) === String(id))
  if (next.length === rows.length) throw new Error('Alerta no encontrada')
  write(KEYS.alerts, next)
}

export function cacheAlerts(rows) {
  saveCollection(KEYS.alerts, rows.map(formatAlert))
}

// ---------- Watchlist USA ----------
const DEFAULT_WATCHLIST = [
  { id: 1, symbol: 'AAPL', name: 'Apple', position: 0 },
  { id: 2, symbol: 'MSFT', name: 'Microsoft', position: 1 },
  { id: 3, symbol: 'TSLA', name: 'Tesla', position: 2 },
  { id: 4, symbol: 'NVDA', name: 'NVIDIA', position: 3 },
  { id: 5, symbol: 'AMZN', name: 'Amazon', position: 4 },
  { id: 6, symbol: 'GOOGL', name: 'Alphabet', position: 5 },
]

export function localGetWatchlist() {
  const cached = read(KEYS.watchlist, null)
  const source = Array.isArray(cached) ? cached : DEFAULT_WATCHLIST
  if (!Array.isArray(cached)) write(KEYS.watchlist, DEFAULT_WATCHLIST)
  const seen = new Set()
  const rows = source.filter((row) => {
    const symbol = String(row.symbol || '').toUpperCase()
    if (seen.has(symbol)) return false
    seen.add(symbol)
    return true
  })
  return [...rows].sort((a, b) => (a.position - b.position) || (a.id - b.id))
}

export function localAddWatchlist(body) {
  const symbol = String(body.symbol || '').trim().toUpperCase()
  if (!symbol) throw new Error('symbol es requerido')
  const rows = read(KEYS.watchlist, DEFAULT_WATCHLIST)
  const existing = rows.find((row) => row.symbol === symbol)
  if (existing) return existing
  const max = rows.reduce((m, row) => Math.max(m, Number(row.position) || -1), -1)
  const row = {
    id: nextLocalId(),
    symbol,
    name: body.name || 'Personalizado',
    position: max + 1,
    created_at: nowSql(),
  }
  write(KEYS.watchlist, [...rows, row])
  return row
}

export function localRemoveWatchlist(symbol) {
  const upper = String(symbol || '').trim().toUpperCase()
  const rows = read(KEYS.watchlist, DEFAULT_WATCHLIST)
  const next = removeFrom(rows, (row) => row.symbol === upper)
  if (next.length === rows.length) throw new Error('Ticker no encontrado')
  write(KEYS.watchlist, next)
}

export function cacheWatchlist(rows) {
  const localOnly = read(KEYS.watchlist, []).filter((row) => isLocalId(row.id))
  const seen = new Set()
  const merged = []
  for (const row of [...rows, ...localOnly]) {
    const symbol = String(row.symbol || '').toUpperCase()
    if (seen.has(symbol)) continue
    seen.add(symbol)
    merged.push(row)
  }
  write(KEYS.watchlist, merged)
}

export function hasLocalOnlyWatchlistSymbol(symbol) {
  const upper = String(symbol || '').trim().toUpperCase()
  return read(KEYS.watchlist, []).some((row) => isLocalId(row.id) && row.symbol === upper)
}

// ---------- Checklist ----------
function normalizeChecklist(rows) {
  return (rows || []).map((ticker) => ({
    id: ticker.id,
    symbol: String(ticker.symbol || '').toUpperCase(),
    sector: ticker.sector || 'General',
    expanded: !!ticker.expanded,
    indicators: (ticker.indicators || []).map((i) => ({
      id: i.id,
      text: i.text,
      weight: Number(i.weight) || 3,
      checked: !!i.checked,
    })),
  }))
}

export function localGetChecklist() {
  return normalizeChecklist(read(KEYS.checklist, []))
}

export function localCreateChecklist(body) {
  const symbol = String(body.symbol || '').trim().toUpperCase()
  if (!symbol) throw new Error('symbol es requerido')
  const rows = normalizeChecklist(read(KEYS.checklist, []))
  const existing = rows.find((row) => row.symbol === symbol)
  if (existing) return existing
  const row = {
    id: nextLocalId(),
    symbol,
    sector: body.sector || 'General',
    expanded: true,
    indicators: Array.isArray(body.indicators)
      ? body.indicators.map((ind) => ({ id: nextLocalId(), text: ind.text, weight: Number(ind.weight) || 3, checked: false }))
      : [],
  }
  write(KEYS.checklist, [...rows, row])
  return row
}

export function localUpdateChecklistTicker(id, body) {
  const rows = normalizeChecklist(read(KEYS.checklist, []))
  const index = rows.findIndex((row) => String(row.id) === String(id))
  if (index < 0) throw new Error('Ticker no encontrado')
  const current = rows[index]
  rows[index] = {
    ...current,
    sector: body.sector !== undefined ? body.sector : current.sector,
    expanded: body.expanded !== undefined ? !!body.expanded : current.expanded,
    indicators: Array.isArray(body.indicators)
      ? body.indicators.map((ind) => ({
          id: ind.id ?? nextLocalId(),
          text: ind.text,
          weight: Number(ind.weight) || 3,
          checked: !!ind.checked,
        }))
      : current.indicators,
  }
  write(KEYS.checklist, rows)
  return rows[index]
}

export function localDeleteChecklistTicker(id) {
  const rows = normalizeChecklist(read(KEYS.checklist, []))
  const next = removeFrom(rows, (row) => String(row.id) === String(id))
  if (next.length === rows.length) throw new Error('Ticker no encontrado')
  write(KEYS.checklist, next)
}

export function localAddChecklistIndicator(tickerId, body) {
  const rows = normalizeChecklist(read(KEYS.checklist, []))
  const ticker = rows.find((row) => String(row.id) === String(tickerId))
  if (!ticker) throw new Error('Ticker no encontrado')
  const text = String(body.text || '').trim()
  if (!text) throw new Error('text es requerido')
  const created = {
    id: nextLocalId(),
    text,
    weight: Number(body.weight) || 3,
    checked: false,
  }
  ticker.indicators.push(created)
  write(KEYS.checklist, rows)
  return created
}

export function localUpdateChecklistIndicator(id, body) {
  const rows = normalizeChecklist(read(KEYS.checklist, []))
  for (const ticker of rows) {
    const index = ticker.indicators.findIndex((item) => String(item.id) === String(id))
    if (index < 0) continue
    const current = ticker.indicators[index]
    ticker.indicators[index] = {
      ...current,
      text: body.text !== undefined ? body.text : current.text,
      weight: body.weight !== undefined ? Number(body.weight) || 3 : current.weight,
      checked: body.checked !== undefined ? !!body.checked : current.checked,
    }
    write(KEYS.checklist, rows)
    return ticker.indicators[index]
  }
  throw new Error('Indicador no encontrado')
}

export function localDeleteChecklistIndicator(id) {
  const rows = normalizeChecklist(read(KEYS.checklist, []))
  for (const ticker of rows) {
    const next = removeFrom(ticker.indicators, (item) => String(item.id) === String(id))
    if (next.length === ticker.indicators.length) continue
    ticker.indicators = next
    write(KEYS.checklist, rows)
    return
  }
  throw new Error('Indicador no encontrado')
}

export function cacheChecklist(rows) {
  const remoteRows = normalizeChecklist(rows)
  const localOnly = normalizeChecklist(read(KEYS.checklist, [])).filter((row) => isLocalId(row.id))
  const seen = new Set()
  const merged = []
  for (const row of [...remoteRows, ...localOnly]) {
    const symbol = String(row.symbol || '').toUpperCase()
    if (seen.has(symbol)) continue
    seen.add(symbol)
    merged.push(row)
  }
  write(KEYS.checklist, merged)
}

export function cacheChecklistIndicatorCreated(tickerId, indicator) {
  const rows = normalizeChecklist(read(KEYS.checklist, []))
  const ticker = rows.find((row) => String(row.id) === String(tickerId))
  if (!ticker) return
  ticker.indicators = [...ticker.indicators.filter((item) => String(item.id) !== String(indicator.id)), {
    id: indicator.id,
    text: indicator.text,
    weight: Number(indicator.weight) || 3,
    checked: !!indicator.checked,
  }]
  write(KEYS.checklist, rows)
}

export function cacheChecklistIndicatorUpdated(indicator) {
  const rows = normalizeChecklist(read(KEYS.checklist, []))
  for (const ticker of rows) {
    const index = ticker.indicators.findIndex((item) => String(item.id) === String(indicator.id))
    if (index < 0) continue
    ticker.indicators[index] = {
      id: indicator.id,
      text: indicator.text,
      weight: Number(indicator.weight) || 3,
      checked: !!indicator.checked,
    }
    write(KEYS.checklist, rows)
    return
  }
}

export function cacheChecklistIndicatorDeleted(id) {
  const rows = normalizeChecklist(read(KEYS.checklist, []))
  let changed = false
  for (const ticker of rows) {
    const next = ticker.indicators.filter((item) => String(item.id) !== String(id))
    if (next.length !== ticker.indicators.length) {
      ticker.indicators = next
      changed = true
    }
  }
  if (changed) write(KEYS.checklist, rows)
}

// ---------- Trades ----------
function formatTrade(row) {
  const ccl = Number(row.ccl) > 0 ? Number(row.ccl) : null
  const price = Number(row.price)
  const fee = Number(row.fee) || 0
  const quantity = Number(row.quantity)
  return {
    id: row.id,
    date: row.date ?? row.trade_date,
    assetType: row.assetType ?? row.asset_type,
    ticker: String(row.ticker || '').toUpperCase(),
    operation: row.operation,
    quantity,
    price,
    fee,
    notes: row.notes || '',
    ccl,
    ratio: Number(row.ratio) > 0 ? Number(row.ratio) : 1,
    priceUSD: ccl ? Math.round((price / ccl) * 10000) / 10000 : null,
    total: row.operation === 'COMPRA' ? quantity * price + fee : quantity * price - fee,
    createdAt: row.createdAt ?? row.created_at ?? nowSql(),
  }
}

function computeTradeSummary(trades) {
  const bySymbol = {}
  for (const t of trades) {
    if (!bySymbol[t.ticker]) {
      bySymbol[t.ticker] = {
        ticker: t.ticker,
        assetType: t.assetType,
        quantity: 0,
        avgCost: 0,
        invested: 0,
        realizedPL: 0,
        avgCostUSD: 0,
        investedUSD: 0,
        realizedPLUSD: 0,
        usdIncomplete: false,
      }
    }
    const s = bySymbol[t.ticker]
    const hasCCL = Number(t.ccl) > 0
    if (!hasCCL) s.usdIncomplete = true
    const priceUSD = hasCCL ? t.price / t.ccl : 0
    const feeUSD = hasCCL ? t.fee / t.ccl : 0

    if (t.operation === 'COMPRA') {
      const costoPrevio = s.avgCost * s.quantity
      const costoPrevioUSD = s.avgCostUSD * s.quantity
      const nuevaCantidad = s.quantity + t.quantity
      const nuevoCosto = costoPrevio + t.quantity * t.price + t.fee
      const nuevoCostoUSD = costoPrevioUSD + t.quantity * priceUSD + feeUSD
      s.avgCost = nuevaCantidad > 0 ? nuevoCosto / nuevaCantidad : 0
      s.avgCostUSD = nuevaCantidad > 0 ? nuevoCostoUSD / nuevaCantidad : 0
      s.quantity = nuevaCantidad
      s.invested = nuevoCosto
      s.investedUSD = nuevoCostoUSD
    } else {
      const pl = t.quantity * (t.price - s.avgCost) - t.fee
      const plUSD = t.quantity * (priceUSD - s.avgCostUSD) - feeUSD
      s.realizedPL += pl
      s.realizedPLUSD += plUSD
      s.quantity = Math.max(0, s.quantity - t.quantity)
      s.invested = s.avgCost * s.quantity
      s.investedUSD = s.avgCostUSD * s.quantity
    }
  }

  const bySymbolList = Object.values(bySymbol).map((s) => ({
    ...s,
    quantity: Math.round(s.quantity * 1e6) / 1e6,
    avgCost: Math.round(s.avgCost * 100) / 100,
    invested: Math.round(s.invested * 100) / 100,
    realizedPL: Math.round(s.realizedPL * 100) / 100,
    avgCostUSD: s.usdIncomplete ? null : Math.round(s.avgCostUSD * 100) / 100,
    investedUSD: s.usdIncomplete ? null : Math.round(s.investedUSD * 100) / 100,
    realizedPLUSD: s.usdIncomplete ? null : Math.round(s.realizedPLUSD * 100) / 100,
  }))

  return {
    bySymbol: bySymbolList,
    totals: {
      realizedPL: Math.round(bySymbolList.reduce((acc, s) => acc + s.realizedPL, 0) * 100) / 100,
      realizedPLUSD: Math.round(bySymbolList.reduce((acc, s) => acc + (s.realizedPLUSD || 0), 0) * 100) / 100,
      invested: Math.round(bySymbolList.reduce((acc, s) => acc + s.invested, 0) * 100) / 100,
      investedUSD: Math.round(bySymbolList.reduce((acc, s) => acc + (s.investedUSD || 0), 0) * 100) / 100,
      openPositions: bySymbolList.filter((s) => s.quantity > 0).length,
      totalTrades: trades.length,
    },
  }
}

export function localGetTrades() {
  return read(KEYS.trades, []).map(formatTrade).sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : Number(a.id) - Number(b.id)
  )
}

export function localCreateTrade(body) {
  const ticker = String(body.ticker || '').trim().toUpperCase()
  const row = formatTrade({
    id: nextLocalId(),
    date: body.date,
    assetType: body.assetType,
    ticker,
    operation: body.operation,
    quantity: Number(body.quantity),
    price: Number(body.price),
    fee: Number(body.fee) || 0,
    notes: body.notes || '',
    ccl: body.ccl !== '' && body.ccl != null ? Number(body.ccl) : null,
    ratio: Number(body.ratio) > 0 ? Number(body.ratio) : 1,
    createdAt: nowSql(),
  })
  if (!(row.quantity > 0) || !(row.price > 0)) throw new Error('quantity y price deben ser mayores a 0')
  write(KEYS.trades, [row, ...read(KEYS.trades, [])])
  return row
}

export function localUpdateTrade(id, body) {
  const rows = read(KEYS.trades, [])
  const index = rows.findIndex((row) => String(row.id) === String(id))
  if (index < 0) throw new Error('Trade no encontrado')
  const current = rows[index]
  rows[index] = formatTrade({
    ...current,
    ...body,
    id: current.id,
    date: body.date !== undefined ? body.date : current.date,
    assetType: body.assetType !== undefined ? body.assetType : current.assetType,
    ticker: body.ticker !== undefined ? body.ticker : current.ticker,
    operation: body.operation !== undefined ? body.operation : current.operation,
    quantity: body.quantity !== undefined ? Number(body.quantity) : current.quantity,
    price: body.price !== undefined ? Number(body.price) : current.price,
    fee: body.fee !== undefined ? Number(body.fee) || 0 : current.fee,
    notes: body.notes !== undefined ? body.notes : current.notes,
    ccl: body.ccl !== undefined ? (body.ccl === '' || body.ccl === null ? null : Number(body.ccl)) : current.ccl,
    ratio: body.ratio !== undefined ? (Number(body.ratio) > 0 ? Number(body.ratio) : 1) : current.ratio,
  })
  if (!(rows[index].quantity > 0) || !(rows[index].price > 0)) throw new Error('quantity y price deben ser mayores a 0')
  write(KEYS.trades, rows)
  return rows[index]
}

export function localDeleteTrade(id) {
  const rows = read(KEYS.trades, [])
  const next = removeFrom(rows, (row) => String(row.id) === String(id))
  if (next.length === rows.length) throw new Error('Trade no encontrado')
  write(KEYS.trades, next)
}

export function cacheTrades(rows) {
  saveCollection(KEYS.trades, rows.map(formatTrade))
}

export function localGetTradesSummary() {
  return computeTradeSummary(localGetTrades())
}

// ---------- Journal ----------
const MARKETS = ['ACCION', 'CEDEAR', 'FOREX', 'FUTURO', 'CRIPTO', 'OPCION', 'INDICE', 'MATERIA_PRIMA', 'BONO', 'OTRO']
const DIRECTIONS = ['LONG', 'SHORT']
const STATUSES = ['ABIERTO', 'CERRADO', 'CANCELADO']

function resolveStatus(entryDate, exitDate, exitPrice, requestedStatus) {
  if (requestedStatus === 'CANCELADO') return 'CANCELADO'
  const hasExit = !!entryDate && !!exitDate && exitPrice !== null && exitPrice !== undefined && exitPrice !== ''
  return hasExit ? 'CERRADO' : 'ABIERTO'
}

function formatJournalEntry(row) {
  const entryPrice = Number(row.entryPrice ?? row.entry_price)
  const stopLoss = row.stopLoss ?? row.stop_loss
  const takeProfit = row.takeProfit ?? row.take_profit
  const exitPrice = row.exitPrice ?? row.exit_price
  const size = Number(row.size)
  const leverage = Number(row.leverage) || 1
  const fee = Number(row.fee) || 0
  const isLong = (row.direction) === 'LONG'
  const status = resolveStatus(row.entryDate ?? row.entry_date, row.exitDate ?? row.exit_date, exitPrice, row.status)

  let plannedRR = null
  if (stopLoss != null && takeProfit != null) {
    const risk = Math.abs(entryPrice - Number(stopLoss))
    const reward = Math.abs(Number(takeProfit) - entryPrice)
    plannedRR = risk > 0 ? Math.round((reward / risk) * 100) / 100 : null
  }

  let resultAmount = null
  if (status === 'CERRADO') {
    const priceDiff = isLong ? Number(exitPrice) - entryPrice : entryPrice - Number(exitPrice)
    resultAmount = Math.round((priceDiff * size * leverage - fee) * 100) / 100
  }

  let resultR = null
  const riskAmount = row.riskAmount ?? row.risk_amount
  if (resultAmount != null && riskAmount) resultR = Math.round((resultAmount / Number(riskAmount)) * 100) / 100

  return {
    id: row.id,
    entryDate: row.entryDate ?? row.entry_date,
    exitDate: row.exitDate ?? row.exit_date,
    market: row.market,
    symbol: String(row.symbol || '').toUpperCase(),
    direction: row.direction,
    strategy: row.strategy || '',
    timeframe: row.timeframe || '',
    entryPrice,
    stopLoss: stopLoss == null ? null : Number(stopLoss),
    takeProfit: takeProfit == null ? null : Number(takeProfit),
    exitPrice: exitPrice == null ? null : Number(exitPrice),
    size,
    leverage,
    fee,
    riskAmount: riskAmount == null ? null : Number(riskAmount),
    riskPercent: row.riskPercent ?? row.risk_percent,
    status,
    emotion: row.emotion || '',
    followedPlan: !!(row.followedPlan ?? row.followed_plan),
    entryReason: row.entryReason ?? row.entry_reason ?? '',
    lessons: row.lessons || '',
    account: row.account || '',
    plannedRR,
    resultAmount,
    resultR,
    createdAt: row.createdAt ?? row.created_at ?? nowSql(),
    updatedAt: row.updatedAt ?? row.updated_at ?? nowSql(),
  }
}

function computeJournalSummary(rows) {
  const closed = rows.filter((r) => r.status === 'CERRADO' && r.resultAmount != null)
  const wins = closed.filter((r) => r.resultAmount > 0)
  const losses = closed.filter((r) => r.resultAmount < 0)
  const grossWin = wins.reduce((acc, r) => acc + r.resultAmount, 0)
  const grossLoss = Math.abs(losses.reduce((acc, r) => acc + r.resultAmount, 0))
  const rValues = closed.filter((r) => r.resultR != null).map((r) => r.resultR)
  const round2 = (n) => Math.round(n * 100) / 100
  return {
    totals: {
      totalEntries: rows.length,
      openPositions: rows.filter((r) => r.status === 'ABIERTO').length,
      closedTrades: closed.length,
      winRate: closed.length ? round2((wins.length / closed.length) * 100) : 0,
      netResult: round2(grossWin - grossLoss),
      profitFactor: grossLoss > 0 ? round2(grossWin / grossLoss) : grossWin > 0 ? null : 0,
      avgR: rValues.length ? round2(rValues.reduce((a, b) => a + b, 0) / rValues.length) : null,
      bestTrade: closed.length ? round2(Math.max(...closed.map((r) => r.resultAmount))) : 0,
      worstTrade: closed.length ? round2(Math.min(...closed.map((r) => r.resultAmount))) : 0,
      planAdherence: rows.length ? round2((rows.filter((r) => r.followedPlan).length / rows.length) * 100) : 0,
    },
  }
}

function validateJournal(body) {
  if (!body.entryDate) throw new Error('entryDate es requerido')
  if (!MARKETS.includes(body.market)) throw new Error('market inválido')
  if (!String(body.symbol || '').trim()) throw new Error('symbol es requerido')
  if (!DIRECTIONS.includes(body.direction)) throw new Error('direction inválido')
  if (!(Number(body.entryPrice) > 0)) throw new Error('entryPrice debe ser mayor a 0')
  if (!(Number(body.size) > 0)) throw new Error('size debe ser mayor a 0')
  if (body.status && !STATUSES.includes(body.status)) throw new Error('status inválido')
  const hasExitDate = !!body.exitDate
  const hasExitPrice = body.exitPrice !== null && body.exitPrice !== undefined && body.exitPrice !== ''
  if (hasExitDate !== hasExitPrice) throw new Error('Para cerrar la operación completá la fecha Y el precio de salida (o dejá ambos vacíos)')
  if (hasExitPrice && !(Number(body.exitPrice) > 0)) throw new Error('exitPrice debe ser mayor a 0')
  if (hasExitDate && body.exitDate < body.entryDate) throw new Error('La fecha de salida no puede ser anterior a la fecha de entrada')
}

function buildJournalRow(body, current = {}) {
  const get = (key, fallback) => body[key] !== undefined ? body[key] : fallback
  const exitDate = get('exitDate', current.exitDate ?? current.exit_date ?? null) || null
  const exitPriceRaw = get('exitPrice', current.exitPrice ?? current.exit_price ?? null)
  const exitPrice = exitPriceRaw === '' || exitPriceRaw == null ? null : Number(exitPriceRaw)
  const row = {
    id: current.id ?? nextLocalId(),
    entryDate: get('entryDate', current.entryDate ?? current.entry_date),
    exitDate,
    market: get('market', current.market),
    symbol: String(get('symbol', current.symbol) || '').trim().toUpperCase(),
    direction: get('direction', current.direction),
    strategy: get('strategy', current.strategy || ''),
    timeframe: get('timeframe', current.timeframe || ''),
    entryPrice: Number(get('entryPrice', current.entryPrice ?? current.entry_price)),
    stopLoss: get('stopLoss', current.stopLoss ?? current.stop_loss),
    takeProfit: get('takeProfit', current.takeProfit ?? current.take_profit),
    exitPrice,
    size: Number(get('size', current.size)),
    leverage: Number(get('leverage', current.leverage ?? 1)) || 1,
    fee: Number(get('fee', current.fee ?? 0)) || 0,
    riskAmount: get('riskAmount', current.riskAmount ?? current.risk_amount),
    riskPercent: get('riskPercent', current.riskPercent ?? current.risk_percent),
    status: resolveStatus(get('entryDate', current.entryDate ?? current.entry_date), exitDate, exitPrice, get('status', current.status)),
    emotion: get('emotion', current.emotion || ''),
    followedPlan: get('followedPlan', current.followedPlan ?? current.followed_plan ?? true) !== false,
    entryReason: get('entryReason', current.entryReason ?? current.entry_reason ?? ''),
    lessons: get('lessons', current.lessons || ''),
    account: get('account', current.account || ''),
    createdAt: current.createdAt ?? current.created_at ?? nowSql(),
    updatedAt: nowSql(),
  }
  return formatJournalEntry(row)
}

export function localGetJournal() {
  return read(KEYS.journal, []).map(formatJournalEntry).sort((a, b) =>
    a.entryDate < b.entryDate ? 1 : a.entryDate > b.entryDate ? -1 : Number(b.id) - Number(a.id)
  )
}

export function localCreateJournal(body) {
  validateJournal(body)
  const row = buildJournalRow(body)
  const rows = read(KEYS.journal, [])
  write(KEYS.journal, [row, ...rows])
  return row
}

export function localUpdateJournal(id, body) {
  const rows = read(KEYS.journal, [])
  const index = rows.findIndex((row) => String(row.id) === String(id))
  if (index < 0) throw new Error('Registro no encontrado')
  const updated = buildJournalRow(body, rows[index])
  validateJournal(updated)
  rows[index] = updated
  write(KEYS.journal, rows)
  return updated
}

export function localDeleteJournal(id) {
  const rows = read(KEYS.journal, [])
  const next = removeFrom(rows, (row) => String(row.id) === String(id))
  if (next.length === rows.length) throw new Error('Registro no encontrado')
  write(KEYS.journal, next)
}

export function cacheJournal(rows) {
  saveCollection(KEYS.journal, rows.map(formatJournalEntry))
}

export function localGetJournalSummary() {
  return computeJournalSummary(localGetJournal())
}
