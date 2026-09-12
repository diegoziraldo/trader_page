<script setup>
import { ref } from 'vue'
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

// --- Datos macro (dólar / riesgo país), en vivo, sin API key ---
const { dolares, riesgoPais, loading: dolarLoading } = useDolar()

// --- Panel izquierdo: acciones USA (Finnhub) ---
// La lista de símbolos vive en el backend (tabla watchlist_us, con una
// semilla por defecto); acá solo se pide el precio en vivo.
const { stocks: usStocks, addTicker: addUsTicker, removeTicker: removeUsTicker } = useUsStocks()

// --- Bitácora de trades (modal) ---
const showTrades = ref(false)
</script>

<template>

  <Login />
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
  max-width:85%;
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

@media(max-width: 1200px){
  .main-layout{grid-template-columns:1fr; max-width:640px;}
  .center-column{flex-direction:column;} /* En pantallas chicas se apilan verticalmente por comodidad */
}
</style>