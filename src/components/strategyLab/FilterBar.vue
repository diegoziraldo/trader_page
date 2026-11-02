<script setup>
import { useStrategyLab } from '../../composables/useStrategyLab.js'
const { filters } = useStrategyLab()
function clear() { filters.recordType = 'ALL'; filters.dateFrom = ''; filters.dateTo = '' }
</script>

<template>
  <div class="sl-filterbar">
    <div class="sl-field">
      <span class="sl-label">Tipo de registro</span>
      <div class="sl-seg">
        <button :class="{ active: filters.recordType === 'ALL' }" @click="filters.recordType = 'ALL'">Todos</button>
        <button :class="{ active: filters.recordType === 'BACKTEST' }" @click="filters.recordType = 'BACKTEST'">Backtesting</button>
        <button :class="{ active: filters.recordType === 'REAL' }" @click="filters.recordType = 'REAL'">Trading real</button>
      </div>
    </div>
    <div class="sl-field">
      <span class="sl-label">Base de cálculo</span>
      <div class="sl-seg">
        <button :class="{ active: filters.basis === 'R' }" title="Múltiplos de riesgo: comparable entre activos y monedas" @click="filters.basis = 'R'">R</button>
        <button :class="{ active: filters.basis === 'PCT' }" title="% sobre capital de cada operación" @click="filters.basis = 'PCT'">%</button>
        <button :class="{ active: filters.basis === 'AMOUNT' }" title="Monto en moneda del activo (no mezcla ARS y USD con criterio)" @click="filters.basis = 'AMOUNT'">$</button>
      </div>
    </div>
    <div class="sl-field"><span class="sl-label">Entrada desde</span><input v-model="filters.dateFrom" type="date" class="sl-input" /></div>
    <div class="sl-field"><span class="sl-label">Entrada hasta</span><input v-model="filters.dateTo" type="date" class="sl-input" /></div>
    <button class="sl-btn ghost sm" @click="clear">Limpiar</button>
    <span v-if="filters.recordType === 'ALL'" class="sl-badge warn" title="Las métricas combinan backtesting y trading real. Filtrá por tipo para analizarlos por separado.">Mezcla backtesting + real</span>
    <span v-if="filters.basis === 'AMOUNT'" class="sl-badge warn" title="Si operás activos en ARS y USD, los montos se suman sin convertir moneda. Para comparar entre activos usá R.">$ sin conversión de moneda</span>
  </div>
</template>
