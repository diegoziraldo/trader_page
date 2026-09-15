// src/services/localStore.js
//
// Micro "base de datos" en localStorage: una tabla = una clave, guardada
// como JSON. La usan automáticamente los servicios (trades/alerts/
// checklist/watchlist) cuando apiAvailability detecta que no hay backend.
//
// No requiere instalar nada: localStorage ya está en cualquier navegador.
// Ojo con sus límites reales, para que no sorprendan más adelante:
//  - Es por navegador y por dispositivo (no sincroniza entre PC y celular).
//  - Se pierde si el usuario borra datos de navegación del sitio.
//  - Tiene un límite de tamaño (~5MB típico), de sobra para esta bitácora.

const PREFIX = 'vuefinanzas:'

function readTable(name, fallback = []) {
  try {
    const raw = localStorage.getItem(PREFIX + name)
    if (raw == null) return structuredClone(fallback)
    return JSON.parse(raw)
  } catch (e) {
    console.error(`No se pudo leer "${name}" del almacenamiento local`, e)
    return structuredClone(fallback)
  }
}

function writeTable(name, rows) {
  try {
    localStorage.setItem(PREFIX + name, JSON.stringify(rows))
  } catch (e) {
    console.error(`No se pudo guardar "${name}" en el almacenamiento local`, e)
    throw new Error(
      'No se pudo guardar en el navegador. Puede que el almacenamiento local esté lleno o deshabilitado (por ejemplo, en una ventana privada).'
    )
  }
}

// IDs autoincrementales por tabla, guardados aparte para no depender de
// recorrer la tabla en cada alta (y no repetir un id si se borra el último
// registro cargado).
function nextId(name) {
  const key = PREFIX + name + ':seq'
  const current = Number(localStorage.getItem(key) || 0) + 1
  localStorage.setItem(key, String(current))
  return current
}

// Marca si una tabla ya fue sembrada con datos por defecto, para no volver
// a insertarlos si el usuario los borró a propósito.
function wasSeeded(name) {
  return localStorage.getItem(PREFIX + name + ':seeded') === '1'
}

function markSeeded(name) {
  localStorage.setItem(PREFIX + name + ':seeded', '1')
}

export const localStore = { readTable, writeTable, nextId, wasSeeded, markSeeded }
