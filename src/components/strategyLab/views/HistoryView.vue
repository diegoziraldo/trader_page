<script setup>
import { reactive, ref, computed, watch } from 'vue'
import { useStrategyLab } from '../../../composables/useStrategyLab.js'
import { applyFilters, computeMetrics } from '../../../services/strategyLab/stats.js'
import { fmtValue, fmtNum, fmtPct, tone, OUTCOME_LABELS, RECORD_LABELS } from '../../../services/strategyLab/format.js'
import TradeDetail from '../TradeDetail.vue'
import TradeForm from '../TradeForm.vue'
import ConfirmDialog from '../ConfirmDialog.vue'

const { trades, strategies, deleteTrade } = useStrategyLab()
const f = reactive({ query: '', strategyId: '', dateFrom: '', dateTo: '', timeframe: '', outcome: '', recordType: '', direction: '' })
const sortKey = ref('entryTimestamp')
const sortDir = ref(-1)
const page = ref(0)
const PAGE_SIZE = 50
const detail = ref(null)   // trade abierto
const editing = ref(null)
const toDelete = ref(null)
const busy = ref(false)
const error = ref('')

const timeframes = computed(() => [...new Set(trades.value.map((t) => t.timeframe))].sort())
const filtered = computed(() => applyFilters(trades.value, { ...f, recordType: f.recordType || 'ALL', strategyIds: f.strategyId ? [Number(f.strategyId)] : [] }))
const getters = {
  entryTimestamp: (t) => t.entryTimestamp ?? 0, symbol: (t) => t.symbol, strategyName: (t) => t.strategyName.toLowerCase(), versionNumber: (t) => t.versionNumber,
  timeframe: (t) => t.timeframe, direction: (t) => t.direction, entryPrice: (t) => t.entryPrice, exitPrice: (t) => t.exitPrice ?? -Infinity,
  resultPct: (t) => t.resultPct ?? -Infinity, resultR: (t) => t.resultR ?? -Infinity, compliance: (t) => t.compliance.pct ?? -1, recordType: (t) => t.recordType,
}
const sorted = computed(() => [...filtered.value].sort((a, b) => { const x = getters[sortKey.value](a), y = getters[sortKey.value](b); return (x === y ? b.id - a.id : x > y ? 1 : -1) * sortDir.value }))
const pages = computed(() => Math.max(1, Math.ceil(sorted.value.length / PAGE_SIZE)))
const rows = computed(() => sorted.value.slice(page.value * PAGE_SIZE, (page.value + 1) * PAGE_SIZE))
const summary = computed(() => computeMetrics(filtered.value, 'R'))
watch([filtered, sortKey, sortDir], () => { if (page.value >= pages.value) page.value = 0 })

function setSort(k) { if (sortKey.value === k) sortDir.value *= -1; else { sortKey.value = k; sortDir.value = k === 'symbol' || k === 'strategyName' ? 1 : -1 } }
const COLS = [['entryTimestamp', 'Fecha'], ['symbol', 'Activo'], ['strategyName', 'Estrategia'], ['versionNumber', 'Ver.'], ['timeframe', 'TF'], ['direction', 'Dir.'], ['entryPrice', 'Entrada'], ['exitPrice', 'Salida'], ['resultPct', 'Resultado'], ['resultR', 'R'], ['compliance', 'Reglas'], ['recordType', 'Tipo']]
const numCols = ['entryPrice', 'exitPrice', 'resultPct', 'resultR', 'compliance', 'versionNumber']

function clearFilters() { Object.assign(f, { query: '', strategyId: '', dateFrom: '', dateTo: '', timeframe: '', outcome: '', recordType: '', direction: '' }) }
async function confirmDelete() {
  busy.value = true; error.value = ''
  try { await deleteTrade(toDelete.value.id); if (detail.value?.id === toDelete.value.id) detail.value = null; toDelete.value = null } catch (e) { error.value = e.message; toDelete.value = null } finally { busy.value = false }
}
function onSaved(saved) { editing.value = null; detail.value = trades.value.find((t) => t.id === saved.id) || null }
// el detalle abierto se refresca solo cuando cambia la lista
watch(trades, () => { if (detail.value) detail.value = trades.value.find((t) => t.id === detail.value.id) || null })
</script>

<template>
  <div class="sl-wrap">
    <div v-if="error" class="sl-error">{{ error }}</div>
    <div class="sl-panel">
      <div class="sl-panel-head"><span class="sl-panel-title">Filtros</span><button class="sl-btn sm ghost" @click="clearFilters">Limpiar</button></div>
      <div class="sl-panel-body sl-cols">
        <div class="sl-field"><span class="sl-label">Buscar ticker / nombre</span><input v-model="f.query" class="sl-input" placeholder="NVDA" /></div>
        <div class="sl-field"><span class="sl-label">Estrategia</span><select v-model="f.strategyId" class="sl-select"><option value="">Todas</option><option v-for="s in strategies" :key="s.id" :value="s.id">{{ s.name }}</option></select></div>
        <div class="sl-field"><span class="sl-label">Entrada desde</span><input v-model="f.dateFrom" type="date" class="sl-input" /></div>
        <div class="sl-field"><span class="sl-label">Entrada hasta</span><input v-model="f.dateTo" type="date" class="sl-input" /></div>
        <div class="sl-field"><span class="sl-label">Temporalidad</span><select v-model="f.timeframe" class="sl-select"><option value="">Todas</option><option v-for="t in timeframes" :key="t" :value="t">{{ t }}</option></select></div>
        <div class="sl-field"><span class="sl-label">Resultado</span><select v-model="f.outcome" class="sl-select"><option value="">Todos</option><option value="WIN">Ganadoras</option><option value="LOSS">Perdedoras</option><option value="BE">Breakeven</option><option value="PENDING">Pendientes</option></select></div>
        <div class="sl-field"><span class="sl-label">Tipo de operación</span><select v-model="f.recordType" class="sl-select"><option value="">Backtesting y real</option><option value="BACKTEST">Backtesting</option><option value="REAL">Trading real</option></select></div>
        <div class="sl-field"><span class="sl-label">Dirección</span><select v-model="f.direction" class="sl-select"><option value="">Ambas</option><option value="LONG">LONG</option><option value="SHORT">SHORT</option></select></div>
      </div>
    </div>

    <div class="sl-panel">
      <div class="sl-panel-head">
        <span class="sl-panel-title">Operaciones ({{ filtered.length }})</span>
        <span class="dim">{{ summary.n }} cerradas · {{ summary.pending }} pendientes · neto {{ fmtValue(summary.net, 'R') }} · win rate {{ fmtPct(summary.winRate, 0) }}</span>
      </div>
      <div v-if="!trades.length" class="sl-empty">Todavía no hay operaciones registradas.</div>
      <div v-else-if="!filtered.length" class="sl-empty">Ninguna operación coincide con los filtros.</div>
      <div v-else class="sl-scroll">
        <table class="sl-table">
          <thead><tr><th v-for="[k, l] in COLS" :key="k" class="sortable" :class="{ num: numCols.includes(k) }" @click="setSort(k)">{{ l }}<span v-if="sortKey === k">{{ sortDir > 0 ? ' ▲' : ' ▼' }}</span></th></tr></thead>
          <tbody>
            <tr v-for="t in rows" :key="t.id" class="clickable" @click="detail = t">
              <td class="dim">{{ t.entryDate }}<span v-if="t.entryTime"> {{ t.entryTime }}</span></td>
              <td><b>{{ t.symbol }}</b></td><td>{{ t.strategyName }}</td><td class="num dim">v{{ t.versionNumber }}</td><td>{{ t.timeframe }}</td>
              <td :class="t.direction === 'LONG' ? 'pos' : 'neg'">{{ t.direction }}</td>
              <td class="num">{{ fmtNum(t.entryPrice, 2) }}</td><td class="num">{{ t.exitPrice === null ? '—' : fmtNum(t.exitPrice, 2) }}</td>
              <td class="num" :class="tone(t.resultPct)">
                <template v-if="t.status === 'PENDING'"><span class="sl-badge warn">Pendiente</span></template>
                <template v-else>{{ fmtValue(t.resultPct, 'PCT') }}</template>
              </td>
              <td class="num" :class="tone(t.resultR)" :title="t.outcome ? OUTCOME_LABELS[t.outcome] : ''">{{ t.resultR === null ? '—' : fmtValue(t.resultR, 'R') }}</td>
              <td class="num">{{ t.compliance.pct === null ? '—' : t.compliance.pct.toFixed(0) + '%' }}</td>
              <td><span class="sl-badge" :class="t.recordType === 'REAL' ? 'real' : 'bt'">{{ RECORD_LABELS[t.recordType] }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="pages > 1" style="display: flex; justify-content: center; align-items: center; gap: 12px; padding: 10px">
        <button class="sl-btn sm" :disabled="page === 0" @click="page--">‹ Anterior</button><span class="dim">Página {{ page + 1 }} de {{ pages }}</span><button class="sl-btn sm" :disabled="page >= pages - 1" @click="page++">Siguiente ›</button>
      </div>
    </div>

    <TradeDetail v-if="detail && !editing" :trade="detail" @close="detail = null" @edit="editing = detail" @delete="toDelete = detail" />
    <div v-if="editing" class="sl-modal-bg" @click.self="editing = null">
      <div class="sl-modal" style="max-width: 1100px; background: var(--bg)">
        <div class="sl-panel-head"><span class="sl-panel-title">Editar operación · {{ editing.symbol }}</span><button class="sl-btn sm ghost" @click="editing = null">✕</button></div>
        <div style="padding: 14px"><TradeForm :trade="editing" @saved="onSaved" @cancel="editing = null" /></div>
      </div>
    </div>
    <ConfirmDialog v-if="toDelete" title="Eliminar operación" :message="`¿Eliminar la operación ${toDelete.symbol} del ${toDelete.entryDate}? Se borran también el estado de sus reglas y sus links. No se puede deshacer.`" confirm-text="Eliminar" :busy="busy" @confirm="confirmDelete" @cancel="toDelete = null" />
  </div>
</template>
