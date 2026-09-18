// Cliente HTTP único para todas las APIs persistentes del proyecto.
// - Normaliza VITE_API_URL para aceptar tanto https://host como https://host/api.
// - Distingue una API/base de datos caída de un error real de validación o datos.
// - Devuelve errores estructurados para que los servicios puedan activar el
//   respaldo local únicamente cuando corresponde.

function normalizeApiUrl(raw) {
  const value = String(raw ?? '').trim().replace(/\/+$/, '')
  if (!value || value === '/') return '/api'
  return /\/api$/i.test(value) ? value : `${value}/api`
}

export const API_URL = normalizeApiUrl(import.meta.env.VITE_API_URL)

export class ApiUnavailableError extends Error {
  constructor(message = 'La API no está disponible') {
    super(message)
    this.name = 'ApiUnavailableError'
    this.code = 'API_UNAVAILABLE'
    this.isUnavailable = true
  }
}

export class ApiError extends Error {
  constructor(message, status = 500, code = 'API_ERROR') {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.isUnavailable = false
  }
}

async function safeJson(res) {
  const type = res.headers.get('content-type') || ''
  if (!type.toLowerCase().includes('application/json')) return null
  return res.json().catch(() => null)
}

export async function requestJson(path, options = {}) {
  const timeoutMs = options.timeoutMs ?? 8000
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  const fetchOptions = { ...options, timeoutMs: undefined, signal: controller.signal }
  try {
    const res = await fetch(`${API_URL}${path}`, fetchOptions)
    const data = await safeJson(res)
    const contentType = (res.headers.get('content-type') || '').toLowerCase()

    // Cloudflare/Express fuera de servicio.
    if ([502, 503, 504].includes(res.status)) {
      throw new ApiUnavailableError(data?.error || 'La API o la base de datos no está disponible')
    }

    // Cuando /api no existe, Vite/Pages puede devolver HTML (index.html).
    if (res.ok && !contentType.includes('application/json') && res.status !== 204) {
      throw new ApiUnavailableError('La ruta de la API no está disponible en este entorno')
    }

    if (!res.ok) {
      throw new ApiError(
        data?.error || `Error HTTP ${res.status}`,
        res.status,
        data?.code || 'API_ERROR',
      )
    }

    if (res.status === 204) return null
    return data
  } catch (error) {
    if (error?.isUnavailable) throw error
    if (error?.name === 'AbortError') {
      throw new ApiUnavailableError('La API no respondió dentro del tiempo esperado')
    }
    if (error instanceof TypeError) {
      throw new ApiUnavailableError('No se pudo conectar con la API')
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

export const getJson = (path) => requestJson(path)
export const postJson = (path, body) => requestJson(path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})
export const putJson = (path, body) => requestJson(path, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})
export const deleteJson = (path) => requestJson(path, { method: 'DELETE' })
