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
    total:
      row.operation === 'COMPRA'
        ? row.quantity * row.price + row.fee
        : row.quantity * row.price - row.fee,
    createdAt: row.created_at,
  };
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

export async function getAll(db) {
  const { results } = await db.prepare('SELECT * FROM trades ORDER BY trade_date ASC, id ASC').all();
  return results.map(formatTrade);
}

export async function create(db, body) {
  const errors = validateBody(body);
  if (errors.length) throw { status: 400, message: errors.join(', ') };

  const { date, assetType, operation, notes = '' } = body;
  const ticker = body.ticker.trim().toUpperCase();
  const quantity = Number(body.quantity);
  const price = Number(body.price);
  const fee = Number(body.fee) || 0;

  const info = await db
    .prepare(
      `INSERT INTO trades (trade_date, asset_type, ticker, operation, quantity, price, fee, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(date, assetType, ticker, operation, quantity, price, fee, notes)
    .run();

  const created = await db.prepare('SELECT * FROM trades WHERE id = ?').bind(info.meta.last_row_id).first();
  return formatTrade(created);
}

export async function update(db, id, body) {
  const existing = await db.prepare('SELECT * FROM trades WHERE id = ?').bind(id).first();
  if (!existing) throw { status: 404, message: 'Trade no encontrado' };

  const merged = {
    date: body.date ?? existing.trade_date,
    assetType: body.assetType ?? existing.asset_type,
    ticker: body.ticker ?? existing.ticker,
    operation: body.operation ?? existing.operation,
    quantity: body.quantity ?? existing.quantity,
    price: body.price ?? existing.price,
  };
  const errors = validateBody(merged);
  if (errors.length) throw { status: 400, message: errors.join(', ') };

  const fee = body.fee !== undefined ? Number(body.fee) : existing.fee;
  const notes = body.notes !== undefined ? body.notes : existing.notes;

  await db
    .prepare(
      `UPDATE trades SET
        trade_date = ?, asset_type = ?, ticker = ?, operation = ?,
        quantity = ?, price = ?, fee = ?, notes = ?, updated_at = datetime('now')
       WHERE id = ?`
    )
    .bind(
      merged.date,
      merged.assetType,
      String(merged.ticker).trim().toUpperCase(),
      merged.operation,
      Number(merged.quantity),
      Number(merged.price),
      fee,
      notes,
      id
    )
    .run();

  const updated = await db.prepare('SELECT * FROM trades WHERE id = ?').bind(id).first();
  return formatTrade(updated);
}

export async function remove(db, id) {
  const result = await db.prepare('DELETE FROM trades WHERE id = ?').bind(id).run();
  if (result.meta.changes === 0) throw { status: 404, message: 'Trade no encontrado' };
}

// Ganancias/pérdidas realizadas por costo promedio (PPC). Por cada ticker
// mantenemos cantidad en cartera y costo promedio; en cada VENTA, la
// ganancia/pérdida realizada es cantidad_vendida * (precio_venta - costo_promedio) - comisión.
function computeSummary(trades) {
  const bySymbol = {};

  for (const t of trades) {
    if (!bySymbol[t.ticker]) {
      bySymbol[t.ticker] = {
        ticker: t.ticker,
        assetType: t.assetType,
        quantity: 0,
        avgCost: 0,
        invested: 0,
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

export async function getSummary(db) {
  const rows = (await getAll(db));
  return computeSummary(rows);
}
