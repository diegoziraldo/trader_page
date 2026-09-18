// Persistencia de checklist + indicadores. API/DB como fuente primaria y
// localStorage como respaldo cuando no hay backend disponible.

import { ApiUnavailableError, deleteJson, getJson, postJson, putJson } from './apiClient'
import {
  cacheChecklist,
  cacheChecklistIndicatorCreated,
  cacheChecklistIndicatorDeleted,
  cacheChecklistIndicatorUpdated,
  isLocalId,
  localAddChecklistIndicator,
  localCreateChecklist,
  localDeleteChecklistIndicator,
  localDeleteChecklistTicker,
  localGetChecklist,
  localUpdateChecklistIndicator,
  localUpdateChecklistTicker,
} from './localStorageDb'

export async function getChecklist() {
  try {
    const rows = await getJson('/checklist')
    cacheChecklist(rows)
    return localGetChecklist()
  } catch (error) {
    if (error instanceof ApiUnavailableError) return localGetChecklist()
    throw error
  }
}

export async function createChecklistTicker(data) {
  try {
    const created = await postJson('/checklist', data)
    cacheChecklist([created, ...localGetChecklist().filter((row) => row.symbol !== created.symbol)])
    return created
  } catch (error) {
    if (error instanceof ApiUnavailableError) return localCreateChecklist(data)
    throw error
  }
}

export async function updateChecklistTicker(id, data) {
  if (isLocalId(id)) return localUpdateChecklistTicker(id, data)
  try {
    const updated = await putJson(`/checklist/${encodeURIComponent(id)}`, data)
    cacheChecklist([updated, ...localGetChecklist().filter((row) => String(row.id) !== String(updated.id))])
    return updated
  } catch (error) {
    if (error instanceof ApiUnavailableError) return localUpdateChecklistTicker(id, data)
    throw error
  }
}

export async function deleteChecklistTicker(id) {
  if (isLocalId(id)) return localDeleteChecklistTicker(id)
  try {
    await deleteJson(`/checklist/${encodeURIComponent(id)}`)
    try {
      localDeleteChecklistTicker(id)
    } catch {
      // No había copia local: la eliminación remota ya fue exitosa.
    }
  } catch (error) {
    if (error instanceof ApiUnavailableError) return localDeleteChecklistTicker(id)
    throw error
  }
}

export async function addChecklistIndicator(tickerId, data) {
  if (isLocalId(tickerId)) return localAddChecklistIndicator(tickerId, data)
  try {
    const created = await postJson(`/checklist/${encodeURIComponent(tickerId)}/indicators`, data)
    cacheChecklistIndicatorCreated(tickerId, created)
    return created
  } catch (error) {
    if (error instanceof ApiUnavailableError) return localAddChecklistIndicator(tickerId, data)
    throw error
  }
}

export async function updateChecklistIndicator(id, data) {
  if (isLocalId(id)) return localUpdateChecklistIndicator(id, data)
  try {
    const updated = await putJson(`/checklist/indicators/${encodeURIComponent(id)}`, data)
    cacheChecklistIndicatorUpdated(updated)
    return updated
  } catch (error) {
    if (error instanceof ApiUnavailableError) return localUpdateChecklistIndicator(id, data)
    throw error
  }
}

export async function deleteChecklistIndicator(id) {
  if (isLocalId(id)) return localDeleteChecklistIndicator(id)
  try {
    await deleteJson(`/checklist/indicators/${encodeURIComponent(id)}`)
    cacheChecklistIndicatorDeleted(id)
    return
  } catch (error) {
    if (error instanceof ApiUnavailableError) return localDeleteChecklistIndicator(id)
    throw error
  }
}
