<script setup>
// Envoltorio mínimo de Chart.js. Reconstruye el gráfico cuando cambian los
// datos (animaciones desactivadas: son series chicas y se prioriza la lectura).
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import Chart from 'chart.js/auto'
import { baseOptions, deepMerge } from './chartTheme.js'

const props = defineProps({
  type: { type: String, default: 'bar' },
  data: { type: Object, required: true },
  options: { type: Object, default: () => ({}) },
  height: { type: Number, default: 260 },
})
const canvas = ref(null)
let chart = null

function build() {
  if (chart) { chart.destroy(); chart = null }
  const el = canvas.value
  const ctx = el && el.getContext ? el.getContext('2d') : null
  if (!ctx) return
  chart = new Chart(ctx, {
    type: props.type,
    data: JSON.parse(JSON.stringify(props.data)),
    options: deepMerge(baseOptions(props.type), props.options),
  })
}
onMounted(build)
watch(() => [props.data, props.options, props.type], build, { deep: true })
onBeforeUnmount(() => chart && chart.destroy())
</script>

<template>
  <div class="sl-chart-box" :style="{ height: height + 'px' }"><canvas ref="canvas"></canvas></div>
</template>
