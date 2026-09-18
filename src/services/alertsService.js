// Persistencia de alertas. Usa API/DB cuando está disponible y localStorage
// como respaldo cuando no hay backend o la base está temporalmente caída.

import { ApiUnavailableError, deleteJson, getJson, postJson, putJson } from './apiClient'
import {
  cacheAlerts,
  isLocalId,
  localCreateAlert,
  localDeleteAlert,
  localGetAlerts,
  localUpdateAlert,
} from './localStorageDb'

export async function getAlerts() {
  try {
    const rows = await getJson('/alerts')
    cacheAlerts(rows)
    return localGetAlerts()
  } catch (error) {
    if (error instanceof ApiUnavailableError) return localGetAlerts()
    throw error
  }
}

export async function createAlert(data) {
  try {
    const created = await postJson('/alerts', data)
    // Conserva una copia para poder seguir trabajando durante una caída.
    cacheAlerts([created, ...localGetAlerts()])
    return created
  } catch (error) {
    if (error instanceof ApiUnavailableError) return localCreateAlert(data)
    throw error
  }
}

export async function updateAlertRemote(id, data) {
  if (isLocalId(id)) return localUpdateAlert(id, data)
  try {
    const updated = await putJson(`/alerts/${encodeURIComponent(id)}`, data)
    cacheAlerts([updated, ...localGetAlerts().filter((row) => String(row.id) !== String(updated.id))])
    return updated
  } catch (error) {
    if (error instanceof ApiUnavailableError) return localUpdateAlert(id, data)
    throw error
  }
}

export async function deleteAlertRemote(id) {
  if (isLocalId(id)) return localDeleteAlert(id)
  try {
    await deleteJson(`/alerts/${encodeURIComponent(id)}`)
    try {
      localDeleteAlert(id)
    } catch {
      // No había copia cacheada: la eliminación remota ya fue exitosa.
    }
  } catch (error) {
    if (error instanceof ApiUnavailableError) return localDeleteAlert(id)
    throw error
  }
}
