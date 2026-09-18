<script setup>
import { ref, computed } from 'vue'
import { fetchNextEarningsDate } from '../services/earningsService'

const props = defineProps({ alert: { type: Object, required: true } })
const emit = defineEmits(['update', 'remove'])

const earningsLoading = ref(false)
const earningsText = ref('')
const showTooltip = ref(false)

const tickerLocal = ref(props.alert.ticker)
const priceLocal = ref(props.alert.price ?? '')

function commit() {
  emit('update', props.alert.id, {
    ticker: tickerLocal.value.trim().toUpperCase(),
    price: parseFloat(priceLocal.value) || null,
  })
}

function setType(type) {
  emit('update', props.alert.id, { ticker: tickerLocal.value.trim().toUpperCase(), price: parseFloat(priceLocal.value) || null, type })
}

async function consultarEarnings() {
  const symbol = tickerLocal.value.trim().toUpperCase()
  if (!symbol) {
    earningsText.value = 'Ingresá un ticker'
    showTooltip.value = true
    setTimeout(() => (showTooltip.value = false), 3000)
    return
  }
  earningsLoading.value = true
  try {
    const fecha = await fetchNextEarningsDate(symbol)
    earningsText.value = fecha
      ? fecha.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : 'Sin fecha disponible'
  } catch (e) {
    earningsText.value = 'Error consultando'
  } finally {
    earningsLoading.value = false
    showTooltip.value = true
    setTimeout(() => (showTooltip.value = false), 3500)
  }
}

const diffLabel = computed(() => {
  if (props.alert.diffPercent == null) return '--%'
  const v = props.alert.diffPercent
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}%`
})

const priceLabel = computed(() => {
  const a = props.alert
  if (a.loading) return '···'
  if (a.error) return 'N/D'
  if (a.livePrice == null) return '---'
  return a.livePrice.toLocaleString('es-AR', { style: 'currency', currency: 'USD', minimumFractionDigits: a.livePrice < 1 ? 4 : 2 })
})
</script>

<template>
  <div class="alert-row" :class="{ triggered: alert.triggered, 'type-in': alert.type === 'IN', 'type-target': alert.type === 'TARGET', 'type-sl': alert.type === 'STOP_LOSS' }">
    <input v-model="tickerLocal" class="ticker" placeholder="GGAL" maxlength="14" @change="commit" @keydown.enter="commit">

    <div class="earnings-wrap">
      <button class="btn-earnings" :class="{ loading: earningsLoading }" title="Próximo balance" @click="consultarEarnings">
        {{ earningsLoading ? '…' : 'E' }}
      </button>
      <div v-if="showTooltip" class="earnings-tooltip">{{ earningsText }}</div>
    </div>

    <select class="alert-type" :value="alert.type" @change="setType($event.target.value)">
      <option value="IN">IN</option>
      <option value="TARGET">TG</option>
      <option value="STOP_LOSS">SL</option>
    </select>

    <span class="live-price mono">{{ priceLabel }}</span>
    <span class="diff-percent mono" :class="{ near: alert.diffPercent != null && Math.abs(alert.diffPercent) <= 2 }">{{ diffLabel }}</span>

    <input v-model="priceLocal" type="number" step="any" class="target-price" placeholder="Obj." @change="commit" @keydown.enter="commit">

    <div class="status-dot" :class="{ active: alert.ticker && alert.price, triggered: alert.triggered }"></div>
    <button class="btn-delete" title="Eliminar" @click="emit('remove', alert.id)">✕</button>
  </div>
</template>

<style scoped>
.alert-row{
  display:flex;gap:5px;align-items:center;padding:6px;border-radius:8px;
  background:var(--panel-alt, #14171f);border:1px solid var(--border);
  transition:background-color .3s ease;
}
.live-price {
  display: inline-block;
  width: 110px;
  text-align: right;
  white-space: nowrap;
}

.price-value {
  display: inline-block;
  width: 100%;
}

.price-fade-enter-active,
.price-fade-leave-active {
  transition: opacity 0.2s ease;
}

.price-fade-enter-from {
  opacity: 0;
}

.price-fade-leave-to {
  opacity: 0;
}
.alert-row.triggered.type-in{ animation:blink-yellow .7s infinite alternate; }
.alert-row.triggered.type-target{ animation:blink-green .7s infinite alternate; }
.alert-row.triggered.type-sl{ animation:blink-sl .7s infinite alternate; }
@keyframes blink-yellow{ 0%{background:rgba(255,179,0,.15);} 100%{background:rgba(255,179,0,.55);} }
@keyframes blink-green{ 0%{background:rgba(0,217,163,.15);} 100%{background:rgba(0,217,163,.5);} }
@keyframes blink-sl{ 0%{background:rgba(255,77,94,.15);} 100%{background:rgba(255,77,94,.5);} }

.alert-row input, .alert-row select{
  background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);
  padding:4px 6px;font-size:11px;outline:none;height:26px;font-family:var(--font-ui);
}
.ticker{ width:64px;text-transform:uppercase;font-weight:700;flex-shrink:0; }
.target-price{ flex:1;min-width:0;font-weight:600; }

.alert-type{ width:54px;font-weight:800;text-align:center;text-align-last:center;cursor:pointer;flex-shrink:0; }
.type-in .alert-type{ color:#ffb300;border-color:rgba(255,179,0,.5); }
.type-target .alert-type{ color:var(--up);border-color:rgba(0,217,163,.5); }
.type-sl .alert-type{ color:var(--down);border-color:rgba(255,77,94,.5); }

.live-price{ font-size:11px;color:var(--text);white-space:nowrap; }
.diff-percent{ font-size:10.5px;color:var(--text-dim);width:42px;text-align:right;flex-shrink:0; }
.diff-percent.near{ color:var(--blue);font-weight:700; }

.earnings-wrap{ position:relative;flex-shrink:0; }
.btn-earnings{
  background:transparent;color:var(--blue);border:1px solid rgba(138,180,248,.4);
  cursor:pointer;font-size:10px;font-weight:800;width:22px;height:22px;border-radius:5px;
}
.btn-earnings.loading{ opacity:.6; }
.earnings-tooltip{
  position:absolute;bottom:26px;left:50%;transform:translateX(-50%);
  background:#000;color:#fff;font-size:10px;padding:4px 8px;border-radius:5px;
  white-space:nowrap;box-shadow:0 4px 10px rgba(0,0,0,.4);z-index:10;
}

.status-dot{ width:8px;height:8px;border-radius:50%;background:var(--border);flex-shrink:0; }
.status-dot.active{ background:var(--text-dim); }
.status-dot.triggered{ background:var(--up);box-shadow:0 0 6px var(--up); }

.btn-delete{
  background:transparent;border:none;color:var(--down);cursor:pointer;font-size:11px;
  opacity:.6;flex-shrink:0;
}
.btn-delete:hover{ opacity:1; }
</style>