function formatCaucion(row) {
  return {
    id: row.id,
    fecha: row.fecha,
    importe: row.importe,
    tasa: row.tasa,
    dias: row.dias,
    interes: row.interes,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

function validateBody(body) {
  const errors = [];
  if (!body.fecha) errors.push('fecha es requerida');
  if (!(Number(body.importe) > 0)) errors.push('el importe debe ser mayor a 0');
  if (!(Number(body.tasa) > 0)) errors.push('la tasa debe ser mayor a 0');
  if (!(Number.isInteger(Number(body.dias)) && Number(body.dias) > 0)) {
    errors.push('los días deben ser un número entero mayor a 0');
  }
  if (!(Number(body.interes) >= 0)) errors.push('el interés cobrado no puede ser negativo');
  return errors;
}

export async function getAll(db) {
  const { results } = await db.prepare('SELECT * FROM cauciones ORDER BY fecha ASC, id ASC').all();
  return results.map(formatCaucion);
}

export async function create(db, body) {
  const errors = validateBody(body);
  if (errors.length) throw { status: 400, message: errors.join(', ') };

  const { fecha, notes = '' } = body;
  const importe = Number(body.importe);
  const tasa = Number(body.tasa);
  const dias = Number(body.dias);
  const interes = Number(body.interes);

  const info = await db
    .prepare(
      `INSERT INTO cauciones (fecha, importe, tasa, dias, interes, notes)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(fecha, importe, tasa, dias, interes, notes)
    .run();

  const created = await db.prepare('SELECT * FROM cauciones WHERE id = ?').bind(info.meta.last_row_id).first();
  return formatCaucion(created);
}

export async function update(db, id, body) {
  const existing = await db.prepare('SELECT * FROM cauciones WHERE id = ?').bind(id).first();
  if (!existing) throw { status: 404, message: 'Caución no encontrada' };

  const merged = {
    fecha: body.fecha ?? existing.fecha,
    importe: body.importe ?? existing.importe,
    tasa: body.tasa ?? existing.tasa,
    dias: body.dias ?? existing.dias,
    interes: body.interes ?? existing.interes,
  };
  const errors = validateBody(merged);
  if (errors.length) throw { status: 400, message: errors.join(', ') };

  const notes = body.notes !== undefined ? body.notes : existing.notes;

  await db
    .prepare(
      `UPDATE cauciones SET
        fecha = ?, importe = ?, tasa = ?, dias = ?, interes = ?, notes = ?,
        updated_at = datetime('now')
       WHERE id = ?`
    )
    .bind(
      merged.fecha,
      Number(merged.importe),
      Number(merged.tasa),
      Number(merged.dias),
      Number(merged.interes),
      notes,
      id
    )
    .run();

  const updated = await db.prepare('SELECT * FROM cauciones WHERE id = ?').bind(id).first();
  return formatCaucion(updated);
}

export async function remove(db, id) {
  const result = await db.prepare('DELETE FROM cauciones WHERE id = ?').bind(id).run();
  if (result.meta.changes === 0) throw { status: 404, message: 'Caución no encontrada' };
}

// Total de interés cobrado por cauciones — se suma al resultado general de
// la bitácora (TradesModal.vue lo combina con el P&L de trades).
export async function getSummary(db) {
  const rows = await getAll(db);
  const totalInteres = Math.round(rows.reduce((acc, r) => acc + Number(r.interes || 0), 0) * 100) / 100;
  const totalImporte = Math.round(rows.reduce((acc, r) => acc + Number(r.importe || 0), 0) * 100) / 100;
  return { totalInteres, totalImporte, cantidad: rows.length };
}
