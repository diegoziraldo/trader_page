// Calendario de balances (earnings) de EE.UU. vía Finnhub, filtrado a
// compañías que tienen CEDEAR en BYMA. Misma API key que stockService.js
// (VITE_FINNHUB_API_KEY en tu .env).

import { CEDEAR_TICKERS } from '../data/cedearTickers'
import { importanciaDe } from '../data/sp500Weight'

const FINNHUB_BASE = 'https://finnhub.io/api/v1'
const API_KEY = import.meta.env.VITE_FINNHUB_API_KEY

function assertApiKey() {
  if (!API_KEY) {
    throw new Error('Falta VITE_FINNHUB_API_KEY. Ver .env.example.')
  }
}

const DIAS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes']
export const DIA_LABELS = {
  lunes: 'Lunes', martes: 'Martes', miercoles: 'Miércoles', jueves: 'Jueves', viernes: 'Viernes',
}

function fmt(d) {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

/** Fechas (lunes a viernes) de la semana actual. Se recalcula en cada llamada. */
export function getWeekDates() {
  const now = new Date()
  const day = now.getDay() // 0=domingo
  const diffToMonday = day === 0 ? -6 : 1 - day
  const monday = new Date(now)
  monday.setDate(now.getDate() + diffToMonday)
  monday.setHours(0, 0, 0, 0)

  const dates = {}
  DIAS.forEach((dia, idx) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + idx)
    dates[dia] = fmt(d)
  })
  return dates
}

function mapHour(hour) {
  if (hour === 'bmo') return '☀️' // antes de la apertura
  if (hour === 'amc') return '🌙' // después del cierre
  return ''
}

/** Verde si superó lo esperado, rojo si quedó por debajo, null si todavía no hay dato. */
function beatColor(epsActual, epsEstimate) {
  if (epsActual == null || epsEstimate == null) return null
  return epsActual >= epsEstimate ? '#00d9a3' : '#ff4d5e'
}

/**
 * Trae todos los balances de EE.UU. publicados en la semana actual,
 * filtrados a los que tienen CEDEAR, ordenados por relevancia (top 20/día).
 * @returns {Promise<Record<string, Array<{t:string, time:string, color:string|null}>>>}
 */
export async function fetchWeeklyEarningsUS() {
  assertApiKey()
  const dates = getWeekDates()
  const from = dates.lunes
  const to = dates.viernes

  const res = await fetch(`${FINNHUB_BASE}/calendar/earnings?from=${from}&to=${to}&token=${API_KEY}`)
  if (!res.ok) throw new Error('Error consultando el calendario de balances')
  const json = await res.json()
  const rows = Array.isArray(json?.earningsCalendar) ? json.earningsCalendar : []

  const dateToDay = {}
  DIAS.forEach(dia => { dateToDay[dates[dia]] = dia })

  const porDia = {}
  DIAS.forEach(dia => { porDia[dia] = [] })

  rows.forEach(r => {
    if (!r?.symbol || !r?.date) return
    const dia = dateToDay[r.date]
    if (!dia) return
    if (!CEDEAR_TICKERS.has(r.symbol)) return // solo compañías con CEDEAR en BYMA

    porDia[dia].push({ t: r.symbol, time: mapHour(r.hour), color: beatColor(r.epsActual, r.epsEstimate) })
  })

  const porImportancia = (a, b) => importanciaDe(a.t) - importanciaDe(b.t) || a.t.localeCompare(b.t)
  DIAS.forEach(dia => { porDia[dia] = porDia[dia].sort(porImportancia).slice(0, 20) })

  return porDia
}

/** Próxima fecha de balance de un ticker puntual (botón "E" en cada alarma). */
export async function fetchNextEarningsDate(symbol) {
  assertApiKey()
  const hoy = new Date()
  const en1Anio = new Date()
  en1Anio.setFullYear(hoy.getFullYear() + 1)

  const res = await fetch(
    `${FINNHUB_BASE}/calendar/earnings?symbol=${encodeURIComponent(symbol)}&from=${fmt(hoy)}&to=${fmt(en1Anio)}&token=${API_KEY}`
  )
  if (!res.ok) throw new Error(`Error consultando balance de ${symbol}`)
  const json = await res.json()
  const list = Array.isArray(json?.earningsCalendar) ? json.earningsCalendar : []
  if (!list.length) return null

  const fechas = list.map(item => item.date).filter(Boolean).sort()
  return fechas[0] ? new Date(fechas[0] + 'T00:00:00') : null
}