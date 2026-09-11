// src/services/watchlistService.js
// Persiste la watchlist de "Acciones USA" en el backend (Express + SQLite).

const API_URL = import.meta.env.VITE_API_URL || '/api';

export async function getUsWatchlist() {
  const res = await fetch(`${API_URL}/watchlist/us`);
  if (!res.ok) throw new Error('Error al obtener la watchlist');
  return res.json();
}

// data: { symbol, name? }
export async function addUsWatchlistTicker(data) {
  const res = await fetch(`${API_URL}/watchlist/us`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Error al agregar el ticker');
  return res.json();
}

export async function removeUsWatchlistTicker(symbol) {
  const res = await fetch(`${API_URL}/watchlist/us/${encodeURIComponent(symbol)}`, {
    method: 'DELETE',
  });
  if (!res.ok && res.status !== 204) throw new Error('Error al eliminar el ticker');
}