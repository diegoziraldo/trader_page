// src/composables/useStrategyLab.js
//
// Estado compartido (singleton a nivel de módulo) del Strategy Lab. Después de
// cada alta/edición/baja se recarga desde el backend, así TODOS los
// indicadores y gráficos se recalculan solos a partir de datos reales.

import { ref, reactive, computed } from 'vue'
import { strategyLabApi as api } from '../services/strategyLab/strategyLabService.js'
import { applyFilters } from '../services/strategyLab/stats.js'

const strategies = ref([])
const trades = ref([])
const loading = ref(false)
const loaded = ref(false)
const error = ref('')

// Filtros globales de las pestañas de análisis.
const filters = reactive({ recordType: 'ALL', basis: 'R', dateFrom: '', dateTo: '' })

let inflight = null
async function load() {
  if (inflight) return inflight
  loading.value = true
  error.value = ''
  inflight = (async () => {
    try {
      const [s, t] = await Promise.all([api.listStrategies(), api.listTrades()])
      strategies.value = s
      trades.value = t
      loaded.value = true
    } catch (e) {
      error.value = e.message || 'Error al cargar Strategy Lab'
    } finally {
      loading.value = false
      inflight = null
    }
  })()
  return inflight
}

async function mutate(fn) {
  const result = await fn()
  await load()
  return result
}

const scopedTrades = computed(() =>
  applyFilters(trades.value, { recordType: filters.recordType, dateFrom: filters.dateFrom, dateTo: filters.dateTo })
)
const strategyById = computed(() => new Map(strategies.value.map((s) => [s.id, s])))
const activeStrategies = computed(() => strategies.value.filter((s) => s.status === 'ACTIVE'))
const symbols = computed(() => [...new Set(trades.value.map((t) => t.symbol))].sort())

export function useStrategyLab() {
  return {
    strategies, trades, loading, loaded, error, filters,
    scopedTrades, strategyById, activeStrategies, symbols,
    load,
    createStrategy: (d) => mutate(() => api.createStrategy(d)),
    updateStrategy: (id, d) => mutate(() => api.updateStrategy(id, d)),
    deleteStrategy: (id) => mutate(() => api.deleteStrategy(id)),
    createTrade: (d) => mutate(() => api.createTrade(d)),
    updateTrade: (id, d) => mutate(() => api.updateTrade(id, d)),
    deleteTrade: (id) => mutate(() => api.deleteTrade(id)),
    api,
  }
}
