// src/services/lotTracking.js
//
// Trazabilidad por lotes (PEPS / FIFO: primero que entra, primero que sale).
//
// Problema que resuelve: con compras y ventas intercaladas del mismo ticker
// (compré 10, vendí 9, compré 10, vendí 7, compré 5) un costo promedio te dice
// cuánto cuesta lo que tenés, pero no QUÉ compra se vendió con cada venta ni
// qué compras te quedan abiertas. Acá cada compra es un LOTE con su fecha,
// cantidad y costo; cada venta consume lotes del más viejo al más nuevo y
// queda registrado exactamente qué porción de qué lote se vendió.
//
// Es una función pura derivada de la lista de trades: no guarda nada nuevo en
// la base. Si editás o borrás una operación, el libro de lotes se recalcula
// solo y siempre es consistente con "Mis Trades".
//
// Reglas:
//  - Orden de procesamiento: fecha ascendente; dentro del mismo día las
//    COMPRAs van antes que las VENTAs (no se puede vender lo que todavía no
//    se compró); luego por id. Esto solo importa si cargaste una compra y una
//    venta del mismo día.
//  - Costo de un lote por unidad = (cantidad × precio + comisión) / cantidad.
//  - Resultado de una venta por unidad = (cantidad × precio − comisión) /
//    cantidad. La comisión de la venta se reparte proporcional entre los
//    lotes que consume.
//  - USD: se calcula con el CCL de cada operación (compra y venta). Si a
//    alguna de las dos le falta el CCL, el USD de ese cruce queda en null (mismo
//    criterio que el resto de la app: nunca se inventa un CCL).
//  - Si una venta supera lo disponible en lotes (dato inconsistente: vendiste
//    más de lo que habías comprado según lo cargado), se consume lo que haya y
//    el excedente queda marcado en `unmatchedQty`; la posición se acota en 0
//    igual que en "Posiciones abiertas".
//
// Nota: PEPS es el método elegido acá para la trazabilidad. El PPC (costo
// promedio) de "Posiciones abiertas" sigue siendo el de siempre; ambos
// métodos conservan el costo total (resultado realizado + costo abierto), solo
// cambia cómo se reparte entre lo vendido y lo que queda.

const EPS = 1e-9
const r6 = (n) => Math.round(n * 1e6) / 1e6

function todayLocalISO() {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

// Días de calendario entre dos fechas "YYYY-MM-DD" (sin corrimientos de huso).
export function daysBetween(fromISO, toISO) {
  if (!fromISO || !toISO) return null
  const [y1, m1, d1] = String(fromISO).slice(0, 10).split('-').map(Number)
  const [y2, m2, d2] = String(toISO).slice(0, 10).split('-').map(Number)
  if (![y1, m1, d1, y2, m2, d2].every(Number.isFinite)) return null
  const a = Date.UTC(y1, m1 - 1, d1)
  const b = Date.UTC(y2, m2 - 1, d2)
  return Math.max(0, Math.round((b - a) / 86_400_000))
}

function sortTrades(trades) {
  return trades
    .filter((t) => Number(t.quantity) > 0 && t.ticker)
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1
      if (a.operation !== b.operation) return a.operation === 'COMPRA' ? -1 : 1
      return (a.id ?? 0) - (b.id ?? 0)
    })
}

function newLedger(trade) {
  return {
    ticker: trade.ticker,
    assetType: trade.assetType,
    lots: [],
    sales: [],
    timeline: [],
    runningQty: 0,
    realized: { pl: 0, plUSD: 0, usdIncomplete: false, matchedQty: 0 },
    unmatchedQty: 0,
    inconsistent: false,
    open: null,
  }
}

// trades: lista tal cual la devuelve el servicio de trades
//   ({ id, date, assetType, ticker, operation, quantity, price, fee, ccl, portfolioId }).
// opts.asOf: fecha "YYYY-MM-DD" contra la que se mide la antigüedad (default: hoy).
export function buildLotLedger(trades, opts = {}) {
  const asOf = opts.asOf || todayLocalISO()
  const byTicker = {}

  for (const t of sortTrades([...trades])) {
    const ledger = (byTicker[t.ticker] ??= newLedger(t))
    const qty = Number(t.quantity)
    const price = Number(t.price)
    const fee = Number(t.fee) || 0
    const ccl = Number(t.ccl) > 0 ? Number(t.ccl) : null

    if (t.operation === 'COMPRA') {
      const lot = {
        id: t.id,
        date: t.date,
        price,
        fee,
        ccl,
        qtyOriginal: qty,
        qtyRemaining: qty,
        qtySold: 0,
        unitCost: (qty * price + fee) / qty,
        unitCostUSD: ccl ? (qty * price + fee) / ccl / qty : null,
        portfolioId: t.portfolioId ?? null,
        consumedBy: [],
        status: 'ABIERTO',
      }
      ledger.lots.push(lot)
      ledger.runningQty = r6(ledger.runningQty + qty)
      ledger.timeline.push({
        tradeId: t.id, date: t.date, operation: 'COMPRA', qty, price,
        runningQty: ledger.runningQty, portfolioId: t.portfolioId ?? null,
      })
      continue
    }

    // VENTA: consume lotes del más viejo al más nuevo.
    const netUnit = (qty * price - fee) / qty
    const netUnitUSD = ccl ? (qty * price - fee) / ccl / qty : null
    let needed = qty
    const matches = []

    for (const lot of ledger.lots) {
      if (needed <= EPS) break
      if (lot.qtyRemaining <= EPS) continue
      const take = Math.min(lot.qtyRemaining, needed)
      lot.qtyRemaining = r6(lot.qtyRemaining - take)
      lot.qtySold = r6(lot.qtySold + take)
      needed = r6(needed - take)
      const pl = take * (netUnit - lot.unitCost)
      const plUSD = netUnitUSD != null && lot.unitCostUSD != null ? take * (netUnitUSD - lot.unitCostUSD) : null
      matches.push({
        lotId: lot.id,
        lotDate: lot.date,
        qty: take,
        buyPrice: lot.price,
        buyUnitCost: lot.unitCost,
        sellPrice: price,
        sellUnitNet: netUnit,
        pl,
        plUSD,
        holdingDays: daysBetween(lot.date, t.date),
      })
      lot.consumedBy.push({ saleId: t.id, saleDate: t.date, qty: take, salePrice: price })
    }

    const unmatched = needed > EPS ? r6(needed) : 0
    if (unmatched > 0) {
      ledger.inconsistent = true
      ledger.unmatchedQty = r6(ledger.unmatchedQty + unmatched)
    }

    const salePL = matches.reduce((a, m) => a + m.pl, 0)
    const salePLUSD = matches.length && matches.every((m) => m.plUSD != null)
      ? matches.reduce((a, m) => a + m.plUSD, 0)
      : null
    ledger.realized.pl += salePL
    ledger.realized.matchedQty = r6(ledger.realized.matchedQty + (qty - unmatched))
    if (salePLUSD == null && matches.length) ledger.realized.usdIncomplete = true
    else if (salePLUSD != null) ledger.realized.plUSD += salePLUSD

    ledger.runningQty = Math.max(0, r6(ledger.runningQty - qty))
    ledger.sales.push({
      id: t.id,
      date: t.date,
      qty,
      price,
      fee,
      ccl,
      qtyMatched: r6(qty - unmatched),
      unmatchedQty: unmatched,
      matches,
      realizedPL: salePL,
      realizedPLUSD: salePLUSD,
      portfolioId: t.portfolioId ?? null,
    })
    ledger.timeline.push({
      tradeId: t.id, date: t.date, operation: 'VENTA', qty, price,
      runningQty: ledger.runningQty, portfolioId: t.portfolioId ?? null,
      lotsTouched: matches.length,
    })
  }

  // Estado de cada lote + resumen de lo que queda abierto.
  for (const ledger of Object.values(byTicker)) {
    for (const lot of ledger.lots) {
      lot.status = lot.qtyRemaining <= EPS ? 'CERRADO' : lot.qtySold > EPS ? 'PARCIAL' : 'ABIERTO'
    }
    const openLots = ledger.lots.filter((l) => l.qtyRemaining > EPS)
    const qty = r6(openLots.reduce((a, l) => a + l.qtyRemaining, 0))
    const cost = openLots.reduce((a, l) => a + l.qtyRemaining * l.unitCost, 0)
    const usdOk = openLots.length > 0 && openLots.every((l) => l.unitCostUSD != null)
    const costUSD = usdOk ? openLots.reduce((a, l) => a + l.qtyRemaining * l.unitCostUSD, 0) : null
    const ageWeighted = openLots.reduce((a, l) => a + (daysBetween(l.date, asOf) ?? 0) * l.qtyRemaining, 0)
    ledger.open = {
      qty,
      cost,
      unitCost: qty > 0 ? cost / qty : null,
      costUSD,
      unitCostUSD: costUSD != null && qty > 0 ? costUSD / qty : null,
      avgAgeDays: qty > 0 ? Math.round(ageWeighted / qty) : null,
      oldestLotDate: openLots[0]?.date ?? null,
      lotsCount: openLots.length,
    }
    if (ledger.realized.usdIncomplete) ledger.realized.plUSD = null
  }

  // Abiertos primero (por cantidad de lotes abiertos), después cerrados; alfabético.
  const tickers = Object.keys(byTicker).sort((a, b) => {
    const oa = byTicker[a].open.qty > 0 ? 0 : 1
    const ob = byTicker[b].open.qty > 0 ? 0 : 1
    return oa - ob || a.localeCompare(b)
  })

  return { byTicker, tickers, asOf }
}

// CSV (separador ";" y coma decimal, para abrirlo directo en Excel es-AR) con
// una fila por cada cruce venta ↔ lote: sirve para respaldar el costo de cada
// venta ante un contador.
export function lotMatchesToCsv(ledgers) {
  const num = (n, d = 2) => (n == null ? '' : Number(n).toFixed(d).replace('.', ','))
  const header = [
    'Ticker', 'Fecha venta', 'Fecha compra (lote)', 'Cantidad', 'Precio compra', 'Costo unitario (c/comisión)',
    'Precio venta', 'Neto unitario venta', 'Resultado ARS', 'Resultado USD', 'Días en cartera',
  ]
  const rows = []
  for (const L of ledgers) {
    for (const s of L.sales) {
      for (const m of s.matches) {
        rows.push([
          L.ticker, s.date, m.lotDate, num(m.qty, 6), num(m.buyPrice), num(m.buyUnitCost, 4),
          num(m.sellPrice), num(m.sellUnitNet, 4), num(m.pl), num(m.plUSD), m.holdingDays ?? '',
        ])
      }
    }
  }
  return [header, ...rows].map((r) => r.join(';')).join('\r\n')
}
