// src/services/caucionesService.js
// Persiste las cauciones bursátiles colocadas. Mismo patrón que
// tradesService.js: usa el backend real si lo detecta, y si no, cae solo a
// localStorage — el componente no necesita saber cuál de los dos está activo.

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

// data: { fecha, importe, tasa, dias, interes, notes? }
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
