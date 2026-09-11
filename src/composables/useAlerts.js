import { ref, onMounted, onUnmounted } from 'vue'
import { fetchQuote } from '../services/stockService'
import { getAlerts, createAlert, updateAlertRemote, deleteAlertRemote } from '../services/alertsService'
import { useAlarmSound } from './useAlarmSound'

const REFRESH_MS = 8000

function newId() {
  return 'alert_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)
}

export function useAlerts() {
  const alerts = ref([])
  const alarm = useAlarmSound()
  const triggeredMessage = ref('')

  const priceHistory = {}
  let timer = null
  let isFetching = false

  function blankAlert() {
    return {
      id: newId(), remoteId: null, ticker: '', type: 'IN', price: null,
      livePrice: null, diffPercent: null, triggered: false,
      updatedAt: Date.now(), loading: false, error: null,
    }
  }

  // Trae las alertas guardadas en el backend al arrancar
  async function loadFromBackend() {
    try {
      const remote = await getAlerts()
      alerts.value = remote.map(r => ({
        id: newId(),
        remoteId: r.id,
        ticker: r.ticker,
        type: r.type,
        price: r.price,
        livePrice: null,
        diffPercent: null,
        triggered: false,
        updatedAt: Date.now(),
        loading: false,
        error: null,
      }))
    } catch (e) {
      console.error('No se pudo cargar alertas del backend', e)
      alerts.value = []
    }
    if (alerts.value.length === 0) {
      alerts.value.push(blankAlert())
    }
  }

  // Crea o actualiza en el backend segun si la alerta ya tiene remoteId
  async function syncToBackend(alert) {
    if (!alert.ticker) return // no guardamos alertas vacias
    try {
      if (alert.remoteId) {
        await updateAlertRemote(alert.remoteId, {
          ticker: alert.ticker, type: alert.type, price: alert.price, triggered: alert.triggered,
        })
      } else {
        const created = await createAlert({
          ticker: alert.ticker, type: alert.type, price: alert.price,
        })
        alert.remoteId = created.id
      }
    } catch (e) {
      console.error('Error guardando alerta en el backend', e)
      alert.error = 'No se pudo guardar'
    }
  }

  function addAlert() {
    alerts.value.unshift(blankAlert())
    // No se persiste todavia: se crea en el backend recien cuando se
    // completa el ticker, en updateAlert().
  }

  async function removeAlert(id) {
    const alert = alerts.value.find(a => a.id === id)
    delete priceHistory[id]
    alerts.value = alerts.value.filter(a => a.id !== id)
    if (alert?.remoteId) {
      try {
        await deleteAlertRemote(alert.remoteId)
      } catch (e) {
        console.error('Error eliminando alerta en el backend', e)
      }
    }
  }

  function updateAlert(id, patch) {
    const alert = alerts.value.find(a => a.id === id)
    if (!alert) return
    Object.assign(alert, patch, { triggered: false, updatedAt: Date.now() })
    delete priceHistory[id]
    syncToBackend(alert)
    refreshOne(alert)
  }

  async function refreshOne(alert) {
    if (!alert.ticker) {
      alert.livePrice = null
      alert.diffPercent = null
      return
    }
    alert.loading = true
    alert.error = null
    try {
      const q = await fetchQuote(alert.ticker)
      alert.livePrice = q.price
      alert.error = null

      if (alert.price) {
        const roundLive = Math.round(q.price * 100) / 100
        const roundTarget = Math.round(alert.price * 100) / 100
        alert.diffPercent = ((roundTarget - roundLive) / roundLive) * 100

        const prevPrice = priceHistory[alert.id]
        let shouldTrigger = false
        if (prevPrice !== undefined) {
          const crossedUp = prevPrice < roundTarget && roundLive >= roundTarget
          const crossedDown = prevPrice > roundTarget && roundLive <= roundTarget
          const hitExact = roundLive === roundTarget
          shouldTrigger = crossedUp || crossedDown || hitExact
        }
        priceHistory[alert.id] = roundLive

        if (shouldTrigger && !alert.triggered) {
          alert.triggered = true
          const typeLabel = { IN: 'IN', TARGET: 'TARGET', STOP_LOSS: 'STOP LOSS' }[alert.type] || alert.type
          triggeredMessage.value = `🚨 ${alert.ticker} · ${typeLabel}: $${q.price}`
          alarm.start()
          syncToBackend(alert) // guarda triggered=true
        }
      } else {
        alert.diffPercent = null
      }
    } catch (e) {
      alert.error = e.message
      alert.livePrice = null
    } finally {
      alert.loading = false
    }
  }

  async function refreshAll() {
    if (isFetching) return
    isFetching = true
    await Promise.all(alerts.value.map(refreshOne))
    isFetching = false
  }

  function acknowledgeAlarm() {
    alarm.stop()
  }

  onMounted(async () => {
    await loadFromBackend()
    refreshAll()
    timer = setInterval(refreshAll, REFRESH_MS)
  })
  onUnmounted(() => {
    if (timer) clearInterval(timer)
  })

  return {
    alerts, addAlert, removeAlert, updateAlert,
    isRinging: alarm.isRinging, triggeredMessage, acknowledgeAlarm,
  }
}