// src/services/portfoliosService.js
// Persiste las carteras (armado de portafolios) y sus posiciones. Igual que
// tradesService.js: si hay backend lo usa, si no, cae a localStorage.

import { isBackendAvailable } from './apiAvailability.js'
import * as local from './local/portfoliosLocal.js'

const API_URL = import.meta.env.VITE_API_URL || '/api'

async function handle(res, fallbackMsg) {
  if (!res.ok && res.status !== 204) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || fallbackMsg)
  }
  if (res.status === 204) return null
  return res.json()
}

// ---------- Carteras ----------

export async function getPortfolios() {
  if (await isBackendAvailable()) {
    const res = await fetch(`${API_URL}/portfolios`)
    return handle(res, 'Error al obtener las carteras')
  }
  return local.getAllPortfolios()
}

export async function createPortfolio(data) {
  if (await isBackendAvailable()) {
    const res = await fetch(`${API_URL}/portfolios`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    return handle(res, 'Error al crear la cartera')
  }
  return local.createPortfolio(data)
}

export async function updatePortfolio(id, data) {
  if (await isBackendAvailable()) {
    const res = await fetch(`${API_URL}/portfolios/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    return handle(res, 'Error al actualizar la cartera')
  }
  return local.updatePortfolio(id, data)
}

export async function deletePortfolio(id) {
  if (await isBackendAvailable()) {
    const res = await fetch(`${API_URL}/portfolios/${id}`, { method: 'DELETE' })
    if (!res.ok && res.status !== 204) throw new Error('Error al eliminar la cartera')
    return
  }
  return local.removePortfolio(id)
}

// ---------- Posiciones ----------

export async function getPositions(portfolioId) {
  if (await isBackendAvailable()) {
    const res = await fetch(`${API_URL}/portfolios/${portfolioId}/positions`)
    return handle(res, 'Error al obtener las posiciones')
  }
  return local.getPositions(portfolioId)
}

// data: { assetType, ticker, underlyingTicker?, ratio?, sector?, quantity, avgPrice, targetWeight?, manualPrice? }
export async function createPosition(portfolioId, data) {
  if (await isBackendAvailable()) {
    const res = await fetch(`${API_URL}/portfolios/${portfolioId}/positions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    return handle(res, 'Error al agregar la posición')
  }
  return local.createPosition(portfolioId, data)
}

export async function updatePosition(positionId, data) {
  if (await isBackendAvailable()) {
    const res = await fetch(`${API_URL}/portfolios/positions/${positionId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    return handle(res, 'Error al actualizar la posición')
  }
  return local.updatePosition(positionId, data)
}

export async function deletePosition(positionId) {
  if (await isBackendAvailable()) {
    const res = await fetch(`${API_URL}/portfolios/positions/${positionId}`, { method: 'DELETE' })
    if (!res.ok && res.status !== 204) throw new Error('Error al eliminar la posición')
    return
  }
  return local.removePosition(positionId)
}
