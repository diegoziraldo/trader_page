async function getIndicators(db, tickerId) {
  const { results } = await db
    .prepare('SELECT * FROM checklist_indicators WHERE ticker_id = ? ORDER BY position ASC, id ASC')
    .bind(tickerId)
    .all();
  return results.map((i) => ({ id: i.id, text: i.text, weight: i.weight, checked: !!i.checked }));
}

async function formatTicker(db, row) {
  return {
    id: row.id,
    symbol: row.symbol,
    sector: row.sector,
    expanded: !!row.expanded,
    indicators: await getIndicators(db, row.id),
  };
}

export async function getAll(db) {
  const { results } = await db.prepare('SELECT * FROM checklist_tickers ORDER BY id ASC').all();
  return Promise.all(results.map((row) => formatTicker(db, row)));
}

export async function create(db, body) {
  const symbol = (body.symbol || '').trim().toUpperCase();
  const sector = body.sector || 'General';
  const indicators = Array.isArray(body.indicators) ? body.indicators : [];
  if (!symbol) throw { status: 400, message: 'symbol es requerido' };

  const existing = await db
    .prepare('SELECT * FROM checklist_tickers WHERE symbol = ?')
    .bind(symbol)
    .first();
  if (existing) return { status: 200, data: await formatTicker(db, existing) };

  const info = await db
    .prepare('INSERT INTO checklist_tickers (symbol, sector) VALUES (?, ?)')
    .bind(symbol, sector)
    .run();
  const tickerId = info.meta.last_row_id;

  const inserts = indicators.map((ind, i) =>
    db
      .prepare('INSERT INTO checklist_indicators (ticker_id, text, weight, position) VALUES (?, ?, ?, ?)')
      .bind(tickerId, ind.text, ind.weight || 3, i)
  );
  if (inserts.length) await db.batch(inserts);

  const created = await db.prepare('SELECT * FROM checklist_tickers WHERE id = ?').bind(tickerId).first();
  return { status: 201, data: await formatTicker(db, created) };
}

export async function update(db, id, body) {
  const existing = await db.prepare('SELECT * FROM checklist_tickers WHERE id = ?').bind(id).first();
  if (!existing) throw { status: 404, message: 'Ticker no encontrado' };

  const sector = body.sector !== undefined ? body.sector : existing.sector;
  const expanded = body.expanded !== undefined ? (body.expanded ? 1 : 0) : existing.expanded;

  await db
    .prepare(`UPDATE checklist_tickers SET sector = ?, expanded = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(sector, expanded, id)
    .run();

  if (Array.isArray(body.indicators)) {
    await db.prepare('DELETE FROM checklist_indicators WHERE ticker_id = ?').bind(id).run();
    const inserts = body.indicators.map((ind, i) =>
      db
        .prepare('INSERT INTO checklist_indicators (ticker_id, text, weight, position) VALUES (?, ?, ?, ?)')
        .bind(id, ind.text, ind.weight || 3, i)
    );
    if (inserts.length) await db.batch(inserts);
  }

  const updated = await db.prepare('SELECT * FROM checklist_tickers WHERE id = ?').bind(id).first();
  return formatTicker(db, updated);
}

export async function remove(db, id) {
  // Borramos los indicadores explícitamente: D1 no garantiza que el
  // PRAGMA foreign_keys esté activo en cada conexión, así que no
  // confiamos únicamente en el ON DELETE CASCADE del schema.
  await db.prepare('DELETE FROM checklist_indicators WHERE ticker_id = ?').bind(id).run();
  const result = await db.prepare('DELETE FROM checklist_tickers WHERE id = ?').bind(id).run();
  if (result.meta.changes === 0) throw { status: 404, message: 'Ticker no encontrado' };
}

export async function addIndicator(db, tickerId, body) {
  const ticker = await db.prepare('SELECT * FROM checklist_tickers WHERE id = ?').bind(tickerId).first();
  if (!ticker) throw { status: 404, message: 'Ticker no encontrado' };

  const { text, weight = 3 } = body;
  if (!text || !text.trim()) throw { status: 400, message: 'text es requerido' };

  const { max } = await db
    .prepare('SELECT COALESCE(MAX(position), -1) as max FROM checklist_indicators WHERE ticker_id = ?')
    .bind(tickerId)
    .first();

  const info = await db
    .prepare('INSERT INTO checklist_indicators (ticker_id, text, weight, position) VALUES (?, ?, ?, ?)')
    .bind(tickerId, text.trim(), weight, max + 1)
    .run();

  const created = await db
    .prepare('SELECT * FROM checklist_indicators WHERE id = ?')
    .bind(info.meta.last_row_id)
    .first();
  return { id: created.id, text: created.text, weight: created.weight, checked: !!created.checked };
}

export async function updateIndicator(db, id, body) {
  const existing = await db.prepare('SELECT * FROM checklist_indicators WHERE id = ?').bind(id).first();
  if (!existing) throw { status: 404, message: 'Indicador no encontrado' };

  const text = body.text !== undefined ? body.text : existing.text;
  const weight = body.weight !== undefined ? body.weight : existing.weight;
  const checked = body.checked !== undefined ? (body.checked ? 1 : 0) : existing.checked;

  await db
    .prepare('UPDATE checklist_indicators SET text = ?, weight = ?, checked = ? WHERE id = ?')
    .bind(text, weight, checked, id)
    .run();

  const updated = await db.prepare('SELECT * FROM checklist_indicators WHERE id = ?').bind(id).first();
  return { id: updated.id, text: updated.text, weight: updated.weight, checked: !!updated.checked };
}

export async function removeIndicator(db, id) {
  const result = await db.prepare('DELETE FROM checklist_indicators WHERE id = ?').bind(id).run();
  if (result.meta.changes === 0) throw { status: 404, message: 'Indicador no encontrado' };
}