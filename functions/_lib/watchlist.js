export async function getAll(db) {
  const { results } = await db
    .prepare('SELECT * FROM watchlist_us ORDER BY position ASC, id ASC')
    .all();
  return results;
}

export async function create(db, body) {
  const { name = 'Personalizado' } = body;
  const symbol = (body.symbol || '').trim().toUpperCase();
  if (!symbol) throw { status: 400, message: 'symbol es requerido' };

  const existing = await db
    .prepare('SELECT * FROM watchlist_us WHERE symbol = ?')
    .bind(symbol)
    .first();
  if (existing) return existing; // ya está en la lista, no es error

  const { max } = await db
    .prepare('SELECT COALESCE(MAX(position), -1) as max FROM watchlist_us')
    .first();

  const info = await db
    .prepare('INSERT INTO watchlist_us (symbol, name, position) VALUES (?, ?, ?)')
    .bind(symbol, name, max + 1)
    .run();

  return db.prepare('SELECT * FROM watchlist_us WHERE id = ?').bind(info.meta.last_row_id).first();
}

export async function remove(db, symbol) {
  const result = await db
    .prepare('DELETE FROM watchlist_us WHERE symbol = ?')
    .bind(symbol.toUpperCase())
    .run();
  if (result.meta.changes === 0) throw { status: 404, message: 'Ticker no encontrado' };
}