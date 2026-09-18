<script setup>
import { ref } from 'vue'
import { useEarnings } from '../composables/useEarnings'

const emit = defineEmits(['select-ticker'])
const { earnings, loading, error, dias } = useEarnings()
const collapsed = ref(false)

function onSelect(dia, e) {
  const ticker = e.target.value
  if (!ticker) return
  emit('select-ticker', ticker)
  e.target.value = ''
}
</script>

<template>
  <div class="earnings-card">
    <div class="earnings-header" @click="collapsed = !collapsed">
      <span>📊 Balances de la semana</span>
      <span>{{ collapsed ? '▲' : '▼' }}</span>
    </div>

    <div v-if="!collapsed" class="earnings-body">
      <div v-if="error" class="earnings-error">No se pudo cargar el calendario. Revisá tu API key de Finnhub.</div>
      <div v-else class="earnings-cols">
        <div v-for="(label, dia) in dias" :key="dia" class="earnings-col">
          <select class="earnings-select" :disabled="loading" @change="onSelect(dia, $event)">
            <option value="" selected>{{ label }}</option>
            <option v-for="item in (earnings[dia] || [])" :key="item.t" :value="item.t" :style="item.color ? `color:${item.color}` : ''">
              {{ item.t }} {{ item.time }}
            </option>
          </select>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.earnings-card{
  background:var(--panel-alt, #14171f);border:1px solid var(--border);border-radius:8px;
  padding:8px 10px;margin-bottom:10px;
}
.earnings-header{
  display:flex;justify-content:space-between;align-items:center;
  font-size:11px;font-weight:700;color:var(--up);cursor:pointer;text-transform:uppercase;
}
.earnings-body{ margin-top:8px; }
.earnings-cols{ display:flex;gap:6px; }
.earnings-col{ flex:1;min-width:0; }
.earnings-select{
  width:100%;background:var(--bg);border:1px solid var(--border);border-radius:6px;
  color:#fff;padding:5px 4px;font-size:10px;font-weight:600;outline:none;cursor:pointer;
  text-align:center;text-align-last:center;font-family:var(--font-ui);
}
.earnings-select option{ background:var(--panel-alt, #14171f);color:#fff;font-weight:600; }
.earnings-error{ font-size:10.5px;color:var(--down); }
</style>