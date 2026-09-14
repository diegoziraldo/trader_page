// src/services/tradesService.js
// Persiste la bitácora de operaciones (CEDEARs / acciones argentinas) en el
// backend (Express + SQLite).

const API_URL = import.meta.env.VITE_API_URL || '/api'

export async function getTrades() {
  const res = await fetch(`${API_URL}/trades`)
  if (!res.ok) throw new Error('Error al obtener los trades')
  return res.json()
}

export async function getTradesSummary() {
  const res = await fetch(`${API_URL}/trades/summary`)
  if (!res.ok) throw new Error('Error al obtener el resumen de resultados')
  return res.json()
}

// data: { date, assetType, ticker, operation, quantity, price, fee?, notes? }
export async function createTrade(data) {
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

export async function updateTrade(id, data) {
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

export async function deleteTrade(id) {
  const res = await fetch(`${API_URL}/trades/${id}`, { method: 'DELETE' })
  if (!res.ok && res.status !== 204) throw new Error('Error al eliminar el trade')
}