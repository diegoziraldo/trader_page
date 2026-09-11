import { ref, onMounted, onUnmounted } from 'vue'

// --- Endpoints públicos, sin API key ---
const DOLAR_API = 'https://dolarapi.com/v1/dolares'
const RIESGO_PAIS_API = 'https://api.argentinadatos.com/v1/finanzas/indices/riesgo-pais/ultimo'

// Cada cuánto se refrescan estos datos macro (no cambian tan seguido, no hace
// falta pegarle cada pocos segundos)
const REFRESH_MS = 60_000 // 1 minuto

export function useDolar() {
  // dolares queda con forma { oficial: {...}, blue: {...}, contadoconliqui: {...}, ... }
  // indexado por "casa", que es justo lo que ya esperaba tu App.vue
  // (dolares.value?.contadoconliqui?.venta)
  const dolares = ref(null)
  const riesgoPais = ref(null)
  const loading = ref(true)
  const error = ref(null)

  let intervalId = null

  async function fetchDolares() {
    const res = await fetch(DOLAR_API)
    if (!res.ok) throw new Error(`dolarapi respondió ${res.status}`)
    const lista = await res.json()

    const porCasa = {}
    for (const item of lista) {
      // item: { moneda, casa, nombre, compra, venta, fechaActualizacion }
      porCasa[item.casa] = {
        nombre: item.nombre,
        compra: item.compra,
        venta: item.venta,
        fechaActualizacion: item.fechaActualizacion,
      }
    }
    dolares.value = porCasa
  }

  async function fetchRiesgoPais() {
    const res = await fetch(RIESGO_PAIS_API)
    if (!res.ok) throw new Error(`riesgo país respondió ${res.status}`)
    const data = await res.json()
    // data: { fecha, valor }
    riesgoPais.value = { valor: data.valor, fecha: data.fecha }
  }

  async function refresh() {
    try {
      // Se piden en paralelo, son dos APIs distintas e independientes
      await Promise.allSettled([fetchDolares(), fetchRiesgoPais()]).then((results) => {
        const fallo = results.find((r) => r.status === 'rejected')
        if (fallo) throw fallo.reason
      })
      error.value = null
    } catch (e) {
      error.value = e.message || 'Error al obtener datos macro'
      console.error('[useDolar] error al refrescar:', e)
    } finally {
      loading.value = false
    }
  }

  onMounted(() => {
    refresh()
    intervalId = setInterval(refresh, REFRESH_MS)
  })

  onUnmounted(() => {
    if (intervalId) clearInterval(intervalId)
  })

  return { dolares, riesgoPais, loading, error, refresh }
}