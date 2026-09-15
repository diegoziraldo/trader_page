// src/services/watchlistService.js
// Persiste la watchlist de "Acciones USA". Usa el backend real si está
// disponible; si no, cae a localStorage automáticamente (con la misma
// siembra por defecto que trae schema.sql). Ver apiAvailability.js.

import { isBackendAvailable } from './apiAvailability.js';
import * as local from './local/watchlistLocal.js';

const API_URL = import.meta.env.VITE_API_URL || '/api';

export async function getUsWatchlist() {
  if (await isBackendAvailable()) {
    const res = await fetch(`${API_URL}/watchlist/us`);
    if (!res.ok) throw new Error('Error al obtener la watchlist');
    return res.json();
  }
  return local.getAll();
}

// data: { symbol, name? }
export async function addUsWatchlistTicker(data) {
  if (await isBackendAvailable()) {
    const res = await fetch(`${API_URL}/watchlist/us`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Error al agregar el ticker');
    return res.json();
  }
  return local.create(data);
}

export async function removeUsWatchlistTicker(symbol) {
  if (await isBackendAvailable()) {
    const res = await fetch(`${API_URL}/watchlist/us/${encodeURIComponent(symbol)}`, {
      method: 'DELETE',
    });
    if (!res.ok && res.status !== 204) throw new Error('Error al eliminar el ticker');
    return;
  }
  return local.remove(symbol);
}
