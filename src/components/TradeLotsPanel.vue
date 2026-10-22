<script setup>
import { ref, computed, watch, h } from 'vue'
import { buildPortfolioLedgers, lotMatchesToCsv } from '../services/lotTracking'

// Libro de lotes (PEPS/FIFO) por ticker y por cartera: qué compra se vendió con cada venta,
// qué lotes siguen abiertos y cuánto costó realmente lo que te queda.
// Todo se deriva de la lista de trades (no guarda nada nuevo).
const props = defineProps({
  trades: { type: Array, required: true },
  // Resumen por ticker de "Posiciones abiertas" (PPC, cantidad, P&L por promedio)
  // para mostrar al lado y verificar que las cantidades concilian.
  bySymbol: { type: Array, default: () => [] },
  // Carteras ({ id, name }) para mostrar sus nombres en las pestañas.
  portfolios: { type: Array, default: () => [] },
})

const root = ref(null)

// Un libro de lotes por cartera: una venta solo consume lotes comprados en su misma cartera.
const groups = computed(() => buildPortfolioLedgers(props.trades))

const nameOf = (key) =>
  key === 'none' ? 'Sin cartera' : props.portfolios.find((p) => String(p.id) === key)?.name || `Cartera ${key}`

const tabs = computed(() => {
  const keys = [...groups.value.keys].sort((a, b) => {
    if (a === 'none') return 1
    if (b === 'none') return -1
    return nameOf(a).localeCompare(nameOf(b), 'es')
  })
  return keys.map((key) => {
    const l = groups.value.byKey[key].ledger
    return { key, name: nameOf(key), openCount: l.tickers.filter((t) => l.byTicker[t].open.qty > 0).length }
  })
})

const selectedKey = ref('')
watch(
  tabs,
  (list) => {
    if (!list.some((t) => t.key === selectedKey.value)) {
      selectedKey.value = (list.find((t) => t.openCount > 0) || list[0])?.key || ''
    }
  },
  { immediate: true }
)

// Libro de la cartera elegida (misma forma que antes: tickers + byTicker).
const ledger = computed(() => groups.value.byKey[selectedKey.value]?.ledger || { tickers: [], byTicker: {} })
const selected = ref('')

watch(
  () => ledger.value.tickers,
  (tickers) => {
    if (!tickers.includes(selected.value)) selected.value = tickers[0] || ''
  },
  { immediate: true }
)

const current = computed(() => ledger.value.byTicker[selected.value] || null)
const summaryRow = computed(() => props.bySymbol.find((s) => s.ticker === selected.value) || null)

// Dónde más tiene este ticker (otras carteras) y si la suma de todas coincide con "Posiciones abiertas".
const elsewhere = computed(() =>
  tabs.value
    .filter((t) => t.key !== selectedKey.value)
    .map((t) => ({ key: t.key, name: t.name, qty: groups.value.byKey[t.key].ledger.byTicker[selected.value]?.open.qty ?? 0 }))
    .filter((x) => x.qty > 0)
)
const totalOpenAll = computed(() =>
  tabs.value.reduce((a, t) => a + (groups.value.byKey[t.key].ledger.byTicker[selected.value]?.open.qty ?? 0), 0)
)
const reconciles = computed(() => {
  if (!current.value) return true
  return Math.abs((summaryRow.value?.quantity ?? 0) - totalOpenAll.value) < 1e-4
})
// El resultado "por promedio" de Posiciones abiertas es general: solo es comparable si el ticker está en una sola cartera.
const singleCartera = computed(
  () => tabs.value.filter((t) => groups.value.byKey[t.key].ledger.byTicker[selected.value]).length === 1
)
const hasAnyMatch = computed(() =>
  Object.values(groups.value.byKey).some((g) =>
    Object.values(g.ledger.byTicker).some((l) => l.sales.some((s) => s.matches.length))
  )
)

// Lo llama TradesModal desde "Ver lotes": abre la cartera donde ese ticker tiene más unidades abiertas.
function show(ticker) {
  const candidates = tabs.value
    .map((t) => ({ key: t.key, qty: groups.value.byKey[t.key].ledger.byTicker[ticker]?.open.qty ?? -1 }))
    .filter((c) => c.qty >= 0)
    .sort((a, b) => b.qty - a.qty)
  if (candidates.length) {
    selectedKey.value = candidates[0].key
    selected.value = ticker
  }
  root.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
defineExpose({ show })

const fmt = (n, d = 2) =>
  n == null ? '—' : Number(n).toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d })
const fmtQty = (n) => Number(n).toLocaleString('es-AR', { maximumFractionDigits: 6 })
const fmtDate = (d) => {
  if (!d) return '—'
  const [y, m, day] = String(d).slice(0, 10).split('-')
  return `${day}/${m}/${y}`
}
const signed = (n, d = 2) => (n == null ? '—' : `${n >= 0 ? '+' : '−'}${fmt(Math.abs(n), d)}`)
const plClass = (n) => (n == null ? '' : n >= 0 ? 'pos' : 'neg')
const fmtDays = (n) => (n == null ? '—' : n === 0 ? 'hoy' : n === 1 ? '1 día' : `${n} días`)

const STATUS_LABEL = { ABIERTO: 'Abierto', PARCIAL: 'Parcial', CERRADO: 'Cerrado' }

// ---------- Identificación visual de lotes ----------
// Cada lote tiene un número fijo (L1, L2...) y un color. El color ayuda a
// seguir un lote de una tabla a otra, pero la etiqueta siempre está escrita,
// así se entiende igual sin distinguir colores. Pasar el mouse por una
// etiqueta resalta ese lote en todo el panel; un clic lo deja fijado.
const PALETTE = ['#60a5fa', '#f472b6', '#34d399', '#fbbf24', '#a78bfa', '#fb923c', '#2dd4bf', '#f87171', '#a3e635', '#e879f9']
const lotColor = (seq) => PALETTE[(seq - 1) % PALETTE.length]
function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}
const chipStyle = (seq) => ({
  color: lotColor(seq),
  background: rgba(lotColor(seq), 0.16),
  borderColor: rgba(lotColor(seq), 0.55),
})

const hoverLot = ref(null)
const pinnedLot = ref(null)
const activeLot = computed(() => pinnedLot.value ?? hoverLot.value)
const isFaded = (seq) => activeLot.value != null && activeLot.value !== seq
const togglePin = (seq) => { pinnedLot.value = pinnedLot.value === seq ? null : seq }
watch([selectedKey, selected], () => { hoverLot.value = null; pinnedLot.value = null })

// Etiqueta "L3" con el color del lote (componente funcional, usa el estado de arriba).
const LotChip = (props) =>
  h('button', {
    type: 'button',
    class: ['lot-chip', { active: activeLot.value === props.seq, faded: isFaded(props.seq) }],
    style: chipStyle(props.seq),
    title: `Lote ${props.seq} — clic para fijar el resaltado`,
    onMouseenter: () => { hoverLot.value = props.seq },
    onMouseleave: () => { hoverLot.value = null },
    onClick: () => togglePin(props.seq),
  }, `L${props.seq}`)
LotChip.props = ['seq']

// Barra de un lote: lo que se vendió (rayado, con la venta que lo consumió) y lo que queda (sólido).
function lotSegments(lot) {
  const total = lot.qtyOriginal
  const segs = lot.consumedBy.map((c) => ({
    key: `v${c.saleSeq}-${c.saleId}`,
    pct: (c.qty / total) * 100,
    sold: true,
    label: `V${c.saleSeq} · ${fmtQty(c.qty)}`,
    short: `V${c.saleSeq}`,
    title: `Venta V${c.saleSeq} del ${fmtDate(c.saleDate)}: ${fmtQty(c.qty)} u. a $${fmt(c.salePrice)}`,
  }))
  if (lot.qtyRemaining > 1e-9) {
    segs.push({
      key: 'left', pct: (lot.qtyRemaining / total) * 100, sold: false,
      label: `${fmtQty(lot.qtyRemaining)} quedan`, short: fmtQty(lot.qtyRemaining), title: `Quedan ${fmtQty(lot.qtyRemaining)} u. abiertas`,
    })
  }
  return segs
}
// Barra de una venta: de qué lotes salió, cada tramo con el color de su lote.
function saleSegments(sale) {
  const segs = sale.matches.map((m) => ({
    key: `l${m.lotSeq}`,
    seq: m.lotSeq,
    pct: (m.qty / sale.qty) * 100,
    label: `L${m.lotSeq} · ${fmtQty(m.qty)}`,
    short: `L${m.lotSeq}`,
    title: `${fmtQty(m.qty)} u. del lote L${m.lotSeq} (compra del ${fmtDate(m.lotDate)} a $${fmt(m.buyPrice)})`,
  }))
  if (sale.unmatchedQty > 0) {
    segs.push({ key: 'x', seq: null, pct: (sale.unmatchedQty / sale.qty) * 100, label: 'sin lote', short: '!', title: 'Sin lote de compra asociado' })
  }
  return segs
}
const segStyle = (seg, color, hatched) => ({
  flexBasis: `${Math.max(seg.pct, 0.5)}%`,
  background: hatched
    ? `repeating-linear-gradient(45deg, ${rgba(color, 0.38)} 0 4px, ${rgba(color, 0.14)} 4px 8px)`
    : color,
  color: hatched ? color : '#0b0f17',
})

function downloadCsv() {
  const entries = []
  for (const t of tabs.value) {
    for (const l of Object.values(groups.value.byKey[t.key].ledger.byTicker)) entries.push({ cartera: t.name, ledger: l })
  }
  const csv = lotMatchesToCsv(entries)
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `trazabilidad-lotes-${groups.value.asOf}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div ref="root" class="lots-panel">
    <div class="lots-head">
      <div>
        <div class="lots-title">🔎 Trazabilidad por lotes (PEPS)</div>
        <div class="lots-sub">
          Cada compra es un lote (L1, L2…) con su propio color. Cada venta (V1, V2…) consume lotes del más
          viejo al más nuevo de su misma cartera, y queda registrado qué porción de qué lote se vendió. Pasá el
          mouse por una etiqueta para resaltar ese lote en todo el panel; con un clic queda fijado.
        </div>
      </div>
      <div class="lots-actions">
        <select v-model="selected" class="lots-select" aria-label="Ticker">
          <option v-for="tk in ledger.tickers" :key="tk" :value="tk">
            {{ tk }}{{ ledger.byTicker[tk].open.qty > 0 ? ` · ${fmtQty(ledger.byTicker[tk].open.qty)} abiertas` : ' · cerrada' }}
          </option>
        </select>
        <button
          type="button"
          class="lots-btn"
          :disabled="!hasAnyMatch"
          title="Una fila por cada cruce venta ↔ lote, de todas las carteras y tickers (para tu contador)"
          @click="downloadCsv"
        >⬇ CSV de ventas</button>
      </div>
    </div>

    <!-- Carteras: cada una tiene su propio libro de lotes -->
    <div v-if="tabs.length" class="lots-tabs" role="tablist" aria-label="Cartera">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        type="button"
        role="tab"
        class="lots-tab"
        :class="{ on: tab.key === selectedKey }"
        :aria-selected="tab.key === selectedKey ? 'true' : 'false'"
        @click="selectedKey = tab.key"
      >
        {{ tab.name }}
        <span class="lots-tab-count" :title="`${tab.openCount} posiciones abiertas`">{{ tab.openCount }}</span>
      </button>
    </div>

    <div v-if="!current" class="lots-empty">Todavía no hay operaciones para armar lotes.</div>

    <template v-else>
      <div v-if="current.inconsistent" class="lots-warn">
        ⚠️ En esta cartera vendiste {{ fmtQty(current.unmatchedQty) }} unidades de {{ current.ticker }} más
        de las que compraste acá. Si la compra la cargaste en otra cartera, asigná la venta a esa cartera
        (o cambiá la cartera de la compra); si no, falta cargar una compra. Esa parte no tiene lote asociado
        y no entra en el resultado.
      </div>

      <div v-if="elsewhere.length" class="lots-also">
        {{ current.ticker }} también está en:
        <button v-for="x in elsewhere" :key="x.key" type="button" class="lots-link" @click="selectedKey = x.key">
          {{ x.name }} ({{ fmtQty(x.qty) }})
        </button>
      </div>

      <!-- Resumen del ticker -->
      <div class="kpis">
        <div class="kpi">
          <span class="kpi-label">Cantidad abierta</span>
          <strong>{{ fmtQty(current.open.qty) }}</strong>
          <span v-if="reconciles" class="kpi-sub ok">
            ✓ coincide con Posiciones abiertas<template v-if="elsewhere.length"> (total {{ fmtQty(totalOpenAll) }} entre todas las carteras)</template>
          </span>
          <span v-else class="kpi-sub warn">
            ⚠️ Posiciones abiertas dice {{ fmtQty(summaryRow?.quantity ?? 0) }}; la suma de carteras da {{ fmtQty(totalOpenAll) }}
          </span>
        </div>
        <div class="kpi">
          <span class="kpi-label">Costo de lo abierto (PEPS)</span>
          <strong>${{ fmt(current.open.cost) }}</strong>
          <span class="kpi-sub">{{ current.open.costUSD != null ? `US$${fmt(current.open.costUSD)}` : 'US$ — (falta CCL en algún lote)' }}</span>
        </div>
        <div class="kpi">
          <span class="kpi-label">Costo unitario abierto</span>
          <strong>{{ current.open.unitCost != null ? `$${fmt(current.open.unitCost)}` : '—' }}</strong>
          <span class="kpi-sub" :title="'PPC: promedio de todas las compras abiertas del ticker en todas las carteras, sin distinguir lotes'">
            PPC general {{ summaryRow && summaryRow.quantity > 0 ? `$${fmt(summaryRow.avgCost)}` : '—' }}
          </span>
        </div>
        <div class="kpi">
          <span class="kpi-label">Antigüedad de lo abierto</span>
          <strong>{{ fmtDays(current.open.avgAgeDays) }}</strong>
          <span class="kpi-sub">
            <template v-if="current.open.lotsCount">
              {{ current.open.lotsCount }} lote{{ current.open.lotsCount > 1 ? 's' : '' }} · el más viejo del {{ fmtDate(current.open.oldestLotDate) }}
            </template>
            <template v-else>sin lotes abiertos</template>
          </span>
        </div>
        <div class="kpi">
          <span class="kpi-label">Resultado realizado (PEPS)</span>
          <strong :class="plClass(current.realized.pl)">${{ signed(current.realized.pl) }}</strong>
          <span class="kpi-sub">
            <span :class="plClass(current.realized.plUSD)">{{ current.realized.plUSD != null ? `US$${signed(current.realized.plUSD)}` : 'US$ —' }}</span>
            <template v-if="singleCartera"> · por promedio ${{ summaryRow ? signed(summaryRow.realizedPL) : '—' }}</template>
          </span>
        </div>
      </div>

      <!-- Línea de tiempo: la posición después de cada operación -->
      <div class="lots-block">
        <div class="lots-block-title">Movimientos y posición</div>
        <div class="lots-scroll">
          <table class="lots-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Operación</th>
                <th class="num">Cantidad</th>
                <th class="num">Precio</th>
                <th class="num">Posición después</th>
                <th>Detalle</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="m in current.timeline"
                :key="m.tradeId"
                class="fade-row"
                :class="{ faded: activeLot != null && (m.operation === 'COMPRA' ? m.lotSeq !== activeLot : !m.lots.some((l) => l.seq === activeLot)) }"
              >
                <td>{{ fmtDate(m.date) }}</td>
                <td>
                  <span class="badge" :class="m.operation === 'COMPRA' ? 'badge-buy' : 'badge-sell'">
                    {{ m.operation === 'COMPRA' ? 'Compra' : 'Venta' }}
                  </span>
                </td>
                <td class="num">{{ m.operation === 'COMPRA' ? '+' : '−' }}{{ fmtQty(m.qty) }}</td>
                <td class="num">${{ fmt(m.price) }}</td>
                <td class="num strong">{{ fmtQty(m.runningQty) }}</td>
                <td class="dim">
                  <template v-if="m.operation === 'COMPRA'">abre el lote <LotChip :seq="m.lotSeq" /></template>
                  <template v-else>
                    <span class="strong-dim">V{{ m.saleSeq }}</span> consume
                    <template v-for="(l, i) in m.lots" :key="l.seq">
                      <LotChip :seq="l.seq" /> {{ fmtQty(l.qty) }} u.<span v-if="i < m.lots.length - 1">, </span>
                    </template>
                  </template>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Lotes de compra -->
      <div class="lots-block">
        <div class="lots-block-title">Lotes de compra</div>
        <div class="lots-scroll">
          <table class="lots-table">
            <thead>
              <tr>
                <th>Fecha compra</th>
                <th class="num">Cantidad</th>
                <th class="num">Vendido</th>
                <th class="num">Restante</th>
                <th class="num">Precio</th>
                <th class="num" title="Precio + comisión, por unidad">Costo unit.</th>
                <th>Estado</th>
                <th class="bar-col">Consumo del lote</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="lot in current.lots"
                :key="lot.id"
                class="fade-row"
                :class="{ 'row-closed': lot.status === 'CERRADO', faded: isFaded(lot.seq) }"
              >
                <td class="lot-first" :style="{ boxShadow: `inset 3px 0 0 ${lotColor(lot.seq)}` }">
                  <LotChip :seq="lot.seq" /> {{ fmtDate(lot.date) }}
                </td>
                <td class="num">{{ fmtQty(lot.qtyOriginal) }}</td>
                <td class="num">{{ fmtQty(lot.qtySold) }}</td>
                <td class="num strong">{{ fmtQty(lot.qtyRemaining) }}</td>
                <td class="num">${{ fmt(lot.price) }}</td>
                <td class="num">
                  ${{ fmt(lot.unitCost) }}
                  <div class="dim small">{{ lot.unitCostUSD != null ? `US$${fmt(lot.unitCostUSD)}` : 'US$ —' }}</div>
                </td>
                <td>
                  <span class="badge" :class="'badge-' + lot.status.toLowerCase()">{{ STATUS_LABEL[lot.status] }}</span>
                </td>
                <td class="bar-col">
                  <div class="seg-bar">
                    <span
                      v-for="seg in lotSegments(lot)"
                      :key="seg.key"
                      class="seg"
                      :style="segStyle(seg, lotColor(lot.seq), seg.sold)"
                      :title="seg.title"
                    >{{ seg.pct >= 18 ? seg.label : seg.pct >= 7 ? seg.short : '' }}</span>
                  </div>
                  <div class="dim small bar-legend">
                    <template v-if="lot.consumedBy.length">
                      <span v-for="c in lot.consumedBy" :key="c.saleId" class="legend-item">
                        <b>V{{ c.saleSeq }}</b> {{ fmtQty(c.qty) }} u. · {{ fmtDate(c.saleDate) }} a ${{ fmt(c.salePrice) }}
                      </span>
                    </template>
                    <span v-else>sin ventas</span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Ventas y lotes que consumieron -->
      <div v-if="current.sales.length" class="lots-block">
        <div class="lots-block-title">Ventas y de qué lotes salieron</div>
        <div class="lots-scroll">
          <table class="lots-table">
            <thead>
              <tr>
                <th>Fecha venta</th>
                <th class="num">Cantidad</th>
                <th class="num">Precio</th>
                <th>Lotes consumidos</th>
                <th class="num">Resultado</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="s in current.sales"
                :key="s.id"
                class="fade-row"
                :class="{ faded: activeLot != null && !s.matches.some((m) => m.lotSeq === activeLot) }"
              >
                <td><span class="strong-dim">V{{ s.seq }}</span> {{ fmtDate(s.date) }}</td>
                <td class="num">{{ fmtQty(s.qty) }}</td>
                <td class="num">${{ fmt(s.price) }}</td>
                <td>
                  <div class="seg-bar seg-bar-sale">
                    <span
                      v-for="seg in saleSegments(s)"
                      :key="seg.key"
                      class="seg"
                      :class="{ faded: seg.seq != null && isFaded(seg.seq) }"
                      :style="seg.seq != null ? segStyle(seg, lotColor(seg.seq), false) : { flexBasis: seg.pct + '%', background: '#6b7280', color: '#0b0f17' }"
                      :title="seg.title"
                    >{{ seg.pct >= 18 ? seg.label : seg.pct >= 7 ? seg.short : '' }}</span>
                  </div>
                  <div v-for="(m, i) in s.matches" :key="i" class="match-line" :class="{ faded: isFaded(m.lotSeq) }">
                    <LotChip :seq="m.lotSeq" />
                    <span class="strong">{{ fmtQty(m.qty) }} u.</span>
                    del lote del {{ fmtDate(m.lotDate) }}
                    <span class="dim">(compra a ${{ fmt(m.buyPrice) }} · {{ fmtDays(m.holdingDays) }})</span>
                    <span :class="plClass(m.pl)">→ {{ signed(m.pl) }}</span>
                  </div>
                  <div v-if="s.unmatchedQty > 0" class="match-line neg">
                    {{ fmtQty(s.unmatchedQty) }} u. sin lote de compra asociado
                  </div>
                </td>
                <td class="num">
                  <span :class="plClass(s.realizedPL)">${{ signed(s.realizedPL) }}</span>
                  <div class="small" :class="plClass(s.realizedPLUSD)">
                    {{ s.realizedPLUSD != null ? `US$${signed(s.realizedPLUSD)}` : 'US$ —' }}
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="lots-foot">
        PEPS = primero en entrar, primero en salir. Es el método usado para esta trazabilidad; el PPC de
        "Posiciones abiertas" sigue siendo el costo promedio. Los dos conservan el costo total, solo cambia cómo
        se reparte entre lo vendido y lo que te queda. Con la comisión incluida en el costo y en el neto de
        venta; el USD usa el CCL de cada operación. Antes de usarlo para impuestos, confirmá con tu contador
        qué método de costeo corresponde.
      </div>
    </template>
  </div>
</template>

<style scoped>
.lots-panel {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 20px 22px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-top: 8px;
}
.lots-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
}
.lots-title { font-size: 16px; font-weight: 700; color: var(--text); }
.lots-sub { font-size: 12.5px; color: var(--text-dim); margin-top: 4px; max-width: 620px; line-height: 1.5; }
.lots-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.lots-tabs { display: flex; gap: 8px; flex-wrap: wrap; }
.lots-tab {
  background: var(--panel);
  border: 1px solid var(--border);
  color: var(--text-dim);
  border-radius: 999px;
  padding: 7px 14px;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.lots-tab:hover { color: var(--text); }
.lots-tab.on { background: rgba(37, 99, 235, 0.15); border-color: #2563eb; color: var(--blue, #60a5fa); }
.lots-tab-count { font-size: 11px; opacity: 0.8; font-variant-numeric: tabular-nums; }
.lots-also { font-size: 12.5px; color: var(--text-dim); }
.lots-link { background: none; border: none; padding: 0; margin-left: 8px; color: var(--blue, #60a5fa); font-size: inherit; font-weight: 600; cursor: pointer; }
.lots-link:hover { text-decoration: underline; }
.lots-select {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  padding: 8px 12px;
  font-size: 13px;
  font-family: inherit;
}
.lots-btn {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text-dim);
  padding: 8px 12px;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}
.lots-btn:hover:not(:disabled) { color: var(--text); border-color: var(--text-dim); }
.lots-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.lots-empty { text-align: center; color: var(--text-dim); font-size: 14px; padding: 24px 0; }
.lots-warn {
  background: rgba(234, 179, 8, 0.1);
  border: 1px solid rgba(234, 179, 8, 0.4);
  color: #eab308;
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 12.5px;
  line-height: 1.5;
}

.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; }
.kpi {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}
.kpi-label { font-size: 11.5px; color: var(--text-dim); }
.kpi strong { font-size: 18px; color: var(--text); font-variant-numeric: tabular-nums; }
.kpi-sub { font-size: 11.5px; color: var(--text-dim); font-variant-numeric: tabular-nums; }
.kpi-sub.ok { color: #22c55e; }
.kpi-sub.warn { color: #eab308; }

.lots-block { display: flex; flex-direction: column; gap: 8px; }
.lots-block-title { font-size: 14px; font-weight: 700; color: var(--text); }
.lots-scroll { overflow-x: auto; border: 1px solid var(--border); border-radius: 10px; }
.lots-table { width: 100%; border-collapse: collapse; font-size: 13px; font-variant-numeric: tabular-nums; }
.lots-table th {
  text-align: left;
  padding: 9px 12px;
  background: var(--panel);
  color: var(--text-dim);
  font-size: 11.5px;
  font-weight: 600;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}
.lots-table td { padding: 9px 12px; border-bottom: 1px solid var(--border); color: var(--text); vertical-align: top; }
.lots-table tbody tr:last-child td { border-bottom: none; }
.lots-table .num { text-align: right; white-space: nowrap; }
.row-closed td { opacity: 0.6; }
.strong { font-weight: 700; }
.dim { color: var(--text-dim); }
.small { font-size: 11.5px; }
.pos { color: #22c55e; }
.neg { color: #ef4444; }
.match-line { line-height: 1.6; }

.badge {
  display: inline-block;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}
.badge-buy, .badge-abierto { background: rgba(34, 197, 94, 0.15); color: #22c55e; }
.badge-sell { background: rgba(239, 68, 68, 0.15); color: #ef4444; }
.badge-parcial { background: rgba(234, 179, 8, 0.15); color: #eab308; }
.badge-cerrado { background: rgba(176, 180, 188, 0.15); color: var(--text-dim); }

.lots-foot { font-size: 11.5px; color: var(--text-dim); line-height: 1.6; }

/* Resaltado cruzado entre tablas */
.fade-row, .match-line, .seg { transition: opacity 0.15s; }
.faded { opacity: 0.22; }
.strong-dim { font-weight: 700; color: var(--text-dim); }
.lot-first { white-space: nowrap; padding-left: 14px; }

/* Barras de consumo */
.bar-col { min-width: 230px; }
.seg-bar {
  display: flex;
  width: 100%;
  min-width: 170px;
  height: 20px;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid var(--border);
  background: var(--panel);
}
.seg-bar-sale { margin-bottom: 6px; }
.seg {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10.5px;
  font-weight: 700;
  overflow: hidden;
  white-space: nowrap;
  min-width: 3px;
  border-right: 1px solid rgba(0, 0, 0, 0.25);
}
.seg:last-child { border-right: none; }
.bar-legend { margin-top: 5px; display: flex; flex-direction: column; gap: 1px; line-height: 1.45; }
.legend-item b { color: var(--text-dim); }

@media (max-width: 760px) {
  .lots-panel { padding: 14px 12px; }
}
</style>

<style>
.lots-panel .lot-chip {
  display: inline-block;
  font: inherit;
  font-size: 11px;
  font-weight: 800;
  line-height: 1;
  padding: 3px 7px;
  margin-right: 4px;
  border-radius: 6px;
  border: 1px solid transparent;
  cursor: pointer;
  vertical-align: baseline;
  transition: opacity 0.15s, transform 0.1s;
}
.lots-panel .lot-chip:hover { transform: translateY(-1px); }
.lots-panel .lot-chip.active { outline: 2px solid currentColor; outline-offset: 1px; }
.lots-panel .lot-chip.faded { opacity: 0.3; }
</style>
