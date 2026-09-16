// src/services/journalService.js
// Persiste la planilla profesional de trading (plan de trade completo, para
// cualquier instrumento: acciones, CEDEARs, forex, futuros, cripto, opciones,
// índices, materias primas, bonos) en el backend (Express+SQLite en local,
// Cloudflare Functions+D1 en producción).

const API_URL = import.meta.env.VITE_API_URL || '/api'

export async function getJournalEntries() {
  const res = await fetch(`${API_URL}/journal`)
  if (!res.ok) throw new Error('Error al obtener la planilla de trading')
  return res.json()
}

export async function getJournalSummary() {
  const res = await fetch(`${API_URL}/journal/summary`)
  if (!res.ok) throw new Error('Error al obtener el resumen de la planilla')
  return res.json()
}

// data: ver JournalModal.vue -> emptyForm() para la forma completa del payload
export async function createJournalEntry(data) {
  const res = await fetch(`${API_URL}/journal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || 'Error al crear el registro')
  }
  return res.json()
}

export async function updateJournalEntry(id, data) {
  const res = await fetch(`${API_URL}/journal/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || 'Error al actualizar el registro')
  }
  return res.json()
}

export async function deleteJournalEntry(id) {
  const res = await fetch(`${API_URL}/journal/${id}`, { method: 'DELETE' })
  if (!res.ok && res.status !== 204) throw new Error('Error al eliminar el registro')
}