// src/services/local/portfolioHistoryLocal.js
//
// Historial de VALOR de la cartera (en ARS), para graficar la curva completa
// desde el alta hasta hoy.
//
// Por qué vive en localStorage y no en la base de datos: ni Finnhub (plan
// gratuito) ni las fuentes de CEDEARs/acciones argentinas que usa esta app
// dan velas históricas, así que no hay forma de "traer" el precio pasado de
// estos instrumentos. Lo que sí podemos hacer es: (1) grabar el valor total
// de la cartera cada vez que la abrís, y (2) sembrar el primer punto con el
// costo invertido a la fecha de alta real (dato que ya existe en la base:
// created_at de la cartera/posiciones), para no depender de "esperar varios
// días" antes de tener una curva. Es información puramente local a este
// navegador/dispositivo — no toca el schema de D1 ni el backend.

const PREFIX = 'pf-history:'
const MAX_POINTS = 400 // ~13 meses de snapshots diarios

// Fecha local (no UTC): con UTC-3 (Argentina), toISOString() corre el "día"
// hasta 3 horas antes de la medianoche real. Esto usa el calendario del
// navegador del usuario.
function todayISO() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function readHistory(portfolioId) {
  try {
    const raw = localStorage.getItem(PREFIX + portfolioId)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeHistory(portfolioId, history) {
  try {
    localStorage.setItem(PREFIX + portfolioId, JSON.stringify(history))
  } catch {
    // localStorage lleno o no disponible: no rompemos la app por esto.
  }
}

// Guarda (o actualiza) el snapshot de HOY con el valor total de la cartera.
// Si ya se guardó un valor hoy, lo reemplaza (así el gráfico refleja el
// último precio del día, no el primero).
export function recordSnapshot(portfolioId, valueARS) {
  if (!portfolioId || !(valueARS > 0)) return
  const history = readHistory(portfolioId)
  const today = todayISO()
  const idx = history.findIndex((h) => h.date === today)
  if (idx !== -1) {
    history[idx] = { date: today, value: valueARS }
  } else {
    history.push({ date: today, value: valueARS })
  }
  history.sort((a, b) => a.date.localeCompare(b.date))
  const trimmed = history.slice(-MAX_POINTS)
  writeHistory(portfolioId, trimmed)
  return trimmed
}

export function getHistory(portfolioId) {
  return readHistory(portfolioId)
}

// Siembra el punto de ALTA usando datos que ya existen en la base (fecha de
// creación de la cartera/posiciones + costo invertido a hoy, como mejor
// proxy disponible del costo a esa fecha). No inventa precios de mercado
// históricos. Solo inserta el punto si no hay ya un dato tan antiguo o más
// antiguo que la fecha de alta (para no pisar historial real ya trackeado).
export function seedFromInception(portfolioId, inceptionDateISO, investedValueARS) {
  if (!portfolioId || !inceptionDateISO || !(investedValueARS > 0)) return readHistory(portfolioId)
  const history = readHistory(portfolioId)
  const earliest = history[0]?.date
  if (earliest && earliest <= inceptionDateISO) return history
  const withSeed = [
    { date: inceptionDateISO, value: investedValueARS },
    ...history.filter((h) => h.date !== inceptionDateISO),
  ].sort((a, b) => a.date.localeCompare(b.date))
  writeHistory(portfolioId, withSeed)
  return withSeed
}

// Serie DIARIA completa: el valor de la cartera (ARS) en cada día
// registrado, desde el alta hasta hoy (o los últimos `days` si hay más
// historial que eso). Esto es la curva "de punta a punta" para graficar.
export function getDailySeries(portfolioId, days = 90) {
  const history = readHistory(portfolioId).slice(-days)
  const labels = history.map((h) => {
    const [, m, d] = h.date.split('-')
    return `${d}/${m}`
  })
  const values = history.map((h) => h.value)
  return { labels, values, dates: history.map((h) => h.date) }
}

// Serie MENSUAL: el último valor registrado de cada mes calendario, desde
// el alta hasta hoy.
export function getMonthlySeries(portfolioId, months = 24) {
  const history = readHistory(portfolioId)
  const lastByMonth = new Map() // 'YYYY-MM' -> punto
  for (const point of history) {
    lastByMonth.set(point.date.slice(0, 7), point) // ordenado asc: el último pisa
  }
  const monthKeys = [...lastByMonth.keys()].sort().slice(-months)
  const MONTH_LABELS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
  const labels = monthKeys.map((k) => {
    const [y, m] = k.split('-')
    return `${MONTH_LABELS[Number(m) - 1]} ${y.slice(2)}`
  })
  const values = monthKeys.map((k) => lastByMonth.get(k).value)
  return { labels, values, dates: monthKeys }
}
