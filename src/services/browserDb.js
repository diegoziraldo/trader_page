// src/services/browserDb.js
//
// Persistencia local del dashboard mediante IndexedDB.
// Se utiliza automáticamente cuando SQLite/D1 no está disponible.
//
// NO reemplaza al backend.
// El servicio correspondiente intenta primero la API y solamente
// cae a IndexedDB cuando la API no está disponible.
//
// Stores:
//   alerts
//   checklist
//   journal
//   trades
//   watchlist

const DB_NAME = 'trading-dashboard-browser-db'
const DB_VERSION = 1

const STORES = [
  'alerts',
  'checklist',
  'journal',
  'trades',
  'watchlist',
]

let dbPromise = null

function openDB() {
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB no está disponible en este navegador'))
      return
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result

      STORES.forEach((storeName) => {
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName, { keyPath: 'id' })
        }
      })
    }

    request.onsuccess = () => {
      resolve(request.result)
    }

    request.onerror = () => {
      reject(request.error || new Error('No se pudo abrir IndexedDB'))
    }
  })

  return dbPromise
}

export async function browserDbGetAll(storeName) {
  const db = await openDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly')
    const store = transaction.objectStore(storeName)
    const request = store.getAll()

    request.onsuccess = () => {
      resolve(request.result || [])
    }

    request.onerror = () => {
      reject(request.error || new Error(`No se pudo leer ${storeName}`))
    }
  })
}

export async function browserDbGet(storeName, id) {
  const db = await openDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly')
    const store = transaction.objectStore(storeName)
    const request = store.get(id)

    request.onsuccess = () => {
      resolve(request.result || null)
    }

    request.onerror = () => {
      reject(request.error || new Error(`No se pudo leer ${storeName}`))
    }
  })
}

export async function browserDbPut(storeName, value) {
  const db = await openDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite')
    const store = transaction.objectStore(storeName)
    const request = store.put(value)

    request.onsuccess = () => {
      resolve(value)
    }

    request.onerror = () => {
      reject(request.error || new Error(`No se pudo guardar en ${storeName}`))
    }
  })
}

export async function browserDbDelete(storeName, id) {
  const db = await openDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite')
    const store = transaction.objectStore(storeName)
    const request = store.delete(id)

    request.onsuccess = () => {
      resolve()
    }

    request.onerror = () => {
      reject(request.error || new Error(`No se pudo eliminar de ${storeName}`))
    }
  })
}

export async function browserDbClear(storeName) {
  const db = await openDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite')
    const store = transaction.objectStore(storeName)
    const request = store.clear()

    request.onsuccess = () => {
      resolve()
    }

    request.onerror = () => {
      reject(request.error || new Error(`No se pudo limpiar ${storeName}`))
    }
  })
}

export function createBrowserId() {
  // IDs negativos para diferenciarlos de los IDs normalmente generados
  // por SQLite/D1.
  return -Date.now() - Math.floor(Math.random() * 100000)
}

export function shouldFallbackToBrowser(error) {
  if (!error) return true

  if (typeof error.status === 'number') {
    // Errores de validación/autorización/conflicto:
    // NO los ocultamos usando IndexedDB.
    if ([400, 401, 403, 409, 422].includes(error.status)) {
      return false
    }

    // API inexistente, servidor caído o error interno:
    // permitimos fallback local.
    if ([404, 405, 500, 502, 503, 504].includes(error.status)) {
      return true
    }
  }

  // Error de red / fetch / CORS / backend inexistente.
  return true
}

export async function requestJson(url, options = {}) {
  let response

  try {
    response = await fetch(url, options)
  } catch (error) {
    error.isNetworkError = true
    throw error
  }

  if (!response.ok) {
    let body = {}

    try {
      body = await response.json()
    } catch {
      // La respuesta no tenía JSON.
    }

    const error = new Error(
      body.error ||
      body.message ||
      `Error HTTP ${response.status}`
    )

    error.status = response.status
    error.body = body

    throw error
  }

  if (response.status === 204) {
    return null
  }

  return response.json()
}

export function isoNow() {
  return new Date().toISOString()
}