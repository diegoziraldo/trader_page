// src/services/local/portfolioHistoryLocal.js
//
// Historial de valor de la cartera para armar los gráficos de rendimiento
// diario y mensual.
//
// Por qué vive en localStorage y no en la base de datos: ni Finnhub (plan
// gratuito) ni las fuentes de CEDEARs/acciones argentinas que usa esta app
// dan velas históricas, así que no hay forma de "reconstruir" el rendimiento
// pasado de la cartera. Lo que sí podemos hacer es ir grabando un snapshot
// del valor total cada día que abrís la cartera, y con eso armar un
// historial real (aunque arranque desde hoy) sin tocar el schema de D1.
// Es información puramente local a este navegador/dispositivo.

const PREFIX = 'pf-history:'
const MAX_POINTS = 400 // ~13 meses de snapshots diarios

// Fecha local (no UTC): con UTC-3 (Argentina), usar toISOString() corre el
// "día" hasta 3 horas antes de la medianoche real, lo que hacía que un
// snapshot cargado a la noche quedara fechado "mañana". Esto usa el
// calendario del navegador del usuario.
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

// Siembra UN punto de referencia real usando datos que ya existen en la
// base (la fecha de alta de la cartera/posiciones y el costo invertido a
// esa fecha), para no depender de "esperar varios días" antes de poder
// mostrar cualquier gráfico. No inventa precios de mercado históricos —
// usa el costo (cantidad × precio promedio) como mejor valor conocido para
// esa fecha.
//
// Solo actúa si el dato más antiguo que ya tenemos guardado es POSTERIOR a
// la fecha de alta real (por ejemplo: la cartera se dio de alta hace dos
// días, pero el tracking recién arrancó hoy). En ese caso inserta el punto
// de alta al principio, sin pisar ningún dato ya trackeado. Si ya hay un
// punto en la fecha de alta o anterior, no hace falta hacer nada.
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

// Serie de rendimiento DIARIO: % de variación entre cada día y el anterior,
// para los últimos `days` puntos disponibles.
export function getDailyReturns(portfolioId, days = 30) {
  const history = readHistory(portfolioId).slice(-(days + 1))
  const labels = []
  const values = []
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1].value
    const curr = history[i].value
    if (prev > 0) {
      const [, m, d] = history[i].date.split('-')
      labels.push(`${d}/${m}`)
      values.push(((curr - prev) / prev) * 100)
    }
  }
  return { labels, values, pointCount: history.length }
}

// Serie de rendimiento MENSUAL: toma el último snapshot de cada mes
// calendario y calcula la variación % contra el último snapshot del mes
// anterior.
export function getMonthlyReturns(portfolioId, months = 12) {
  const history = readHistory(portfolioId)
  const lastByMonth = new Map() // 'YYYY-MM' -> { date, value }
  for (const point of history) {
    const monthKey = point.date.slice(0, 7)
    lastByMonth.set(monthKey, point) // como viene ordenado asc, el último pisa
  }
  const monthKeys = [...lastByMonth.keys()].sort().slice(-(months + 1))
  const labels = []
  const values = []
  const MONTH_LABELS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
  for (let i = 1; i < monthKeys.length; i++) {
    const prev = lastByMonth.get(monthKeys[i - 1]).value
    const curr = lastByMonth.get(monthKeys[i]).value
    if (prev > 0) {
      const [, m] = monthKeys[i].split('-')
      labels.push(MONTH_LABELS[Number(m) - 1])
      values.push(((curr - prev) / prev) * 100)
    }
  }
  return { labels, values, pointCount: monthKeys.length }
}
