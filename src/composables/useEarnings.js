import { ref, onMounted, onUnmounted } from 'vue'
import { fetchWeeklyEarningsUS, DIA_LABELS } from '../services/earningsService'

const REFRESH_MS = 6 * 60 * 60 * 1000 // 6hs — solo importa detectar el cambio de semana

export function useEarnings() {
  const earnings = ref({}) // { lunes: [...], martes: [...], ... }
  const loading = ref(true)
  const error = ref(null)
  let timer = null

  async function refresh() {
    try {
      earnings.value = await fetchWeeklyEarningsUS()
      error.value = null
    } catch (e) {
      error.value = e.message
    } finally {
      loading.value = false
    }
  }

  onMounted(() => {
    refresh()
    timer = setInterval(refresh, REFRESH_MS)
  })
  onUnmounted(() => {
    if (timer) clearInterval(timer)
  })

  return { earnings, loading, error, dias: DIA_LABELS, refresh }
}