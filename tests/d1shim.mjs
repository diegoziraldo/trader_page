// Shim mínimo de la API de D1 sobre node:sqlite, solo para tests.
import fs from 'node:fs'
import { createRequire } from 'node:module'
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite')

export function makeD1(sqlFiles) {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  for (const f of sqlFiles) db.exec(fs.readFileSync(f, 'utf8'))
  const plain = (r) => (r ? { ...r } : null)
  const stmt = (sql, params = []) => ({
    bind: (...p) => stmt(sql, p),
    _exec() {
      const r = db.prepare(sql).run(...params)
      return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } }
    },
    async run() { return this._exec() },
    async first() { return plain(db.prepare(sql).get(...params)) },
    async all() { return { results: db.prepare(sql).all(...params).map(plain) } },
  })
  return {
    prepare: (sql) => stmt(sql),
    async batch(stmts) {
      db.exec('BEGIN')
      try { const out = stmts.map((s) => s._exec()); db.exec('COMMIT'); return out } catch (e) { db.exec('ROLLBACK'); throw e }
    },
    raw: db,
  }
}
