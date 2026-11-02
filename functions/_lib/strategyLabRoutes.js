// functions/_lib/strategyLabRoutes.js
//
// Sub-router de Hono para /api/strategy-lab/*. Se monta con UNA línea en
// functions/api/[[route]].js:   app.route('/strategy-lab', strategyLab)

import { Hono } from 'hono'
import * as lab from './strategyLab.js'

export const strategyLab = new Hono()

// Mismo contrato de errores que `h` en [[route]].js: { status, message } -> JSON.
const h = (fn) => async (c) => {
  try {
    return await fn(c)
  } catch (err) {
    if (err && err.status) return c.json({ error: err.message }, err.status)
    console.error(err)
    return c.json({ error: 'Error interno' }, 500)
  }
}

// ---- Estrategias ----
strategyLab.get('/strategies', h(async (c) => c.json(await lab.listStrategies(c.env.DB))))
strategyLab.get('/strategies/:id', h(async (c) => c.json(await lab.getStrategy(c.env.DB, c.req.param('id')))))
strategyLab.post('/strategies', h(async (c) => c.json(await lab.createStrategy(c.env.DB, await c.req.json()), 201)))
strategyLab.put('/strategies/:id', h(async (c) => c.json(await lab.updateStrategy(c.env.DB, c.req.param('id'), await c.req.json()))))
strategyLab.delete('/strategies/:id', h(async (c) => {
  await lab.removeStrategy(c.env.DB, c.req.param('id'))
  return c.body(null, 204)
}))

// ---- Operaciones ----
strategyLab.get('/trades', h(async (c) => c.json(await lab.listTrades(c.env.DB))))
strategyLab.get('/trades/:id', h(async (c) => c.json(await lab.getTrade(c.env.DB, c.req.param('id')))))
strategyLab.post('/trades', h(async (c) => c.json(await lab.createTrade(c.env.DB, await c.req.json()), 201)))
strategyLab.put('/trades/:id', h(async (c) => c.json(await lab.updateTrade(c.env.DB, c.req.param('id'), await c.req.json()))))
strategyLab.delete('/trades/:id', h(async (c) => {
  await lab.removeTrade(c.env.DB, c.req.param('id'))
  return c.body(null, 204)
}))

// ---- Capturas ----
strategyLab.get('/trades/:id/attachments', h(async (c) => c.json(await lab.listAttachments(c.env.DB, c.req.param('id')))))
strategyLab.post('/trades/:id/attachments', h(async (c) => c.json(await lab.addAttachment(c.env.DB, c.req.param('id'), await c.req.json()), 201)))
strategyLab.delete('/trades/:id/attachments/:attId', h(async (c) => {
  await lab.removeAttachment(c.env.DB, c.req.param('id'), c.req.param('attId'))
  return c.body(null, 204)
}))
