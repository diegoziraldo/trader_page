// src/services/apiAvailability.js
//
// Detecta si hay un backend real corriendo (Express local en :3001, o
// Cloudflare Pages Functions con `npm run pages:dev`) pegándole una sola vez
// a /api/health, con timeout corto para no colgar la app si no hay nada
// escuchando en esa URL.
//
// Si no hay backend, cada servicio (trades/alerts/checklist/watchlist) cae
// automáticamente a guardar todo en el navegador (localStorage) — así el
// proyecto funciona con un simple `npm run dev`, sin instalar SQLite, sin
// levantar wrangler ni nada más.

const API_URL = import.meta.env.VITE_API_URL || '/api'
const HEALTH_TIMEOUT_MS = 1500

// Se cachea la promesa (no solo el resultado) para que, si varios servicios
// preguntan "¿hay backend?" casi al mismo tiempo al arrancar la app, todos
// esperen la MISMA verificación en vez de disparar un health-check cada uno.
let checkPromise = null

async function checkBackend() {
  try {
    const res = await fetch(`${API_URL}/health`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    })
    return res.ok
  } catch {
    // Sin conexión, backend caído, CORS, timeout, lo que sea: tratamos
    // cualquier falla igual, como "no hay backend disponible".
    return false
  }
}

// true  -> hay backend real, los servicios deben usar fetch como siempre.
// false -> no hay nada escuchando en /api, usar el almacenamiento local.
export function isBackendAvailable() {
  if (!checkPromise) checkPromise = checkBackend()
  return checkPromise
}

// Fuerza a repetir la detección (por ejemplo desde un botón "Reintentar
// conexión" en la UI, si el usuario levanta el backend después de abrir
// la app y no quiere recargar la página).
export function resetBackendCheck() {
  checkPromise = null
}