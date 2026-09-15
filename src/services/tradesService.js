// src/services/tradesService.js
//
// Persistencia híbrida de la bitácora de operaciones.
//
// PRIORIDAD:
// 1. API / SQLite / D1 cuando está disponible.
// 2. IndexedDB del navegador cuando no existe backend.
//
// Esto permite que el dashboard funcione tanto:
// - con Express + SQLite
// - con Cloudflare Functions + D1
// - como sitio estático sin base de datos
//
// La interfaz pública de este servicio NO cambia.
// TradesModal.vue puede seguir usando:
// getTrades()
// getTradesSummary()
// createTrade()
// updateTrade()
// deleteTrade()

const API_URL = import.meta.env.VITE_API_URL || '/api'

const DB_NAME = 'trading-dashboard-db'
const DB_VERSION = 1
const STORE_NAME = 'trades'

let dbPromise = null

// ============================================================
// INDEXEDDB
// ============================================================

function openDatabase() {
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB no está disponible en este navegador'))
      return
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = (event) => {
      const db = event.target.result

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, {
          keyPath: 'id',
          autoIncrement: true,
        })

        store.createIndex('date', 'date', { unique: false })
        store.createIndex('ticker', 'ticker', { unique: false })
      }
    }

    request.onsuccess = () => {
      const db = request.result

      db.onversionchange = () => {
        db.close()
      }

      resolve(db)
    }

    request.onerror = () => {
      reject(request.error || new Error('No se pudo abrir IndexedDB'))
    }
  })

  return dbPromise
}

async function idbGetAll() {
  const db = await openDatabase()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.getAll()

    request.onsuccess = () => {
      const trades = request.result || []

      trades.sort((a, b) => {
        const dateA = String(a.date || '')
        const dateB = String(b.date || '')

        if (dateA !== dateB) {
          return dateA.localeCompare(dateB)
        }

        return Number(a.id || 0) - Number(b.id || 0)
      })

      resolve(trades)
    }

    request.onerror = () => {
      reject(request.error || new Error('No se pudieron obtener los trades'))
    }
  })
}

async function idbCreate(data) {
  const db = await openDatabase()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)

    const trade = normalizeTrade(data)

    delete trade.id

    trade.createdAt = new Date().toISOString()

    const request = store.add(trade)

    request.onsuccess = () => {
      resolve({
        ...trade,
        id: request.result,
      })
    }

    request.onerror = () => {
      reject(request.error || new Error('No se pudo guardar el trade'))
    }
  })
}

async function idbUpdate(id, data) {
  const db = await openDatabase()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)

    const getRequest = store.get(id)

    getRequest.onsuccess = () => {
      const existing = getRequest.result

      if (!existing) {
        reject(new Error('Trade no encontrado'))
        return
      }

      const updated = {
        ...existing,
        ...normalizeTrade(data),
        id: existing.id,
        createdAt: existing.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      const putRequest = store.put(updated)

      putRequest.onsuccess = () => {
        resolve(updated)
      }

      putRequest.onerror = () => {
        reject(
          putRequest.error ||
          new Error('No se pudo actualizar el trade')
        )
      }
    }

    getRequest.onerror = () => {
      reject(
        getRequest.error ||
        new Error('No se pudo obtener el trade')
      )
    }
  })
}

async function idbDelete(id) {
  const db = await openDatabase()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)

    const request = store.delete(id)

    request.onsuccess = () => {
      resolve()
    }

    request.onerror = () => {
      reject(
        request.error ||
        new Error('No se pudo eliminar el trade')
      )
    }
  })
}

// ============================================================
// NORMALIZACIÓN
// ============================================================

function normalizeTrade(data = {}) {
  const quantity = Number(data.quantity) || 0
  const price = Number(data.price) || 0
  const fee = Number(data.fee) || 0

  const ccl =
    data.ccl !== null &&
    data.ccl !== undefined &&
    data.ccl !== ''
      ? Number(data.ccl)
      : null

  const ticker = String(data.ticker || '')
    .trim()
    .toUpperCase()

  const operation = String(data.operation || '').toUpperCase()

  const total =
    operation === 'COMPRA'
      ? quantity * price + fee
      : quantity * price - fee

  const priceUSD =
    ccl && ccl > 0
      ? Math.round((price / ccl) * 10000) / 10000
      : null

  return {
    ...(data.id !== undefined ? { id: data.id } : {}),
    date: data.date || '',
    assetType: data.assetType || 'CEDEAR',
    ticker,
    operation,
    quantity,
    price,
    fee,
    notes: String(data.notes || ''),
    ccl,
    priceUSD,
    total,
    createdAt: data.createdAt || null,
    updatedAt: data.updatedAt || null,
  }
}

// ============================================================
// RESUMEN
// ============================================================
//
// Mantiene la misma lógica que el backend actual:
// - costo promedio
// - invertido ARS
// - invertido USD
// - ganancia/pérdida realizada
// - posiciones abiertas
// - cantidad total de trades
//
// El backend actual calcula estas mismas métricas.
// ============================================================

function computeSummary(trades) {
  const bySymbol = {}

  for (const rawTrade of trades) {
    const t = normalizeTrade(rawTrade)

    if (!bySymbol[t.ticker]) {
      bySymbol[t.ticker] = {
        ticker: t.ticker,
        assetType: t.assetType,
        quantity: 0,
        avgCost: 0,
        invested: 0,
        realizedPL: 0,
        avgCostUSD: 0,
        investedUSD: 0,
        realizedPLUSD: 0,
        usdIncomplete: false,
      }
    }

    const s = bySymbol[t.ticker]

    const hasCCL = Number(t.ccl) > 0

    if (!hasCCL) {
      s.usdIncomplete = true
    }

    const priceUSD = hasCCL
      ? t.price / t.ccl
      : 0

    const feeUSD = hasCCL
      ? t.fee / t.ccl
      : 0

    if (t.operation === 'COMPRA') {
      const costoPrevio =
        s.avgCost * s.quantity

      const costoPrevioUSD =
        s.avgCostUSD * s.quantity

      const nuevaCantidad =
        s.quantity + t.quantity

      const nuevoCosto =
        costoPrevio +
        t.quantity * t.price +
        t.fee

      const nuevoCostoUSD =
        costoPrevioUSD +
        t.quantity * priceUSD +
        feeUSD

      s.avgCost =
        nuevaCantidad > 0
          ? nuevoCosto / nuevaCantidad
          : 0

      s.avgCostUSD =
        nuevaCantidad > 0
          ? nuevoCostoUSD / nuevaCantidad
          : 0

      s.quantity = nuevaCantidad

      s.invested = nuevoCosto

      s.investedUSD = nuevoCostoUSD
    } else {
      const pl =
        t.quantity *
          (t.price - s.avgCost) -
        t.fee

      const plUSD =
        t.quantity *
          (priceUSD - s.avgCostUSD) -
        feeUSD

      s.realizedPL += pl

      s.realizedPLUSD += plUSD

      s.quantity = Math.max(
        0,
        s.quantity - t.quantity
      )

      s.invested =
        s.avgCost * s.quantity

      s.investedUSD =
        s.avgCostUSD * s.quantity
    }
  }

  const bySymbolList =
    Object.values(bySymbol).map((s) => ({
      ...s,

      quantity:
        Math.round(s.quantity * 1e6) /
        1e6,

      avgCost:
        Math.round(s.avgCost * 100) /
        100,

      invested:
        Math.round(s.invested * 100) /
        100,

      realizedPL:
        Math.round(s.realizedPL * 100) /
        100,

      avgCostUSD:
        s.usdIncomplete
          ? null
          : Math.round(s.avgCostUSD * 100) /
            100,

      investedUSD:
        s.usdIncomplete
          ? null
          : Math.round(s.investedUSD * 100) /
            100,

      realizedPLUSD:
        s.usdIncomplete
          ? null
          : Math.round(s.realizedPLUSD * 100) /
            100,
    }))

  const totals = {
    realizedPL:
      Math.round(
        bySymbolList.reduce(
          (acc, s) =>
            acc + s.realizedPL,
          0
        ) * 100
      ) / 100,

    realizedPLUSD:
      Math.round(
        bySymbolList.reduce(
          (acc, s) =>
            acc +
            (s.realizedPLUSD || 0),
          0
        ) * 100
      ) / 100,

    invested:
      Math.round(
        bySymbolList.reduce(
          (acc, s) =>
            acc + s.invested,
          0
        ) * 100
      ) / 100,

    investedUSD:
      Math.round(
        bySymbolList.reduce(
          (acc, s) =>
            acc +
            (s.investedUSD || 0),
          0
        ) * 100
      ) / 100,

    openPositions:
      bySymbolList.filter(
        (s) => s.quantity > 0
      ).length,

    totalTrades:
      trades.length,
  }

  return {
    bySymbol: bySymbolList,
    totals,
  }
}

// ============================================================
// API
// ============================================================

async function apiGetTrades() {
  const res = await fetch(
    `${API_URL}/trades`
  )

  if (!res.ok) {
    throw new Error(
      `API trades respondió ${res.status}`
    )
  }

  return res.json()
}

async function apiGetTradesSummary() {
  const res = await fetch(
    `${API_URL}/trades/summary`
  )

  if (!res.ok) {
    throw new Error(
      `API summary respondió ${res.status}`
    )
  }

  return res.json()
}

async function apiCreateTrade(data) {
  const res = await fetch(
    `${API_URL}/trades`,
    {
      method: 'POST',
      headers: {
        'Content-Type':
          'application/json',
      },
      body: JSON.stringify(data),
    }
  )

  if (!res.ok) {
    const body =
      await res.json().catch(() => ({}))

    const error = new Error(
      body.error ||
      'Error al crear el trade'
    )

    // Guardamos el status para saber si
    // fue un error real de validación del backend.
    error.status = res.status

    throw error
  }

  return res.json()
}

async function apiUpdateTrade(id, data) {
  const res = await fetch(
    `${API_URL}/trades/${id}`,
    {
      method: 'PUT',
      headers: {
        'Content-Type':
          'application/json',
      },
      body: JSON.stringify(data),
    }
  )

  if (!res.ok) {
    const body =
      await res.json().catch(() => ({}))

    const error = new Error(
      body.error ||
      'Error al actualizar el trade'
    )

    error.status = res.status

    throw error
  }

  return res.json()
}

async function apiDeleteTrade(id) {
  const res = await fetch(
    `${API_URL}/trades/${id}`,
    {
      method: 'DELETE',
    }
  )

  if (!res.ok && res.status !== 204) {
    const error = new Error(
      'Error al eliminar el trade'
    )

    error.status = res.status

    throw error
  }
}

// ============================================================
// DETECCIÓN DE FALLA DE API
// ============================================================
//
// IMPORTANTE:
//
// Si la API responde 400, 422, etc. NO usamos IndexedDB,
// porque significa que el backend existe y rechazó los datos.
//
// Si tenemos:
// - 404
// - 405
// - 500
// - error de red
// - ERR_CONNECTION_REFUSED
// - servidor estático sin /api
//
// entonces usamos IndexedDB.
// ============================================================

function shouldUseIndexedDB(error) {
  if (!error) return true

  const status = error.status

  // Errores de validación:
// el backend existe, por lo tanto NO hacemos fallback.
  if (
    status === 400 ||
    status === 401 ||
    status === 403 ||
    status === 409 ||
    status === 422
  ) {
    return false
  }

  // Si la API no existe o el servidor
  // no está funcionando, IndexedDB toma el control.
  return true
}

// ============================================================
// API PÚBLICA
// ============================================================

export async function getTrades() {
  try {
    const trades = await apiGetTrades()

    return trades
  } catch (error) {
    console.warn(
      '[Trades] API no disponible. Usando IndexedDB.',
      error
    )

    return idbGetAll()
  }
}

export async function getTradesSummary() {
  try {
    return await apiGetTradesSummary()
  } catch (error) {
    console.warn(
      '[Trades] API summary no disponible. Calculando desde IndexedDB.',
      error
    )

    const trades = await idbGetAll()

    return computeSummary(trades)
  }
}

export async function createTrade(data) {
  try {
    // Primero intentamos guardar en la API.
    return await apiCreateTrade(data)
  } catch (error) {
    // Si el backend existe pero rechazó
    // los datos, mostramos el error real.
    if (!shouldUseIndexedDB(error)) {
      throw error
    }

    console.warn(
      '[Trades] API no disponible. Guardando trade en IndexedDB.'
    )

    // Fallback automático al navegador.
    return await idbCreate(data)
  }
}

export async function updateTrade(id, data) {
  try {
    return await apiUpdateTrade(id, data)
  } catch (error) {
    if (!shouldUseIndexedDB(error)) {
      throw error
    }

    console.warn(
      '[Trades] API no disponible. Actualizando trade en IndexedDB.'
    )

    return await idbUpdate(id, data)
  }
}

export async function deleteTrade(id) {
  try {
    await apiDeleteTrade(id)
  } catch (error) {
    if (!shouldUseIndexedDB(error)) {
      throw error
    }

    console.warn(
      '[Trades] API no disponible. Eliminando trade desde IndexedDB.'
    )

    await idbDelete(id)
  }
}