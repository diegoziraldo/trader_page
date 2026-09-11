import { Hono } from 'hono';
import * as alerts from '../_lib/alerts.js';
import * as watchlist from '../_lib/watchlist.js';
import * as checklist from '../_lib/checklist.js';
import * as trades from '../_lib/trades.js';

const app = new Hono().basePath('/api');

// Envuelve un handler y traduce los errores lanzados con { status, message }
// a una respuesta JSON prolija, igual que hacía Express antes.
function h(fn) {
  return async (c) => {
    try {
      return await fn(c);
    } catch (err) {
      if (err && err.status) return c.json({ error: err.message }, err.status);
      console.error(err);
      return c.json({ error: 'Error interno' }, 500);
    }
  };
}

app.get('/health', (c) => c.json({ status: 'ok' }));

// Confirma que D1 anda: cada GET inserta una fila y devuelve cuantas hay.
app.get(
  '/db-check',
  h(async (c) => {
    const db = c.env.DB;
    await db.prepare('INSERT INTO ping DEFAULT VALUES').run();
    const { count } = await db.prepare('SELECT COUNT(*) as count FROM ping').first();
    const { results: last } = await db
      .prepare('SELECT * FROM ping ORDER BY id DESC LIMIT 5')
      .all();
    return c.json({ status: 'db ok', total_pings: count, last_pings: last });
  })
);

// ---------- Alerts ----------
app.get('/alerts', h(async (c) => c.json(await alerts.getAll(c.env.DB))));
app.post(
  '/alerts',
  h(async (c) => c.json(await alerts.create(c.env.DB, await c.req.json()), 201))
);
app.put(
  '/alerts/:id',
  h(async (c) => c.json(await alerts.update(c.env.DB, c.req.param('id'), await c.req.json())))
);
app.delete(
  '/alerts/:id',
  h(async (c) => {
    await alerts.remove(c.env.DB, c.req.param('id'));
    return c.body(null, 204);
  })
);

// ---------- Watchlist ----------
app.get('/watchlist/us', h(async (c) => c.json(await watchlist.getAll(c.env.DB))));
app.post(
  '/watchlist/us',
  h(async (c) => c.json(await watchlist.create(c.env.DB, await c.req.json()), 201))
);
app.delete(
  '/watchlist/us/:symbol',
  h(async (c) => {
    await watchlist.remove(c.env.DB, c.req.param('symbol'));
    return c.body(null, 204);
  })
);

// ---------- Checklist ----------
app.get('/checklist', h(async (c) => c.json(await checklist.getAll(c.env.DB))));
app.post(
  '/checklist',
  h(async (c) => {
    const { status, data } = await checklist.create(c.env.DB, await c.req.json());
    return c.json(data, status);
  })
);
app.put(
  '/checklist/:id',
  h(async (c) => c.json(await checklist.update(c.env.DB, c.req.param('id'), await c.req.json())))
);
app.delete(
  '/checklist/:id',
  h(async (c) => {
    await checklist.remove(c.env.DB, c.req.param('id'));
    return c.body(null, 204);
  })
);
app.post(
  '/checklist/:tickerId/indicators',
  h(async (c) =>
    c.json(await checklist.addIndicator(c.env.DB, c.req.param('tickerId'), await c.req.json()), 201)
  )
);
app.put(
  '/checklist/indicators/:id',
  h(async (c) =>
    c.json(await checklist.updateIndicator(c.env.DB, c.req.param('id'), await c.req.json()))
  )
);
app.delete(
  '/checklist/indicators/:id',
  h(async (c) => {
    await checklist.removeIndicator(c.env.DB, c.req.param('id'));
    return c.body(null, 204);
  })
);

// ---------- Trades ----------
// OJO: la ruta /summary tiene que declararse antes de /:id, si no Hono
// interpreta "summary" como un id.
app.get('/trades/summary', h(async (c) => c.json(await trades.getSummary(c.env.DB))));
app.get('/trades', h(async (c) => c.json(await trades.getAll(c.env.DB))));
app.post(
  '/trades',
  h(async (c) => c.json(await trades.create(c.env.DB, await c.req.json()), 201))
);
app.put(
  '/trades/:id',
  h(async (c) => c.json(await trades.update(c.env.DB, c.req.param('id'), await c.req.json())))
);
app.delete(
  '/trades/:id',
  h(async (c) => {
    await trades.remove(c.env.DB, c.req.param('id'));
    return c.body(null, 204);
  })
);

export const onRequest = (context) => app.fetch(context.request, context.env, context);
