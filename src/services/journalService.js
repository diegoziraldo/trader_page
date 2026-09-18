// Persistencia de la planilla profesional. API/DB como fuente primaria y
// localStorage como respaldo cuando no hay backend disponible.

import { ApiUnavailableError, deleteJson, getJson, postJson, putJson } from './apiClient'
import {
  cacheJournal,
  isLocalId,
  localCreateJournal,
  localDeleteJournal,
  localGetJournal,
  localGetJournalSummary,
  localUpdateJournal,
} from './localStorageDb'

function hasUnsyncedJournal() {
  return localGetJournal().some((entry) => isLocalId(entry.id))
}

export async function getJournalEntries() {
  try {
    const rows = await getJson('/journal')
    cacheJournal(rows)
    return localGetJournal()
  } catch (error) {
    if (error instanceof ApiUnavailableError) return localGetJournal()
    throw error
  }
}

export async function getJournalSummary() {
  try {
    const summary = await getJson('/journal/summary')
    if (hasUnsyncedJournal()) return localGetJournalSummary()
    return summary
  } catch (error) {
    if (error instanceof ApiUnavailableError) return localGetJournalSummary()
    throw error
  }
}

export async function createJournalEntry(data) {
  try {
    const created = await postJson('/journal', data)
    cacheJournal([created, ...localGetJournal().filter((row) => String(row.id) !== String(created.id))])
    return created
  } catch (error) {
    if (error instanceof ApiUnavailableError) return localCreateJournal(data)
    throw error
  }
}

export async function updateJournalEntry(id, data) {
  if (isLocalId(id)) return localUpdateJournal(id, data)
  try {
    const updated = await putJson(`/journal/${encodeURIComponent(id)}`, data)
    cacheJournal([updated, ...localGetJournal().filter((row) => String(row.id) !== String(updated.id))])
    return updated
  } catch (error) {
    if (error instanceof ApiUnavailableError) return localUpdateJournal(id, data)
    throw error
  }
}

export async function deleteJournalEntry(id) {
  if (isLocalId(id)) return localDeleteJournal(id)
  try {
    await deleteJson(`/journal/${encodeURIComponent(id)}`)
    try {
      localDeleteJournal(id)
    } catch {
      // No había copia local: la eliminación remota ya fue exitosa.
    }
  } catch (error) {
    if (error instanceof ApiUnavailableError) return localDeleteJournal(id)
    throw error
  }
}
