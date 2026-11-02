<script setup>
// Shell del módulo STRATEGY LAB: pestañas + filtros globales. Se abre como una
// sección a pantalla completa desde QuickLinks (el proyecto no usa vue-router).
import { ref, onMounted } from 'vue'
import './strategyLab.css'
import { useStrategyLab } from '../../composables/useStrategyLab.js'
import FilterBar from './FilterBar.vue'
import DashboardView from './views/DashboardView.vue'
import StrategiesView from './views/StrategiesView.vue'
import TradeForm from './TradeForm.vue'
import HistoryView from './views/HistoryView.vue'
import StatsView from './views/StatsView.vue'
import CompareView from './views/CompareView.vue'
import DiscoveryView from './views/DiscoveryView.vue'

defineEmits(['close'])
const { loading, loaded, error, load } = useStrategyLab()
const TABS = [
  ['dashboard', 'Dashboard'], ['strategies', 'Estrategias'], ['register', 'Registrar'], ['history', 'Historial'],
  ['stats', 'Estadísticas'], ['compare', 'Comparador'], ['discovery', 'Descubrimiento'],
]
const WITH_FILTERS = ['dashboard', 'stats', 'compare', 'discovery']
const tab = ref('dashboard')
const formKey = ref(0)
function onTradeSaved(_t, andNew) { if (!andNew) { tab.value = 'history'; formKey.value++ } }
onMounted(load)
</script>

<template>
  <div class="sl-root">
    <header class="sl-header">
      <span class="sl-brand">STRATEGY LAB</span>
      <nav class="sl-tabs">
        <button v-for="[id, label] in TABS" :key="id" class="sl-tab" :class="{ active: tab === id }" @click="tab = id">{{ label }}</button>
      </nav>
      <div class="sl-header-actions">
        <button class="sl-btn sm" :disabled="loading" @click="load">{{ loading ? 'Actualizando…' : 'Actualizar' }}</button>
        <button class="sl-btn sm" @click="$emit('close')">Cerrar ✕</button>
      </div>
    </header>
    <FilterBar v-if="WITH_FILTERS.includes(tab)" />
    <main class="sl-main">
      <div v-if="!loaded && loading" class="sl-empty">Cargando Strategy Lab…</div>
      <div v-else-if="!loaded && error" class="sl-wrap"><div class="sl-error">{{ error }}</div><div><button class="sl-btn" @click="load">Reintentar</button></div></div>
      <template v-else>
        <div v-if="error" class="sl-wrap" style="margin-bottom: 12px"><div class="sl-error">{{ error }}</div></div>
        <DashboardView v-if="tab === 'dashboard'" @navigate="tab = $event" />
        <StrategiesView v-else-if="tab === 'strategies'" @navigate="tab = $event" />
        <TradeForm v-else-if="tab === 'register'" :key="formKey" @saved="onTradeSaved" />
        <HistoryView v-else-if="tab === 'history'" />
        <StatsView v-else-if="tab === 'stats'" />
        <CompareView v-else-if="tab === 'compare'" />
        <DiscoveryView v-else-if="tab === 'discovery'" />
      </template>
    </main>
  </div>
</template>
