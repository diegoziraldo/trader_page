import { Hono } from 'hono';
import * as alerts from '../_lib/alerts.js';
import * as watchlist from '../_lib/watchlist.js';
import * as checklist from '../_lib/checklist.js';
import * as trades from '../_lib/trades.js';
import * as journal from '../_lib/journal.js';

const app = new Hono().basePath('/api');

// Envuelve un handler y traduce los errores lanzados con { status, message }
// a una respuesta JSON prolija, igual que hacía Express antes.
function requireDb(c) {
  const db = c.env?.DB;
  if (!db || typeof db.prepare !== 'function') {
    throw { status: 503, code: 'DB_UNAVAILABLE', message: 'La base de datos D1 no está configurada para este entorno' };
  }
  return db;
}

function h(fn) {
  return async (c) => {
    try {
      return await fn(c);
    } catch (err) {
      if (err && err.status) {
        return c.json({ error: err.message || 'Error de API', code: err.code || 'API_ERROR' }, err.status);
      }
      console.error(err);
      return c.json({ error: 'Error interno', code: 'INTERNAL_ERROR' }, 500);
    }
  };
}

app.get('/health', (c) => c.json({ status: 'ok' }));

// Diagnóstico de conexión sin escribir datos en la tabla ping.
app.get(
  '/db-check',
  h(async (c) => {
    const db = requireDb(c);
    const row = await db.prepare('SELECT 1 AS ok').first();
    return c.json({ status: row?.ok === 1 ? 'db ok' : 'db error', driver: 'd1' });
  })
);

// ---------- Alerts ----------
app.get('/alerts', h(async (c) => c.json(await alerts.getAll(requireDb(c)))));
app.post(
  '/alerts',
  h(async (c) => c.json(await alerts.create(requireDb(c), await c.req.json()), 201))
);
app.put(
  '/alerts/:id',
  h(async (c) => c.json(await alerts.update(requireDb(c), c.req.param('id'), await c.req.json())))
);
app.delete(
  '/alerts/:id',
  h(async (c) => {
    await alerts.remove(requireDb(c), c.req.param('id'));
    return c.body(null, 204);
  })
);

// ---------- Watchlist ----------
app.get('/watchlist/us', h(async (c) => c.json(await watchlist.getAll(requireDb(c)))));
app.post(
  '/watchlist/us',
  h(async (c) => c.json(await watchlist.create(requireDb(c), await c.req.json()), 201))
);
app.delete(
  '/watchlist/us/:symbol',
  h(async (c) => {
    await watchlist.remove(requireDb(c), c.req.param('symbol'));
    return c.body(null, 204);
  })
);

// ---------- Checklist ----------
app.get('/checklist', h(async (c) => c.json(await checklist.getAll(requireDb(c)))));
app.post(
  '/checklist',
  h(async (c) => {
    const { status, data } = await checklist.create(requireDb(c), await c.req.json());
    return c.json(data, status);
  })
);
app.put(
  '/checklist/:id',
  h(async (c) => c.json(await checklist.update(requireDb(c), c.req.param('id'), await c.req.json())))
);
app.delete(
  '/checklist/:id',
  h(async (c) => {
    await checklist.remove(requireDb(c), c.req.param('id'));
    return c.body(null, 204);
  })
);
app.post(
  '/checklist/:tickerId/indicators',
  h(async (c) =>
    c.json(await checklist.addIndicator(requireDb(c), c.req.param('tickerId'), await c.req.json()), 201)
  )
);
app.put(
  '/checklist/indicators/:id',
  h(async (c) =>
    c.json(await checklist.updateIndicator(requireDb(c), c.req.param('id'), await c.req.json()))
  )
);
app.delete(
  '/checklist/indicators/:id',
  h(async (c) => {
    await checklist.removeIndicator(requireDb(c), c.req.param('id'));
    return c.body(null, 204);
  })
);

// ---------- Trades ----------
// OJO: la ruta /summary tiene que declararse antes de /:id, si no Hono
// interpreta "summary" como un id.
app.get('/trades/summary', h(async (c) => c.json(await trades.getSummary(requireDb(c)))));
app.get('/trades', h(async (c) => c.json(await trades.getAll(requireDb(c)))));
app.post(
  '/trades',
  h(async (c) => c.json(await trades.create(requireDb(c), await c.req.json()), 201))
);
app.put(
  '/trades/:id',
  h(async (c) => c.json(await trades.update(requireDb(c), c.req.param('id'), await c.req.json())))
);
app.delete(
  '/trades/:id',
  h(async (c) => {
    await trades.remove(requireDb(c), c.req.param('id'));
    return c.body(null, 204);
  })
);

// ---------- Planilla profesional de trading (journal) ----------
// OJO: la ruta /summary tiene que declararse antes de /:id, si no Hono
// interpreta "summary" como un id.
app.get('/journal/summary', h(async (c) => c.json(await journal.getSummary(requireDb(c)))));
app.get('/journal', h(async (c) => c.json(await journal.getAll(requireDb(c)))));
app.post(
  '/journal',
  h(async (c) => c.json(await journal.create(requireDb(c), await c.req.json()), 201))
);
app.put(
  '/journal/:id',
  h(async (c) => c.json(await journal.update(requireDb(c), c.req.param('id'), await c.req.json())))
);
app.delete(
  '/journal/:id',
  h(async (c) => {
    await journal.remove(requireDb(c), c.req.param('id'));
    return c.body(null, 204);
  })
);

export const onRequest = (context) => app.fetch(context.request, context.env, context);