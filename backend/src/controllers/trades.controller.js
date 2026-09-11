const db = require('../db');

function formatTrade(row) {
  return {
    id: row.id,
    date: row.trade_date,
    assetType: row.asset_type,
    ticker: row.ticker,
    operation: row.operation,
    quantity: row.quantity,
    price: row.price,
    fee: row.fee,
    notes: row.notes,
    total: row.operation === 'COMPRA'
      ? row.quantity * row.price + row.fee
      : row.quantity * row.price - row.fee,
    createdAt: row.created_at,
  };
}

// GET /api/trades
function getAll(req, res) {
  const rows = db
    .prepare('SELECT * FROM trades ORDER BY trade_date ASC, id ASC')
    .all();
  res.json(rows.map(formatTrade));
}

function validateBody(body) {
  const errors = [];
  if (!body.date) errors.push('date es requerido');
  if (!['CEDEAR', 'ACCION_AR'].includes(body.assetType)) errors.push('assetType inválido');
  if (!body.ticker || !String(body.ticker).trim()) errors.push('ticker es requerido');
  if (!['COMPRA', 'VENTA'].includes(body.operation)) errors.push('operation inválido');
  if (!(Number(body.quantity) > 0)) errors.push('quantity debe ser mayor a 0');
  if (!(Number(body.price) > 0)) errors.push('price debe ser mayor a 0');
  return errors;
}

// POST /api/trades
// { date, assetType, ticker, operation, quantity, price, fee?, notes? }
function create(req, res) {
  const errors = validateBody(req.body);
  if (errors.length) return res.status(400).json({ error: errors.join(', ') });

  const { date, assetType, operation, notes = '' } = req.body;
  const ticker = req.body.ticker.trim().toUpperCase();
  const quantity = Number(req.body.quantity);
  const price = Number(req.body.price);
  const fee = Number(req.body.fee) || 0;

  const info = db
    .prepare(
      `INSERT INTO trades (trade_date, asset_type, ticker, operation, quantity, price, fee, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(date, assetType, ticker, operation, quantity, price, fee, notes);

  const created = db.prepare('SELECT * FROM trades WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(formatTrade(created));
}

// PUT /api/trades/:id
function update(req, res) {
  const existing = db.prepare('SELECT * FROM trades WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Trade no encontrado' });

  const merged = {
    date: req.body.date ?? existing.trade_date,
    assetType: req.body.assetType ?? existing.asset_type,
    ticker: req.body.ticker ?? existing.ticker,
    operation: req.body.operation ?? existing.operation,
    quantity: req.body.quantity ?? existing.quantity,
    price: req.body.price ?? existing.price,
  };
  const errors = validateBody(merged);
  if (errors.length) return res.status(400).json({ error: errors.join(', ') });

  const fee = req.body.fee !== undefined ? Number(req.body.fee) : existing.fee;
  const notes = req.body.notes !== undefined ? req.body.notes : existing.notes;

  db.prepare(
    `UPDATE trades SET
      trade_date = ?, asset_type = ?, ticker = ?, operation = ?,
      quantity = ?, price = ?, fee = ?, notes = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    merged.date,
    merged.assetType,
    String(merged.ticker).trim().toUpperCase(),
    merged.operation,
    Number(merged.quantity),
    Number(merged.price),
    fee,
    notes,
    req.params.id
  );

  const updated = db.prepare('SELECT * FROM trades WHERE id = ?').get(req.params.id);
  res.json(formatTrade(updated));
}

// DELETE /api/trades/:id
function remove(req, res) {
  const result = db.prepare('DELETE FROM trades WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Trade no encontrado' });
  res.status(204).send();
}

// =========================================================
// RESUMEN: ganancias/pérdidas realizadas por costo promedio (PPC)
// =========================================================
// Por cada ticker, mantenemos cantidad en cartera y costo promedio.
// En cada VENTA, la ganancia/pérdida realizada es:
//   cantidad_vendida * (precio_venta - costo_promedio) - comisión
// Las comisiones de COMPRA se suman al costo (encarecen el promedio);
// las comisiones de VENTA se restan directo del resultado.
function computeSummary(trades) {
  const bySymbol = {};

  for (const t of trades) {
    if (!bySymbol[t.ticker]) {
      bySymbol[t.ticker] = {
        ticker: t.ticker,
        assetType: t.assetType,
        quantity: 0,
        avgCost: 0,
        invested: 0, // costo de la posición abierta actual
        realizedPL: 0,
        totalBought: 0,
        totalSold: 0,
      };
    }
    const s = bySymbol[t.ticker];

    if (t.operation === 'COMPRA') {
      const costoPrevio = s.avgCost * s.quantity;
      const nuevaCantidad = s.quantity + t.quantity;
      const nuevoCosto = costoPrevio + t.quantity * t.price + t.fee;
      s.avgCost = nuevaCantidad > 0 ? nuevoCosto / nuevaCantidad : 0;
      s.quantity = nuevaCantidad;
      s.invested = nuevoCosto;
      s.totalBought += t.quantity * t.price + t.fee;
    } else {
      // VENTA: si venden más de lo que "tienen" cargado (datos incompletos,
      // posición previa a empezar a registrar, etc.), no dejamos que la
      // cantidad quede negativa; igual calculamos el resultado sobre lo
      // vendido usando el costo promedio vigente.
      const pl = t.quantity * (t.price - s.avgCost) - t.fee;
      s.realizedPL += pl;
      s.quantity = Math.max(0, s.quantity - t.quantity);
      s.invested = s.avgCost * s.quantity;
      s.totalSold += t.quantity * t.price - t.fee;
    }
  }

  const bySymbolList = Object.values(bySymbol).map((s) => ({
    ...s,
    quantity: Math.round(s.quantity * 1e6) / 1e6,
    avgCost: Math.round(s.avgCost * 100) / 100,
    invested: Math.round(s.invested * 100) / 100,
    realizedPL: Math.round(s.realizedPL * 100) / 100,
  }));

  const totals = {
    realizedPL: Math.round(bySymbolList.reduce((acc, s) => acc + s.realizedPL, 0) * 100) / 100,
    invested: Math.round(bySymbolList.reduce((acc, s) => acc + s.invested, 0) * 100) / 100,
    openPositions: bySymbolList.filter((s) => s.quantity > 0).length,
    totalTrades: trades.length,
  };

  return { bySymbol: bySymbolList, totals };
}

// GET /api/trades/summary
function getSummary(req, res) {
  const rows = db
    .prepare('SELECT * FROM trades ORDER BY trade_date ASC, id ASC')
    .all()
    .map(formatTrade);
  res.json(computeSummary(rows));
}

module.exports = { getAll, create, update, remove, getSummary };