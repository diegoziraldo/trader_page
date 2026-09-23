// functions/_lib/portfolios.js
//
// Armado de carteras: cada "cartera" agrupa posiciones de CEDEARs y
// acciones argentinas. Para CEDEARs se puede cargar el ratio de conversión
// (cuántos CEDEARs equivalen a 1 acción) y el ticker subyacente en USA, así
// se puede valuar la posición en USD contra el precio real de la acción
// (no aproximado con el CCL general) — mismo criterio que la bitácora de
// trades. El precio "en vivo" en sí (Finnhub para el subyacente, o el panel
// de data912 para CEDEARs/acciones AR) lo trae el frontend; acá solo se
// persisten los datos de la posición y se devuelven ya formateados.

const ASSET_TYPES = ['CEDEAR', 'ACCION_AR'];

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function formatPortfolio(row) {
  return {
    id: row.id,
    name: row.name,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function formatPosition(row) {
  const quantity = Number(row.quantity);
  const avgPrice = Number(row.avg_price);
  return {
    id: row.id,
    portfolioId: row.portfolio_id,
    assetType: row.asset_type,
    ticker: row.ticker,
    underlyingTicker: row.underlying_ticker || '',
    ratio: row.ratio != null ? Number(row.ratio) : null,
    sector: row.sector || 'General',
    quantity,
    avgPrice,
    invested: round2(quantity * avgPrice),
    targetWeight: row.target_weight != null ? Number(row.target_weight) : null,
    manualPrice: row.manual_price != null ? Number(row.manual_price) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validatePortfolioBody(body) {
  const errors = [];
  if (!body.name || !String(body.name).trim()) errors.push('name es requerido');
  return errors;
}

function validatePositionBody(body) {
  const errors = [];
  if (!ASSET_TYPES.includes(body.assetType)) errors.push('assetType inválido');
  if (!body.ticker || !String(body.ticker).trim()) errors.push('ticker es requerido');
  if (!(Number(body.quantity) > 0)) errors.push('quantity debe ser mayor a 0');
  if (!(Number(body.avgPrice) > 0)) errors.push('avgPrice debe ser mayor a 0');
  if (body.ratio !== undefined && body.ratio !== null && body.ratio !== '' && !(Number(body.ratio) > 0)) {
    errors.push('ratio debe ser mayor a 0 (o dejalo vacío)');
  }
  if (
    body.targetWeight !== undefined &&
    body.targetWeight !== null &&
    body.targetWeight !== '' &&
    (Number(body.targetWeight) < 0 || Number(body.targetWeight) > 100)
  ) {
    errors.push('targetWeight debe estar entre 0 y 100');
  }
  return errors;
}

// ---------- Carteras ----------

export async function getAllPortfolios(db) {
  const { results } = await db.prepare('SELECT * FROM portfolios ORDER BY id ASC').all();
  return results.map(formatPortfolio);
}

export async function createPortfolio(db, body) {
  const errors = validatePortfolioBody(body);
  if (errors.length) throw { status: 400, message: errors.join(', ') };

  const name = String(body.name).trim();
  const notes = body.notes || '';

  const info = await db
    .prepare('INSERT INTO portfolios (name, notes) VALUES (?, ?)')
    .bind(name, notes)
    .run();

  const created = await db.prepare('SELECT * FROM portfolios WHERE id = ?').bind(info.meta.last_row_id).first();
  return formatPortfolio(created);
}

export async function updatePortfolio(db, id, body) {
  const existing = await db.prepare('SELECT * FROM portfolios WHERE id = ?').bind(id).first();
  if (!existing) throw { status: 404, message: 'Cartera no encontrada' };

  const name = body.name !== undefined ? String(body.name).trim() : existing.name;
  if (!name) throw { status: 400, message: 'name es requerido' };
  const notes = body.notes !== undefined ? body.notes : existing.notes;

  await db
    .prepare(`UPDATE portfolios SET name = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(name, notes, id)
    .run();

  const updated = await db.prepare('SELECT * FROM portfolios WHERE id = ?').bind(id).first();
  return formatPortfolio(updated);
}

export async function removePortfolio(db, id) {
  const result = await db.prepare('DELETE FROM portfolios WHERE id = ?').bind(id).run();
  if (result.meta.changes === 0) throw { status: 404, message: 'Cartera no encontrada' };
}

// ---------- Posiciones ----------

export async function getPositions(db, portfolioId) {
  const { results } = await db
    .prepare('SELECT * FROM portfolio_positions WHERE portfolio_id = ? ORDER BY id ASC')
    .bind(portfolioId)
    .all();
  return results.map(formatPosition);
}

export async function createPosition(db, portfolioId, body) {
  const portfolio = await db.prepare('SELECT id FROM portfolios WHERE id = ?').bind(portfolioId).first();
  if (!portfolio) throw { status: 404, message: 'Cartera no encontrada' };

  const errors = validatePositionBody(body);
  if (errors.length) throw { status: 400, message: errors.join(', ') };

  const ticker = String(body.ticker).trim().toUpperCase();
  const underlyingTicker = body.underlyingTicker ? String(body.underlyingTicker).trim().toUpperCase() : '';
  const ratio = body.ratio !== undefined && body.ratio !== null && body.ratio !== '' ? Number(body.ratio) : null;
  const sector = body.sector && String(body.sector).trim() ? String(body.sector).trim() : 'General';
  const targetWeight =
    body.targetWeight !== undefined && body.targetWeight !== null && body.targetWeight !== ''
      ? Number(body.targetWeight)
      : null;
  const manualPrice =
    body.manualPrice !== undefined && body.manualPrice !== null && body.manualPrice !== ''
      ? Number(body.manualPrice)
      : null;

  const info = await db
    .prepare(
      `INSERT INTO portfolio_positions
        (portfolio_id, asset_type, ticker, underlying_ticker, ratio, sector, quantity, avg_price, target_weight, manual_price)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      portfolioId,
      body.assetType,
      ticker,
      underlyingTicker,
      ratio,
      sector,
      Number(body.quantity),
      Number(body.avgPrice),
      targetWeight,
      manualPrice
    )
    .run();

  const created = await db
    .prepare('SELECT * FROM portfolio_positions WHERE id = ?')
    .bind(info.meta.last_row_id)
    .first();
  return formatPosition(created);
}

export async function updatePosition(db, id, body) {
  const existing = await db.prepare('SELECT * FROM portfolio_positions WHERE id = ?').bind(id).first();
  if (!existing) throw { status: 404, message: 'Posición no encontrada' };

  const merged = {
    assetType: body.assetType ?? existing.asset_type,
    ticker: body.ticker ?? existing.ticker,
    quantity: body.quantity ?? existing.quantity,
    avgPrice: body.avgPrice ?? existing.avg_price,
  };
  const errors = validatePositionBody(merged);
  if (errors.length) throw { status: 400, message: errors.join(', ') };

  const underlyingTicker =
    body.underlyingTicker !== undefined ? String(body.underlyingTicker).trim().toUpperCase() : existing.underlying_ticker;
  const ratio =
    body.ratio !== undefined ? (body.ratio === '' || body.ratio === null ? null : Number(body.ratio)) : existing.ratio;
  const sector = body.sector !== undefined ? (String(body.sector).trim() || 'General') : existing.sector;
  const targetWeight =
    body.targetWeight !== undefined
      ? body.targetWeight === '' || body.targetWeight === null
        ? null
        : Number(body.targetWeight)
      : existing.target_weight;
  const manualPrice =
    body.manualPrice !== undefined
      ? body.manualPrice === '' || body.manualPrice === null
        ? null
        : Number(body.manualPrice)
      : existing.manual_price;

  await db
    .prepare(
      `UPDATE portfolio_positions SET
        asset_type = ?, ticker = ?, underlying_ticker = ?, ratio = ?, sector = ?,
        quantity = ?, avg_price = ?, target_weight = ?, manual_price = ?,
        updated_at = datetime('now')
       WHERE id = ?`
    )
    .bind(
      merged.assetType,
      String(merged.ticker).trim().toUpperCase(),
      underlyingTicker,
      ratio,
      sector,
      Number(merged.quantity),
      Number(merged.avgPrice),
      targetWeight,
      manualPrice,
      id
    )
    .run();

  const updated = await db.prepare('SELECT * FROM portfolio_positions WHERE id = ?').bind(id).first();
  return formatPosition(updated);
}

export async function removePosition(db, id) {
  const result = await db.prepare('DELETE FROM portfolio_positions WHERE id = ?').bind(id).run();
  if (result.meta.changes === 0) throw { status: 404, message: 'Posición no encontrada' };
}
