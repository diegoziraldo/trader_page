// src/services/alertsService.js
// Habla con el backend (Express + SQLite) para persistir las alertas.

const API_URL = import.meta.env.VITE_API_URL || '/api';

export async function getAlerts() {
  const res = await fetch(`${API_URL}/alerts`);
  if (!res.ok) throw new Error('Error al obtener alertas');
  return res.json();
}

// data: { ticker, type, price }
export async function createAlert(data) {
  const res = await fetch(`${API_URL}/alerts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Error al crear alerta');
  return res.json();
}

// data: { ticker?, type?, price?, triggered? }
export async function updateAlertRemote(id, data) {
  const res = await fetch(`${API_URL}/alerts/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Error al actualizar alerta');
  return res.json();
}

export async function deleteAlertRemote(id) {
  const res = await fetch(`${API_URL}/alerts/${id}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 204) throw new Error('Error al eliminar alerta');
}