const db = require('../db');

const MARKETS = ['ACCION', 'CEDEAR', 'FOREX', 'FUTURO', 'CRIPTO', 'OPCION', 'INDICE', 'MATERIA_PRIMA', 'BONO', 'OTRO'];
const DIRECTIONS = ['LONG', 'SHORT'];
const STATUSES = ['ABIERTO', 'CERRADO', 'CANCELADO'];

// Convierte una fila cruda de la tabla en el objeto que consume el frontend,
// calculando al vuelo las métricas derivadas (R:R planeado, resultado en $
// y en R) para no duplicar datos que puedan quedar desincronizados.
function formatEntry(row) {
  const entryPrice = row.entry_price;
  const stopLoss = row.stop_loss;
  const takeProfit = row.take_profit;
  const exitPrice = row.exit_price;
  const size = row.size;
  const leverage = row.leverage || 1;
  const fee = row.fee || 0;
  const isLong = row.direction === 'LONG';

  let plannedRR = null;
  if (stopLoss != null && takeProfit != null) {
    const risk = Math.abs(entryPrice - stopLoss);
    const reward = Math.abs(takeProfit - entryPrice);
    plannedRR = risk > 0 ? Math.round((reward / risk) * 100) / 100 : null;
  }

  let resultAmount = null;
  if (exitPrice != null) {
    const priceDiff = isLong ? exitPrice - entryPrice : entryPrice - exitPrice;
    resultAmount = Math.round((priceDiff * size * leverage - fee) * 100) / 100;
  }

  let resultR = null;
  if (resultAmount != null && row.risk_amount) {
    resultR = Math.round((resultAmount / row.risk_amount) * 100) / 100;
  }

  return {
    id: row.id,
    entryDate: row.entry_date,
    exitDate: row.exit_date,
    market: row.market,
    symbol: row.symbol,
    direction: row.direction,
    strategy: row.strategy,
    timeframe: row.timeframe,
    entryPrice: row.entry_price,
    stopLoss: row.stop_loss,
    takeProfit: row.take_profit,
    exitPrice: row.exit_price,
    size: row.size,
    leverage: row.leverage,
    fee: row.fee,
    riskAmount: row.risk_amount,
    riskPercent: row.risk_percent,
    status: row.status,
    emotion: row.emotion,
    followedPlan: !!row.followed_plan,
    entryReason: row.entry_reason,
    lessons: row.lessons,
    account: row.account,
    plannedRR,
    resultAmount,
    resultR,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validateBody(body) {
  const errors = [];
  if (!body.entryDate) errors.push('entryDate es requerido');
  if (!MARKETS.includes(body.market)) errors.push('market inválido');
  if (!body.symbol || !String(body.symbol).trim()) errors.push('symbol es requerido');
  if (!DIRECTIONS.includes(body.direction)) errors.push('direction inválido');
  if (!(Number(body.entryPrice) > 0)) errors.push('entryPrice debe ser mayor a 0');
  if (!(Number(body.size) > 0)) errors.push('size debe ser mayor a 0');
  if (body.status && !STATUSES.includes(body.status)) errors.push('status inválido');
  return errors;
}

// GET /api/journal
function getAll(req, res) {
  const rows = db
    .prepare('SELECT * FROM trade_journal ORDER BY entry_date DESC, id DESC')
    .all();
  res.json(rows.map(formatEntry));
}

// POST /api/journal
function create(req, res) {
  const errors = validateBody(req.body);
  if (errors.length) return res.status(400).json({ error: errors.join(', ') });

  const b = req.body;
  const symbol = b.symbol.trim().toUpperCase();

  const info = db
    .prepare(
      `INSERT INTO trade_journal (
        entry_date, exit_date, market, symbol, direction, strategy, timeframe,
        entry_price, stop_loss, take_profit, exit_price, size, leverage, fee,
        risk_amount, risk_percent, status, emotion, followed_plan, entry_reason,
        lessons, account
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      b.entryDate,
      b.exitDate || null,
      b.market,
      symbol,
      b.direction,
      b.strategy || '',
      b.timeframe || '',
      Number(b.entryPrice),
      b.stopLoss != null && b.stopLoss !== '' ? Number(b.stopLoss) : null,
      b.takeProfit != null && b.takeProfit !== '' ? Number(b.takeProfit) : null,
      b.exitPrice != null && b.exitPrice !== '' ? Number(b.exitPrice) : null,
      Number(b.size),
      Number(b.leverage) || 1,
      Number(b.fee) || 0,
      b.riskAmount != null && b.riskAmount !== '' ? Number(b.riskAmount) : null,
      b.riskPercent != null && b.riskPercent !== '' ? Number(b.riskPercent) : null,
      b.status || 'ABIERTO',
      b.emotion || '',
      b.followedPlan === false ? 0 : 1,
      b.entryReason || '',
      b.lessons || '',
      b.account || ''
    );

  const created = db.prepare('SELECT * FROM trade_journal WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(formatEntry(created));
}

// PUT /api/journal/:id
function update(req, res) {
  const existing = db.prepare('SELECT * FROM trade_journal WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Registro no encontrado' });

  const b = req.body;
  const merged = {
    entryDate: b.entryDate ?? existing.entry_date,
    market: b.market ?? existing.market,
    symbol: b.symbol ?? existing.symbol,
    direction: b.direction ?? existing.direction,
    entryPrice: b.entryPrice ?? existing.entry_price,
    size: b.size ?? existing.size,
    status: b.status ?? existing.status,
  };
  const errors = validateBody(merged);
  if (errors.length) return res.status(400).json({ error: errors.join(', ') });

  const pick = (key, col, transform = (v) => v) =>
    b[key] !== undefined ? transform(b[key]) : existing[col];

  const values = {
    entryDate: merged.entryDate,
    exitDate: pick('exitDate', 'exit_date', (v) => v || null),
    market: merged.market,
    symbol: String(merged.symbol).trim().toUpperCase(),
    direction: merged.direction,
    strategy: pick('strategy', 'strategy'),
    timeframe: pick('timeframe', 'timeframe'),
    entryPrice: Number(merged.entryPrice),
    stopLoss: pick('stopLoss', 'stop_loss', (v) => (v === '' || v == null ? null : Number(v))),
    takeProfit: pick('takeProfit', 'take_profit', (v) => (v === '' || v == null ? null : Number(v))),
    exitPrice: pick('exitPrice', 'exit_price', (v) => (v === '' || v == null ? null : Number(v))),
    size: Number(merged.size),
    leverage: pick('leverage', 'leverage', (v) => Number(v) || 1),
    fee: pick('fee', 'fee', (v) => Number(v) || 0),
    riskAmount: pick('riskAmount', 'risk_amount', (v) => (v === '' || v == null ? null : Number(v))),
    riskPercent: pick('riskPercent', 'risk_percent', (v) => (v === '' || v == null ? null : Number(v))),
    status: merged.status,
    emotion: pick('emotion', 'emotion'),
    followedPlan: b.followedPlan !== undefined ? (b.followedPlan ? 1 : 0) : existing.followed_plan,
    entryReason: pick('entryReason', 'entry_reason'),
    lessons: pick('lessons', 'lessons'),
    account: pick('account', 'account'),
  };

  db.prepare(
    `UPDATE trade_journal SET
      entry_date = ?, exit_date = ?, market = ?, symbol = ?, direction = ?,
      strategy = ?, timeframe = ?, entry_price = ?, stop_loss = ?, take_profit = ?,
      exit_price = ?, size = ?, leverage = ?, fee = ?, risk_amount = ?, risk_percent = ?,
      status = ?, emotion = ?, followed_plan = ?, entry_reason = ?, lessons = ?, account = ?,
      updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    values.entryDate,
    values.exitDate,
    values.market,
    values.symbol,
    values.direction,
    values.strategy,
    values.timeframe,
    values.entryPrice,
    values.stopLoss,
    values.takeProfit,
    values.exitPrice,
    values.size,
    values.leverage,
    values.fee,
    values.riskAmount,
    values.riskPercent,
    values.status,
    values.emotion,
    values.followedPlan,
    values.entryReason,
    values.lessons,
    values.account,
    req.params.id
  );

  const updated = db.prepare('SELECT * FROM trade_journal WHERE id = ?').get(req.params.id);
  res.json(formatEntry(updated));
}

// DELETE /api/journal/:id
function remove(req, res) {
  const result = db.prepare('DELETE FROM trade_journal WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Registro no encontrado' });
  res.status(204).send();
}

// GET /api/journal/summary
function getSummary(req, res) {
  const rows = db
    .prepare('SELECT * FROM trade_journal ORDER BY entry_date ASC, id ASC')
    .all()
    .map(formatEntry);

  const closed = rows.filter((r) => r.status === 'CERRADO' && r.resultAmount != null);
  const wins = closed.filter((r) => r.resultAmount > 0);
  const losses = closed.filter((r) => r.resultAmount < 0);
  const grossWin = wins.reduce((acc, r) => acc + r.resultAmount, 0);
  const grossLoss = Math.abs(losses.reduce((acc, r) => acc + r.resultAmount, 0));
  const rValues = closed.filter((r) => r.resultR != null).map((r) => r.resultR);

  const round2 = (n) => Math.round(n * 100) / 100;

  res.json({
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
  });
}

module.exports = { getAll, create, update, remove, getSummary };
