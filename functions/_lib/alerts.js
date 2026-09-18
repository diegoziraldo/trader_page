function formatAlert(row) {
  return {
    id: row.id,
    ticker: row.ticker,
    type: row.type,
    price: row.price,
    triggered: !!row.triggered,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function getAll(db) {
  const { results } = await db.prepare('SELECT * FROM alerts ORDER BY created_at DESC').all();
  return results.map(formatAlert);
}

export async function create(db, body) {
  const { ticker, type = 'IN', price = null } = body;
  if (!ticker) throw { status: 400, message: 'ticker es requerido' };
  if (!['IN', 'TARGET', 'STOP_LOSS'].includes(type)) {
    throw { status: 400, message: "type debe ser 'IN', 'TARGET' o 'STOP_LOSS'" };
  }
  if (price !== null && price !== '' && !(Number(price) > 0)) {
    throw { status: 400, message: 'price debe ser mayor a 0' };
  }

  const info = await db
    .prepare('INSERT INTO alerts (ticker, type, price) VALUES (?, ?, ?)')
    .bind(ticker.toUpperCase(), type, price)
    .run();

  const created = await db
    .prepare('SELECT * FROM alerts WHERE id = ?')
    .bind(info.meta.last_row_id)
    .first();
  return formatAlert(created);
}

export async function update(db, id, body) {
  const existing = await db.prepare('SELECT * FROM alerts WHERE id = ?').bind(id).first();
  if (!existing) throw { status: 404, message: 'Alerta no encontrada' };

  const ticker = body.ticker !== undefined ? String(body.ticker).trim() : existing.ticker;
  const type = body.type !== undefined ? body.type : existing.type;
  const price = body.price !== undefined ? body.price : existing.price;
  const triggered = body.triggered !== undefined ? (body.triggered ? 1 : 0) : existing.triggered;
  if (!ticker) throw { status: 400, message: 'ticker es requerido' };
  if (!['IN', 'TARGET', 'STOP_LOSS'].includes(type)) {
    throw { status: 400, message: "type debe ser 'IN', 'TARGET' o 'STOP_LOSS'" };
  }
  if (price !== null && price !== '' && !(Number(price) > 0)) {
    throw { status: 400, message: 'price debe ser mayor a 0' };
  }

  await db
    .prepare(
      `UPDATE alerts SET ticker = ?, type = ?, price = ?, triggered = ?, updated_at = datetime('now') WHERE id = ?`
    )
    .bind(ticker.toUpperCase(), type, price, triggered, id)
    .run();

  const updated = await db.prepare('SELECT * FROM alerts WHERE id = ?').bind(id).first();
  return formatAlert(updated);
}

export async function remove(db, id) {
  const result = await db.prepare('DELETE FROM alerts WHERE id = ?').bind(id).run();
  if (result.meta.changes === 0) throw { status: 404, message: 'Alerta no encontrada' };
}