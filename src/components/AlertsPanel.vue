<script setup>
import { computed } from 'vue'
import AlertRow from './AlertRow.vue'
import EarningsCalendar from './EarningsCalendar.vue'
import { useAlerts } from '../composables/useAlerts'
import { useDolar } from '../composables/useDolar'

const { alerts, addAlert, removeAlert, updateAlert, isRinging, triggeredMessage, acknowledgeAlarm } = useAlerts()
const { dolares } = useDolar()

// dolarapi.com no siempre trae "variacion" (día vs. día anterior); cuando falta,
// mostramos el spread compra/venta como referencia — igual que hacía el script original.
function pctFor(casa) {
  const d = dolares.value?.[casa]
  if (!d) return null
  if (d.variacion !== undefined && d.variacion !== null) return d.variacion
  if (d.compra > 0 && d.venta > 0) return ((d.venta - d.compra) / d.compra) * 100
  return null
}
const mepPct = computed(() => pctFor('bolsa'))
const cclPct = computed(() => pctFor('contadoconliqui'))

function onSelectTicker(ticker) {
  addAlert()
  const first = alerts.value[0]
  updateAlert(first.id, { ticker, type: 'IN', price: null })
}
</script>

<template>
  <div class="card alerts-panel">
    <div class="alerts-header">
      <span class="title" :class="{ ringing: isRinging }">{{ isRinging ? triggeredMessage : '⚡ Alarmas de Precio' }}</span>
      <div class="header-right">
        <div class="dollar-chip">
          <span class="lbl">MEP</span>
          <span class="val mono">{{ dolares?.bolsa?.venta ? '$' + dolares.bolsa.venta.toFixed(1) : '$--' }}</span>
          <span v-if="mepPct != null" class="pct mono" :class="mepPct >= 0 ? 'up' : 'down'">{{ mepPct >= 0 ? '+' : '' }}{{ mepPct.toFixed(1) }}%</span>
        </div>
        <div class="dollar-chip">
          <span class="lbl">CCL</span>
          <span class="val mono">{{ dolares?.contadoconliqui?.venta ? '$' + dolares.contadoconliqui.venta.toFixed(1) : '$--' }}</span>
          <span v-if="cclPct != null" class="pct mono" :class="cclPct >= 0 ? 'up' : 'down'">{{ cclPct >= 0 ? '+' : '' }}{{ cclPct.toFixed(1) }}%</span>
        </div>
        <button v-if="isRinging" class="btn-stop" title="Apagar sonido" @click="acknowledgeAlarm">🔕</button>
      </div>
    </div>

    <EarningsCalendar @select-ticker="onSelectTicker" />

    <div class="alerts-list">
      <AlertRow
        v-for="alert in alerts"
        :key="alert.id"
        :alert="alert"
        @update="updateAlert"
        @remove="removeAlert"
      />
    </div>

    <button class="btn-add" @click="addAlert">+ Agregar Alarma</button>
  </div>
  
</template>

<style scoped>
.alerts-panel{ display:flex;flex-direction:column;gap:0; }
.alerts-header{
  display:flex;justify-content:space-between;align-items:center;gap:10px;
  margin-bottom:12px;flex-wrap:wrap;
}
.title{ font-size:12px;font-weight:700;color:var(--blue, #5c8dff);white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
.title.ringing{ color:#ff5252;animation:pulse-text .6s infinite alternate; }
@keyframes pulse-text{ from{opacity:.6;} to{opacity:1;} }

.header-right{ display:flex;align-items:center;gap:10px;flex-wrap:wrap; }
.dollar-chip{ display:flex;align-items:center;gap:3px;font-size:11px;font-weight:700; }
.dollar-chip .lbl{ color:var(--blue, #5c8dff); }
.dollar-chip .val{ color:var(--text); }
.dollar-chip .pct{ font-size:10px; }
.up{ color:var(--up); }
.down{ color:var(--down); }

.btn-stop{
  background:#ff1744;color:#fff;border:none;width:22px;height:22px;border-radius:6px;
  cursor:pointer;font-size:12px;animation:pulse-btn .8s infinite alternate;
}
@keyframes pulse-btn{ from{transform:scale(.95);} to{transform:scale(1.05);} }

.alerts-list{ display:flex;flex-direction:column;gap:6px;max-height:340px;overflow-y:auto;margin-bottom:10px; }

.btn-add{
  width:100%;background:linear-gradient(135deg, rgba(0,217,163,.85), rgba(0,150,110,.85));
  color:#fff;border:none;padding:8px;border-radius:8px;font-size:11px;font-weight:700;
  text-transform:uppercase;cursor:pointer;
}
</style>