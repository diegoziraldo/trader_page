// src/services/strategyLab/strategyLabService.js
//
// Acceso a datos del Strategy Lab: solo CRUD contra /api/strategy-lab.
// Sin lógica de negocio ni estadísticas (eso vive en tradeMath.js / stats.js).
//
// A diferencia de trades/alerts/checklist, este módulo NO tiene fallback a
// localStorage a propósito: las estadísticas deben salir de una base real.

const API_URL = import.meta.env.VITE_API_URL || '/api'
const BASE = `${API_URL}/strategy-lab`

async function request(path, { method = 'GET', body } = {}) {
  let res
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new Error('No se pudo conectar con el backend. Strategy Lab guarda todo en la base de datos: levantá `npm run pages:dev` (o abrí la app desplegada).')
  }
  if (res.status === 204) return null
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { /* respuesta no JSON */ }
  if (!res.ok) {
    if (data && data.error) throw new Error(data.error)
    if (res.status === 404) throw new Error('El backend no expone las rutas de Strategy Lab. Verificá que functions/api/[[route]].js monte app.route(\'/strategy-lab\', strategyLab) y que corriste la migración 004.')
    throw new Error(`Error del servidor (${res.status})`)
  }
  if (data === null && text) throw new Error('Respuesta inválida del servidor (¿el backend está actualizado?)')
  return data
}

export const strategyLabApi = {
  listStrategies: () => request('/strategies'),
  getStrategy: (id) => request(`/strategies/${id}`),
  createStrategy: (data) => request('/strategies', { method: 'POST', body: data }),
  updateStrategy: (id, data) => request(`/strategies/${id}`, { method: 'PUT', body: data }),
  deleteStrategy: (id) => request(`/strategies/${id}`, { method: 'DELETE' }),

  listTrades: () => request('/trades'),
  getTrade: (id) => request(`/trades/${id}`),
  createTrade: (data) => request('/trades', { method: 'POST', body: data }),
  updateTrade: (id, data) => request(`/trades/${id}`, { method: 'PUT', body: data }),
  deleteTrade: (id) => request(`/trades/${id}`, { method: 'DELETE' }),

  listAttachments: (tradeId) => request(`/trades/${tradeId}/attachments`),
  addAttachment: (tradeId, data) => request(`/trades/${tradeId}/attachments`, { method: 'POST', body: data }),
  deleteAttachment: (tradeId, attId) => request(`/trades/${tradeId}/attachments/${attId}`, { method: 'DELETE' }),
}
