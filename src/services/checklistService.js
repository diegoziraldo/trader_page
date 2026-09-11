// src/services/checklistService.js
// Persiste la checklist de compra (tickers + indicadores) en el backend
// (Express + SQLite).

const API_URL = import.meta.env.VITE_API_URL || '/api';

export async function getChecklist() {
  const res = await fetch(`${API_URL}/checklist`);
  if (!res.ok) throw new Error('Error al obtener la checklist');
  return res.json();
}

// data: { symbol, sector, indicators: [{ text, weight }] }
export async function createChecklistTicker(data) {
  const res = await fetch(`${API_URL}/checklist`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Error al crear el ticker');
  return res.json();
}

// data: { sector?, expanded?, indicators? }
export async function updateChecklistTicker(id, data) {
  const res = await fetch(`${API_URL}/checklist/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Error al actualizar el ticker');
  return res.json();
}

export async function deleteChecklistTicker(id) {
  const res = await fetch(`${API_URL}/checklist/${id}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 204) throw new Error('Error al eliminar el ticker');
}

// data: { text, weight }
export async function addChecklistIndicator(tickerId, data) {
  const res = await fetch(`${API_URL}/checklist/${tickerId}/indicators`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Error al agregar el indicador');
  return res.json();
}

// data: { text?, weight?, checked? }
export async function updateChecklistIndicator(id, data) {
  const res = await fetch(`${API_URL}/checklist/indicators/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Error al actualizar el indicador');
  return res.json();
}

export async function deleteChecklistIndicator(id) {
  const res = await fetch(`${API_URL}/checklist/indicators/${id}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 204) throw new Error('Error al eliminar el indicador');
}