// src/services/checklistService.js
// Persiste la checklist de compra (tickers + indicadores). Usa el backend
// real si está disponible; si no, cae a localStorage automáticamente
// (ver apiAvailability.js).

import { isBackendAvailable } from './apiAvailability.js';
import * as local from './local/checklistLocal.js';

const API_URL = import.meta.env.VITE_API_URL || '/api';

export async function getChecklist() {
  if (await isBackendAvailable()) {
    const res = await fetch(`${API_URL}/checklist`);
    if (!res.ok) throw new Error('Error al obtener la checklist');
    return res.json();
  }
  return local.getAll();
}

// data: { symbol, sector, indicators: [{ text, weight }] }
export async function createChecklistTicker(data) {
  if (await isBackendAvailable()) {
    const res = await fetch(`${API_URL}/checklist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Error al crear el ticker');
    return res.json();
  }
  return local.create(data);
}

// data: { sector?, expanded?, indicators? }
export async function updateChecklistTicker(id, data) {
  if (await isBackendAvailable()) {
    const res = await fetch(`${API_URL}/checklist/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Error al actualizar el ticker');
    return res.json();
  }
  return local.update(id, data);
}

export async function deleteChecklistTicker(id) {
  if (await isBackendAvailable()) {
    const res = await fetch(`${API_URL}/checklist/${id}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) throw new Error('Error al eliminar el ticker');
    return;
  }
  return local.remove(id);
}

// data: { text, weight }
export async function addChecklistIndicator(tickerId, data) {
  if (await isBackendAvailable()) {
    const res = await fetch(`${API_URL}/checklist/${tickerId}/indicators`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Error al agregar el indicador');
    return res.json();
  }
  return local.addIndicator(tickerId, data);
}

// data: { text?, weight?, checked? }
export async function updateChecklistIndicator(id, data) {
  if (await isBackendAvailable()) {
    const res = await fetch(`${API_URL}/checklist/indicators/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Error al actualizar el indicador');
    return res.json();
  }
  return local.updateIndicator(id, data);
}

export async function deleteChecklistIndicator(id) {
  if (await isBackendAvailable()) {
    const res = await fetch(`${API_URL}/checklist/indicators/${id}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) throw new Error('Error al eliminar el indicador');
    return;
  }
  return local.removeIndicator(id);
}
