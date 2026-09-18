// src/services/tradesService.js
// Persiste la bitácora de operaciones (CEDEARs / acciones argentinas).
//
// Si hay un backend real corriendo (Express local o Cloudflare Pages
// Functions), lo usa igual que siempre. Si no lo detecta, guarda todo en
// el navegador (localStorage) automáticamente — así el proyecto funciona
// con un `npm run dev` solo, sin instalar SQLite ni levantar nada más.
// El resto de la app (TradesModal.vue, etc.) no necesita saber cuál de
// los dos modos está activo: la firma de estas funciones no cambia.

import { isBackendAvailable } from './apiAvailability.js'
import * as local from './local/tradesLocal.js'

const API_URL = import.meta.env.VITE_API_URL || '/api'

export async function getTrades() {
  if (await isBackendAvailable()) {
    const res = await fetch(`${API_URL}/trades`)
    if (!res.ok) throw new Error('Error al obtener los trades')
    return res.json()
  }
  return local.getAll()
}

export async function getTradesSummary() {
  if (await isBackendAvailable()) {
    const res = await fetch(`${API_URL}/trades/summary`)
    if (!res.ok) throw new Error('Error al obtener el resumen de resultados')
    return res.json()
  }
  return local.getSummary()
}

// data: { date, assetType, ticker, operation, quantity, price, fee?, notes? }
export async function createTrade(data) {
  if (await isBackendAvailable()) {
    const res = await fetch(`${API_URL}/trades`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || 'Error al crear el trade')
    }
    return res.json()
  }
  return local.create(data)
}

export async function updateTrade(id, data) {
  if (await isBackendAvailable()) {
    const res = await fetch(`${API_URL}/trades/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || 'Error al actualizar el trade')
    }
    return res.json()
  }
  return local.update(id, data)
}

export async function deleteTrade(id) {
  if (await isBackendAvailable()) {
    const res = await fetch(`${API_URL}/trades/${id}`, { method: 'DELETE' })
    if (!res.ok && res.status !== 204) throw new Error('Error al eliminar el trade')
    return
  }
  return local.remove(id)
}