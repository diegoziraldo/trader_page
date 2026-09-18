<script setup>
import { ref, onMounted } from 'vue'
import SearchBar from './components/SearchBar.vue'
import FinanceTicker from './components/FinanceTicker.vue'
import StockPanel from './components/StockPanel.vue'
import AlertsPanel from './components/AlertsPanel.vue'
import Checklist from './components/Checklist.vue'
import QuickLinks from './components/QuickLinks.vue'
import CclCalculator from './components/CclCalculator.vue'
import TradesModal from './components/TradesModal.vue'
import { useDolar } from './composables/useDolar'
import { useUsStocks } from './composables/useStocks'
import { isBackendAvailable, resetBackendCheck } from './services/apiAvailability.js'

// --- Datos macro (dólar / riesgo país), en vivo, sin API key ---
const { dolares, riesgoPais, loading: dolarLoading } = useDolar()

// --- Panel izquierdo: acciones USA (Finnhub) ---
// La lista de símbolos vive en el backend (tabla watchlist_us, con una
// semilla por defecto); acá solo se pide el precio en vivo.
const { stocks: usStocks, addTicker: addUsTicker, removeTicker: removeUsTicker } = useUsStocks()

// --- Bitácora de trades (modal) ---
const showTrades = ref(false)

// --- Modo de almacenamiento: backend real vs. localStorage del navegador ---
// null mientras se detecta, true/false una vez resuelto. Ver
// src/services/apiAvailability.js: todos los servicios (trades, alerts,
// checklist, watchlist) usan la misma detección para decidir dónde guardar.
const backendReady = ref(null)
const checkingBackend = ref(false)

async function checkStorageMode() {
  checkingBackend.value = true
  backendReady.value = await isBackendAvailable()
  checkingBackend.value = false
}

async function retryBackend() {
  resetBackendCheck()
  await checkStorageMode()
}

onMounted(checkStorageMode)
</script>

<template>

  <!-- Barra superior: buscador + resumen macro, compacta -->
  <div class="topbar">
    <SearchBar compact />
    <FinanceTicker :dolares="dolares" :riesgo-pais="riesgoPais" :loading="dolarLoading" compact />
  </div>
  <div>
    <QuickLinks @open-trades="showTrades = true" />

  </div>
  <!-- Layout principal: las alarmas van al centro, es lo primero que se ve -->
  <div class="main-layout">
    <StockPanel
      title="Acciones USA (NYSE / NASDAQ)"
      :stocks="usStocks"
      placeholder="Ej: AAPL, TSLA"
      @add="addUsTicker"
      @remove="removeUsTicker"
    />

    <!-- Columna central con dos paneles de alertas uno al lado del otro -->
    <div class="center-column">
      <Checklist />
      <AlertsPanel />
    </div>

    <CclCalculator />
  </div>

  <TradesModal v-if="showTrades" @close="showTrades = false" />

  <!-- Indicador de dónde se están guardando los datos ahora mismo. No
       bloquea nada: es solo para que quede claro si estás en modo local
       (los datos quedan en este navegador) o conectado a un backend real. -->
  <button
    v-if="backendReady !== null"
    type="button"
    class="storage-mode-badge"
    :class="backendReady ? 'mode-backend' : 'mode-local'"
    :disabled="checkingBackend"
    :title="
      backendReady
        ? 'Conectado a un backend real: los datos se guardan en la base de datos del servidor.'
        : 'No se detectó ningún backend en /api. Los datos se están guardando en este navegador (localStorage): no se sincronizan entre dispositivos y se pierden si borrás datos de navegación. Click para reintentar la conexión.'
    "
    @click="!backendReady && retryBackend()"
  >
    {{ backendReady ? '☁️ Backend conectado' : '💾 Modo local (este navegador)' }}
  </button>

</template>

<style scoped>
.topbar{
  max-width:1480px;
  margin:0 auto;
  padding:20px 16px 0;
  display:flex;
  flex-direction:column;
  align-items:center;
  gap:10px;
}
.topbar :deep(.search-shell){ max-width:520px; }

.main-layout{
  display:grid;
  grid-template-columns: 260px minmax(500px, 1fr) 260px;
  gap:20px;
  width:100%;
  max-width:84%;
  margin:0 auto;
  align-items:start;
  padding:10px 16px 10px;
}

/* Contenedor central adaptado para poner los dos paneles uno al lado del otro */
.center-column{
  display: flex;
  flex-direction: row;
  gap: 16px;
  width: 100%;
}

/* Hacemos que cada panel se reparta el espacio equitativamente */
.center-column > * {
  flex: 1;
  min-width: 0;
}

.storage-mode-badge {
  position: fixed;
  right: 14px;
  bottom: 14px;
  z-index: 500;
  border-radius: 999px;
  padding: 7px 14px;
  font-size: 12px;
  font-weight: 600;
  font-family: inherit;
  border: 1px solid transparent;
  cursor: default;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.15);
}

.storage-mode-badge.mode-backend {
  background: rgba(34, 197, 94, 0.12);
  border-color: rgba(34, 197, 94, 0.4);
  color: #16a34a;
  cursor: default;
}

.storage-mode-badge.mode-local {
  background: rgba(234, 179, 8, 0.14);
  border-color: rgba(234, 179, 8, 0.45);
  color: #b45309;
  cursor: pointer;
}

.storage-mode-badge.mode-local:hover {
  background: rgba(234, 179, 8, 0.22);
}

.storage-mode-badge:disabled {
  opacity: 0.7;
  cursor: wait;
}

@media(max-width: 1200px){
  .main-layout{grid-template-columns:1fr; max-width:640px;}
  .center-column{flex-direction:column;} /* En pantallas chicas se apilan verticalmente por comodidad */
}

@media(max-width: 480px){
  .topbar{
    padding:14px 10px 0;
  }
  .main-layout{
    gap:14px;
    padding:8px 10px 10px;
  }
  .center-column{
    gap:12px;
  }
  /* En el celular el badge fijo queda más chico y respeta el área segura
     (notch / gesture bar) para no quedar tapado ni tapar contenido. */
  .storage-mode-badge{
    right:10px;
    bottom:calc(10px + env(safe-area-inset-bottom, 0px));
    padding:6px 10px;
    font-size:11px;
    max-width:calc(100vw - 20px);
    white-space:nowrap;
    overflow:hidden;
    text-overflow:ellipsis;
  }
}
</style>