const db = require('../db'); // Ajustá esta ruta según tu conexión a better-sqlite3

function enrichTrade(row) {
  const priceUSD = row.ccl && row.ccl > 0 ? row.price / row.ccl : null;
  const total = (row.quantity * row.price) + (row.fee || 0);
  return {
    ...row,
    priceUSD,
    total,
  };
}

exports.getAllTrades = (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM trades ORDER BY date DESC, id DESC').all();
    const enriched = rows.map(enrichTrade);
    return res.status(200).json(enriched);
  } catch (error) {
    console.error('getAllTrades error:', error);
    return res.status(500).json({ error: 'Error al obtener los trades' });
  }
};

exports.getTradesSummary = (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM trades ORDER BY date ASC, id ASC').all();
    const trades = rows.map(enrichTrade);

    const positions = {};
    let realizedPL = 0;
    let realizedPLUSD = 0;

    for (const t of trades) {
      const key = t.ticker;
      if (!positions[key]) {
        positions[key] = {
          ticker: t.ticker,
          assetType: t.assetType,
          quantity: 0,
          totalCostARS: 0,
          totalCostUSD: 0,
          usdIncomplete: false,
        };
      }

      const pos = positions[key];
      pos.assetType = t.assetType;

      if (t.ccl === null || t.ccl === undefined || t.ccl === 0) {
        pos.usdIncomplete = true;
      }

      if (t.operation === 'COMPRA') {
        const costARS = t.quantity * t.price + (t.fee || 0);
        const costUSD = t.priceUSD ? t.quantity * t.priceUSD : 0;
        pos.quantity += t.quantity;
        pos.totalCostARS += costARS;
        pos.totalCostUSD += costUSD;
      } else if (t.operation === 'VENTA') {
        const avgCostARS = pos.quantity > 0 ? pos.totalCostARS / pos.quantity : 0;
        const avgCostUSD = pos.quantity > 0 ? pos.totalCostUSD / pos.quantity : 0;
        const saleProceedsARS = t.quantity * t.price - (t.fee || 0);
        const saleProceedsUSD = t.priceUSD ? t.quantity * t.priceUSD : 0;

        const costSoldARS = t.quantity * avgCostARS;
        const costSoldUSD = t.quantity * avgCostUSD;

        const tradePLARS = saleProceedsARS - costSoldARS;
        const tradePLUSD = t.priceUSD ? saleProceedsUSD - costSoldUSD : 0;

        realizedPL += tradePLARS;
        realizedPLUSD += tradePLUSD;

        pos.quantity = Math.max(0, pos.quantity - t.quantity);
        pos.totalCostARS = Math.max(0, pos.totalCostARS - costSoldARS);
        pos.totalCostUSD = Math.max(0, pos.totalCostUSD - costSoldUSD);
      }
    }

    const bySymbol = Object.values(positions).map((pos) => {
      const avgCost = pos.quantity > 0 ? pos.totalCostARS / pos.quantity : 0;
      const avgCostUSD = pos.quantity > 0 ? pos.totalCostUSD / pos.quantity : 0;
      return {
        ticker: pos.ticker,
        assetType: pos.assetType,
        quantity: pos.quantity,
        avgCost,
        avgCostUSD,
        usdIncomplete: pos.usdIncomplete,
        invested: pos.totalCostARS,
        investedUSD: pos.totalCostUSD,
        realizedPL: 0,
        realizedPLUSD: 0,
      };
    });

    const openPositionsCount = bySymbol.filter((s) => s.quantity > 0).length;
    const totalInvested = bySymbol.reduce((acc, s) => acc + s.invested, 0);
    const totalInvestedUSD = bySymbol.reduce((acc, s) => acc + s.investedUSD, 0);

    return res.status(200).json({
      bySymbol,
      totals: {
        realizedPL,
        realizedPLUSD,
        invested: totalInvested,
        investedUSD: totalInvestedUSD,
        openPositions: openPositionsCount,
        totalTrades: trades.length,
      },
    });
  } catch (error) {
    console.error('getTradesSummary error:', error);
    return res.status(500).json({ error: 'Error al calcular el resumen' });
  }
};

exports.createTrade = (req, res) => {
  try {
    const { date, assetType, ticker, operation, quantity, price, fee, ccl, notes } = req.body;

    const stmt = db.prepare(`
      INSERT INTO trades (date, assetType, ticker, operation, quantity, price, fee, ccl, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const info = stmt.run(
      date,
      assetType,
      ticker.trim().toUpperCase(),
      operation,
      Number(quantity),
      Number(price),
      Number(fee || 0),
      ccl !== null && ccl !== undefined && ccl !== '' ? Number(ccl) : null,
      notes ? notes.trim() : ''
    );

    const created = db.prepare('SELECT * FROM trades WHERE id = ?').get(info.lastInsertRowid);
    return res.status(201).json(enrichTrade(created));
  } catch (error) {
    console.error('createTrade error:', error);
    return res.status(500).json({ error: 'Error al crear la operación' });
  }
};

exports.updateTrade = (req, res) => {
  try {
    const { id } = req.params;
    const { date, assetType, ticker, operation, quantity, price, fee, ccl, notes } = req.body;

    const existing = db.prepare('SELECT * FROM trades WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Operación no encontrada' });
    }

    const stmt = db.prepare(`
      UPDATE trades
      SET date = ?, assetType = ?, ticker = ?, operation = ?, quantity = ?, price = ?, fee = ?, ccl = ?, notes = ?
      WHERE id = ?
    `);

    stmt.run(
      date,
      assetType,
      ticker.trim().toUpperCase(),
      operation,
      Number(quantity),
      Number(price),
      Number(fee || 0),
      ccl !== null && ccl !== undefined && ccl !== '' ? Number(ccl) : null,
      notes ? notes.trim() : '',
      id
    );

    const updated = db.prepare('SELECT * FROM trades WHERE id = ?').get(id);
    return res.status(200).json(enrichTrade(updated));
  } catch (error) {
    console.error('updateTrade error:', error);
    return res.status(500).json({ error: 'Error al actualizar la operación' });
  }
};

exports.deleteTrade = (req, res) => {
  try {
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM trades WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Operación no encontrada' });
    }

    db.prepare('DELETE FROM trades WHERE id = ?').run(id);
    return res.status(200).json({ message: 'Operación eliminada con éxito' });
  } catch (error) {
    console.error('deleteTrade error:', error);
    return res.status(500).json({ error: 'Error al eliminar la operación' });
  }
};