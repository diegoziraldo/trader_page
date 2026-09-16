// src/services/alertsService.js
// Persiste las alertas de precio. Usa el backend real si está disponible;
// si no, cae a localStorage automáticamente (ver apiAvailability.js).

import { isBackendAvailable } from './apiAvailability.js';
import * as local from './local/alertsLocal.js';

const API_URL = import.meta.env.VITE_API_URL || '/api';

export async function getAlerts() {
  if (await isBackendAvailable()) {
    const res = await fetch(`${API_URL}/alerts`);
    if (!res.ok) throw new Error('Error al obtener alertas');
    return res.json();
  }
  return local.getAll();
}

// data: { ticker, type, price }
export async function createAlert(data) {
  if (await isBackendAvailable()) {
    const res = await fetch(`${API_URL}/alerts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Error al crear alerta');
    return res.json();
  }
  return local.create(data);
}

// data: { ticker?, type?, price?, triggered? }
export async function updateAlertRemote(id, data) {
  if (await isBackendAvailable()) {
    const res = await fetch(`${API_URL}/alerts/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Error al actualizar alerta');
    return res.json();
  }
  return local.update(id, data);
}

export async function deleteAlertRemote(id) {
  if (await isBackendAvailable()) {
    const res = await fetch(`${API_URL}/alerts/${id}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) throw new Error('Error al eliminar alerta');
    return;
  }
  return local.remove(id);
}