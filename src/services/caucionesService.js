// src/services/caucionesService.js
// Persiste las cauciones (colocaciones a plazo con TNA pactada). Igual que
// tradesService.js: si hay backend (Express local o Cloudflare Pages
// Functions) lo usa, si no, cae automáticamente a localStorage.

import { isBackendAvailable } from './apiAvailability.js'
import * as local from './local/caucionesLocal.js'

const API_URL = import.meta.env.VITE_API_URL || '/api'

export async function getCauciones() {
  if (await isBackendAvailable()) {
    const res = await fetch(`${API_URL}/cauciones`)
    if (!res.ok) throw new Error('Error al obtener las cauciones')
    return res.json()
  }
  return local.getAll()
}

export async function getCaucionesSummary() {
  if (await isBackendAvailable()) {
    const res = await fetch(`${API_URL}/cauciones/summary`)
    if (!res.ok) throw new Error('Error al obtener el resumen de cauciones')
    return res.json()
  }
  return local.getSummary()
}

// data: { startDate, termDays, amount, currency, tna, broker?, feeType, feeValue, status?, notes? }
export async function createCaucion(data) {
  if (await isBackendAvailable()) {
    const res = await fetch(`${API_URL}/cauciones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || 'Error al crear la caución')
    }
    return res.json()
  }
  return local.create(data)
}

export async function updateCaucion(id, data) {
  if (await isBackendAvailable()) {
    const res = await fetch(`${API_URL}/cauciones/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || 'Error al actualizar la caución')
    }
    return res.json()
  }
  return local.update(id, data)
}

export async function deleteCaucion(id) {
  if (await isBackendAvailable()) {
    const res = await fetch(`${API_URL}/cauciones/${id}`, { method: 'DELETE' })
    if (!res.ok && res.status !== 204) throw new Error('Error al eliminar la caución')
    return
  }
  return local.remove(id)
}
