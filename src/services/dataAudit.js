// src/services/dataAudit.js
//
// Control de calidad de datos: revisa tus trades y las posiciones de cada
// cartera y devuelve una lista de problemas, ordenados por gravedad, cada uno
// con una explicación y, cuando se puede arreglar sin riesgo, una acción.
//
// Es una función pura (sin acceso a la base): recibe los datos ya cargados.
// Usa el mismo motor que el resto de la app (lotTracking + portfolioSyncPlan),
// así que "lo que debería haber" se calcula igual que en las pantallas.
//
// Qué revisa:
//  - alta  · VENTA_DE_MAS: vendiste en una cartera más de lo que compraste ahí
//            (típico: la compra está en otra cartera, o falta cargarla).
//  - media · POSICION_DESFASADA: una posición de cartera no coincide con lo que
//            dicen tus trades (falta, sobra, otra cantidad u otro costo).
//            Se corrige sincronizando esa cartera.
//  - media · SIN_CARTERA: operaciones sin cartera asignada; no cuentan en
//            ninguna cartera hasta que les elijas una.
//  - media · DUPLICADA: dos operaciones idénticas (mismo día, ticker, cantidad,
//            precio, comisión y cartera): puede ser una carga repetida.
//  - media · FECHA_FUTURA: operación con fecha posterior a hoy.
//  - baja  · DATOS_INCOMPLETOS: posición sin sector/ratio que el catálogo sí tiene.
//  - baja  · SIN_CCL: compras o ventas de CEDEARs sin CCL (el costo en USD queda
//            incompleto).
//
// No corrige nada por sí misma: solo informa. Las correcciones automáticas
// (fix: 'sync') las ejecuta la pantalla, y solo para posiciones derivadas de
// trades; nunca modifica ni borra operaciones.

import { buildPortfolioLedgers } from './lotTracking.js'
import { planSync } from './portfolioSyncPlan.js'

const SEVERITY_ORDER = { alta: 0, media: 1, baja: 2 }

function todayLocalISO() {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

const fmtQty = (n) => Number(n).toLocaleString('es-AR', { maximumFractionDigits: 6 })
const fmtMoney = (n) => Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// trades: lista de operaciones. portfolios: [{ id, name }].
// positionsByPortfolio: { [portfolioId]: Position[] } — solo se revisan las carteras presentes acá.
export function auditData({ trades = [], portfolios = [], positionsByPortfolio = {}, asOf } = {}) {
  const today = asOf || todayLocalISO()
  const nameOf = (id) => (id == null ? 'Sin cartera' : portfolios.find((p) => String(p.id) === String(id))?.name || `Cartera ${id}`)
  const issues = []
  let n = 0
  const add = (issue) => issues.push({ id: `i${++n}`, portfolioId: null, ticker: null, fix: null, ...issue })

  // 1) Ventas de más, por cartera y ticker.
  const groups = buildPortfolioLedgers(trades)
  for (const g of Object.values(groups.byKey)) {
    for (const L of Object.values(g.ledger.byTicker)) {
      if (!L.inconsistent) continue
      add({
        severity: 'alta',
        code: 'VENTA_DE_MAS',
        title: `${L.ticker}: vendiste de más en ${nameOf(g.portfolioId)}`,
        detail:
          `En esa cartera vendiste ${fmtQty(L.unmatchedQty)} unidades más de las que compraste. ` +
          'Si la compra está cargada en otra cartera, cambiá la cartera de la venta o de la compra; ' +
          'si no, falta cargar una compra.',
        portfolioId: g.portfolioId,
        ticker: L.ticker,
      })
    }
  }

  // 2) Posiciones de cartera que no coinciden con los trades.
  let positionsChecked = 0
  for (const [pid, positions] of Object.entries(positionsByPortfolio)) {
    positionsChecked += positions.length
    const actions = planSync(trades, positions, pid).filter((a) => a.type !== 'skip')
    const existingByTicker = new Map(positions.map((p) => [p.ticker, p]))
    for (const a of actions) {
      const where = nameOf(pid)
      if (a.type === 'create') {
        add({
          severity: 'media', code: 'POSICION_DESFASADA', fix: 'sync', portfolioId: Number(pid), ticker: a.ticker,
          title: `${a.ticker}: falta en ${where}`,
          detail: `Según tus trades deberías tener ${fmtQty(a.payload.quantity)} unidades a $${fmtMoney(a.payload.avgPrice)} de costo promedio, pero no hay posición cargada.`,
        })
      } else if (a.type === 'delete') {
        add({
          severity: 'media', code: 'POSICION_DESFASADA', fix: 'sync', portfolioId: Number(pid), ticker: a.ticker,
          title: `${a.ticker}: ya no tenés unidades en ${where}`,
          detail: 'La posición sigue cargada pero, según tus trades, la vendiste por completo en esa cartera.',
        })
      } else if (a.type === 'update') {
        const ex = existingByTicker.get(a.ticker)
        const changes = []
        if ('quantity' in a.payload) changes.push(`cantidad ${fmtQty(ex.quantity)} → ${fmtQty(a.payload.quantity)}`)
        if ('avgPrice' in a.payload) changes.push(`costo promedio $${fmtMoney(ex.avgPrice)} → $${fmtMoney(a.payload.avgPrice)}`)
        if (changes.length) {
          add({
            severity: 'media', code: 'POSICION_DESFASADA', fix: 'sync', portfolioId: Number(pid), ticker: a.ticker,
            title: `${a.ticker}: la posición no coincide con tus trades en ${where}`,
            detail: `Según tus trades: ${changes.join(', ')}.`,
          })
        } else {
          const missing = []
          if ('sector' in a.payload) missing.push(`sector (${a.payload.sector})`)
          if ('ratio' in a.payload) missing.push(`ratio (${a.payload.ratio})`)
          if ('underlyingTicker' in a.payload) missing.push(`ticker subyacente (${a.payload.underlyingTicker})`)
          add({
            severity: 'baja', code: 'DATOS_INCOMPLETOS', fix: 'sync', portfolioId: Number(pid), ticker: a.ticker,
            title: `${a.ticker}: faltan datos en ${where}`,
            detail: `El catálogo tiene: ${missing.join(', ')}.`,
          })
        }
      }
    }
  }

  // 3) Operaciones sin cartera (solo molesta si ya usás carteras).
  const unassigned = trades.filter((t) => t.portfolioId == null)
  if (unassigned.length && portfolios.length) {
    const tickers = [...new Set(unassigned.map((t) => t.ticker))].sort()
    add({
      severity: 'media', code: 'SIN_CARTERA',
      title: `${unassigned.length} ${unassigned.length === 1 ? 'operación sin cartera' : 'operaciones sin cartera'}`,
      detail: `No cuentan en ninguna cartera hasta que les elijas una (Mis Trades → editar). Tickers: ${tickers.join(', ')}.`,
    })
  }

  // 4) Operaciones duplicadas.
  const seen = new Map()
  for (const t of trades) {
    const key = [t.date, t.ticker, t.operation, Number(t.quantity), Number(t.price), Number(t.fee) || 0, t.portfolioId ?? 'none'].join('|')
    if (!seen.has(key)) seen.set(key, [])
    seen.get(key).push(t)
  }
  for (const list of seen.values()) {
    if (list.length < 2) continue
    const t = list[0]
    add({
      severity: 'media', code: 'DUPLICADA', ticker: t.ticker, portfolioId: t.portfolioId ?? null,
      title: `${t.ticker}: ${list.length} operaciones idénticas`,
      detail: `${t.operation === 'COMPRA' ? 'Compra' : 'Venta'} de ${fmtQty(t.quantity)} a $${fmtMoney(t.price)} el ${t.date} en ${nameOf(t.portfolioId)}. Si no fueron dos operaciones reales, borrá la repetida.`,
    })
  }

  // 5) Fechas futuras.
  for (const t of trades) {
    if (t.date > today) {
      add({
        severity: 'media', code: 'FECHA_FUTURA', ticker: t.ticker, portfolioId: t.portfolioId ?? null,
        title: `${t.ticker}: operación con fecha futura (${t.date})`,
        detail: 'Una fecha posterior a hoy desordena los lotes y los gráficos. Revisá si es un error de carga.',
      })
    }
  }

  // 6) CEDEARs sin CCL (el USD queda incompleto).
  const noCcl = {}
  for (const t of trades) {
    if (t.assetType === 'CEDEAR' && !(Number(t.ccl) > 0)) noCcl[t.ticker] = (noCcl[t.ticker] || 0) + 1
  }
  for (const [ticker, count] of Object.entries(noCcl)) {
    add({
      severity: 'baja', code: 'SIN_CCL', ticker,
      title: `${ticker}: ${count} ${count === 1 ? 'operación' : 'operaciones'} sin CCL`,
      detail: 'El costo y el resultado en dólares de este ticker quedan incompletos hasta que cargues el CCL de cada operación.',
    })
  }

  issues.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.title.localeCompare(b.title, 'es'))
  const counts = { alta: 0, media: 0, baja: 0 }
  for (const i of issues) counts[i.severity] += 1

  return {
    issues,
    counts,
    healthy: issues.length === 0,
    fixableCartera: [...new Set(issues.filter((i) => i.fix === 'sync' && i.portfolioId != null).map((i) => i.portfolioId))],
    checked: { trades: trades.length, positions: positionsChecked, portfolios: Object.keys(positionsByPortfolio).length },
    asOf: today,
  }
}
