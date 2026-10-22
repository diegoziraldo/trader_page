<script setup>
import { ref, computed, watch, h } from 'vue'
import { buildPortfolioLedgers, lotMatchesToCsv } from '../services/lotTracking'

// Trazabilidad por lotes (PEPS), separada por cartera.
// Todo se deriva de la lista de trades: no guarda nada nuevo.
const props = defineProps({
  trades: { type: Array, required: true },
  // Resumen general de "Posiciones abiertas" (todas las carteras juntas), para verificar que las cantidades concilian.
  bySymbol: { type: Array, default: () => [] },
  portfolios: { type: Array, default: () => [] },
})

const root = ref(null)
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
    const { ledger } = groups.value.byKey[key]
    const openCount = ledger.tickers.filter((t) => ledger.byTicker[t].open.qty > 0).length
    return { key, name: nameOf(key), openCount }
  })
})

const selectedKey = ref('')
const selectedTicker = ref('')

watch(
  tabs,
  (list) => {
    if (!list.some((t) => t.key === selectedKey.value)) {
      selectedKey.value = (list.find((t) => t.openCount > 0) || list[0])?.key || ''
    }
  },
  { immediate: true }
)

const group = computed(() => groups.value.byKey[selectedKey.value] || null)
const tickers = computed(() => group.value?.ledger.tickers || [])
watch(
  group,
  () => {
    if (!tickers.value.includes(selectedTicker.value)) selectedTicker.value = tickers.value[0] || ''
  },
  { immediate: true }
)

const current = computed(() => group.value?.ledger.byTicker[selectedTicker.value] || null)
const tickerLedger = (tk) => group.value.ledger.byTicker[tk]

// Dónde más tiene este ticker (otras carteras) y si la suma coincide con "Posiciones abiertas".
const elsewhere = computed(() => {
  const tk = selectedTicker.value
  if (!tk) return []
  return tabs.value
    .filter((t) => t.key !== selectedKey.value)
    .map((t) => ({ key: t.key, name: t.name, qty: groups.value.byKey[t.key].ledger.byTicker[tk]?.open.qty ?? 0 }))
    .filter((x) => x.qty > 0)
})
const totalOpenAllPortfolios = computed(() =>
  tabs.value.reduce((a, t) => a + (groups.value.byKey[t.key].ledger.byTicker[selectedTicker.value]?.open.qty ?? 0), 0)
)
const summaryRow = computed(() => props.bySymbol.find((s) => s.ticker === selectedTicker.value) || null)
const reconciles = computed(() => Math.abs((summaryRow.value?.quantity ?? 0) - totalOpenAllPortfolios.value) < 1e-4)

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
    selectedTicker.value = ticker
  }
  root.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
defineExpose({ show })

// ---------- Formato ----------
const fmt = (n, d = 2) =>
  n == null ? '—' : Number(n).toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d })
const fmtQty = (n) => Number(n).toLocaleString('es-AR', { maximumFractionDigits: 6 })
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const fmtDate = (d) => {
  if (!d) return '—'
  const [y, m, day] = String(d).slice(0, 10).split('-')
  return `${Number(day)} ${MONTHS[Number(m) - 1]} ${y}`
}
const signed = (n, d = 2) => (n == null ? '—' : `${n >= 0 ? '+' : '−'}${fmt(Math.abs(n), d)}`)
const plClass = (n) => (n == null ? '' : n >= 0 ? 'gain' : 'loss')
const fmtDays = (n) => (n == null ? '—' : n === 0 ? 'hoy' : n === 1 ? '1 día' : `${n} días`)
const STATUS_LABEL = { ABIERTO: 'Abierto', PARCIAL: 'Parcial', CERRADO: 'Cerrado' }

// ---------- Identidad visual de cada lote ----------
// Cada lote tiene un número fijo (L1, L2…) y un tono. El tono ayuda a seguir un lote entre
// secciones; la etiqueta siempre está escrita, así se entiende igual sin distinguir colores.
// Los tonos evitan el verde y el rojo, que se reservan para ganancia y pérdida.
// Pasar el mouse por una etiqueta resalta ese lote en todo el panel; un clic lo deja fijado.
const PALETTE = ['#0a84ff', '#ff9f0a', '#bf5af2', '#64d2ff', '#ffd60a', '#ff8ad8', '#8e8cff', '#c7a27c', '#66d4cf', '#c9ccd3']
const lotColor = (seq) => PALETTE[(seq - 1) % PALETTE.length]
function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}
const chipStyle = (seq) => ({ color: lotColor(seq), background: rgba(lotColor(seq), 0.15), boxShadow: `inset 0 0 0 1px ${rgba(lotColor(seq), 0.45)}` })

const hoverLot = ref(null)
const pinnedLot = ref(null)
const activeLot = computed(() => pinnedLot.value ?? hoverLot.value)
const isFaded = (seq) => activeLot.value != null && activeLot.value !== seq
const togglePin = (seq) => { pinnedLot.value = pinnedLot.value === seq ? null : seq }
watch([selectedKey, selectedTicker], () => { hoverLot.value = null; pinnedLot.value = null })

const LotChip = (p) =>
  h('button', {
    type: 'button',
    class: ['lp-chip', { active: activeLot.value === p.seq, faded: isFaded(p.seq) }],
    style: chipStyle(p.seq),
    'aria-pressed': pinnedLot.value === p.seq ? 'true' : 'false',
    title: `Lote ${p.seq}: clic para fijar el resaltado`,
    onMouseenter: () => { hoverLot.value = p.seq },
    onMouseleave: () => { hoverLot.value = null },
    onFocus: () => { hoverLot.value = p.seq },
    onBlur: () => { hoverLot.value = null },
    onClick: () => togglePin(p.seq),
  }, `L${p.seq}`)
LotChip.props = ['seq']

// Franja de un lote: lo vendido (tono suave, con la venta que lo consumió) y lo que queda (tono pleno).
function lotSegments(lot) {
  const segs = lot.consumedBy.map((c) => ({
    key: `v${c.saleSeq}-${c.saleId}`,
    pct: (c.qty / lot.qtyOriginal) * 100,
    sold: true,
    label: `V${c.saleSeq} · ${fmtQty(c.qty)}`,
    short: `V${c.saleSeq}`,
    title: `Venta V${c.saleSeq} del ${fmtDate(c.saleDate)}: ${fmtQty(c.qty)} u. a $${fmt(c.salePrice)}`,
  }))
  if (lot.qtyRemaining > 1e-9) {
    segs.push({
      key: 'left',
      pct: (lot.qtyRemaining / lot.qtyOriginal) * 100,
      sold: false,
      label: `${fmtQty(lot.qtyRemaining)} quedan`,
      short: fmtQty(lot.qtyRemaining),
      title: `Quedan ${fmtQty(lot.qtyRemaining)} u. abiertas`,
    })
  }
  return segs
}
// Franja de una venta: de qué lotes salió, cada tramo con el tono de su lote.
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
const segLabel = (seg) => (seg.pct >= 18 ? seg.label : seg.pct >= 7 ? seg.short : '')
const segStyle = (seg, color, soft) => ({
  flexBasis: `${Math.max(seg.pct, 0.5)}%`,
  background: soft ? rgba(color, 0.22) : color,
  color: soft ? color : '#0b0d12',
})
const unmatchedStyle = (seg) => ({ flexBasis: `${seg.pct}%`, background: '#6b7280', color: '#0b0d12' })

function lotAria(lot) {
  const sold = lot.consumedBy.map((c) => `${fmtQty(c.qty)} en la venta V${c.saleSeq}`).join(', ')
  return `Lote L${lot.seq}: ${fmtQty(lot.qtyOriginal)} unidades. ${sold ? `Vendidas ${sold}. ` : ''}${
    lot.qtyRemaining > 0 ? `Quedan ${fmtQty(lot.qtyRemaining)}.` : 'Sin unidades abiertas.'
  }`
}
function saleAria(s) {
  return `Venta V${s.seq}: ${fmtQty(s.qty)} unidades. ${s.matches.map((m) => `${fmtQty(m.qty)} del lote L${m.lotSeq}`).join(', ')}.`
}

function downloadCsv() {
  const entries = []
  for (const t of tabs.value) {
    for (const ledger of Object.values(groups.value.byKey[t.key].ledger.byTicker)) entries.push({ cartera: t.name, ledger })
  }
  const blob = new Blob(['\ufeff' + lotMatchesToCsv(entries)], { type: 'text/csv;charset=utf-8' })
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
  <section ref="root" class="lp" aria-label="Trazabilidad por lotes">
    <header class="lp-head">
      <div>
        <h2 class="lp-title">Trazabilidad por lotes</h2>
        <p class="lp-lede">
          Cada compra abre un lote. Cada venta consume primero los lotes más antiguos de su misma cartera.
        </p>
      </div>
      <button
        type="button"
        class="lp-btn"
        :disabled="!hasAnyMatch"
        title="Una fila por cada cruce entre una venta y un lote, de todas las carteras"
        @click="downloadCsv"
      >Exportar ventas (CSV)</button>
    </header>

    <p v-if="!tabs.length" class="lp-empty">
      Todavía no hay operaciones. Cargá una compra en Mis Trades y vas a ver acá sus lotes.
    </p>

    <template v-else>
      <div class="lp-tabs" role="tablist" aria-label="Cartera">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          type="button"
          role="tab"
          class="lp-tab"
          :class="{ on: tab.key === selectedKey }"
          :aria-selected="tab.key === selectedKey ? 'true' : 'false'"
          @click="selectedKey = tab.key"
        >
          <span>{{ tab.name }}</span>
          <span class="lp-tab-count" :title="`${tab.openCount} posiciones abiertas`">{{ tab.openCount }}</span>
        </button>
      </div>

      <div class="lp-body">
        <nav class="lp-list" aria-label="Posiciones de la cartera">
          <button
            v-for="tk in tickers"
            :key="tk"
            type="button"
            class="lp-item"
            :class="{ on: tk === selectedTicker, closed: tickerLedger(tk).open.qty <= 0 }"
            :aria-current="tk === selectedTicker ? 'true' : undefined"
            @click="selectedTicker = tk"
          >
            <span class="lp-item-main">
              <b>{{ tk }}</b>
              <small>{{ tickerLedger(tk).open.qty > 0 ? `${fmtQty(tickerLedger(tk).open.qty)} abiertas` : 'Cerrada' }}</small>
            </span>
            <span v-if="tickerLedger(tk).open.qty > 0" class="lp-item-val">${{ fmt(tickerLedger(tk).open.cost, 0) }}</span>
          </button>
        </nav>

        <div v-if="current" class="lp-detail">
          <div class="lp-dhead">
            <h3>{{ current.ticker }}</h3>
            <span class="lp-kind">{{ current.assetType === 'CEDEAR' ? 'CEDEAR' : 'Acción argentina' }}</span>
            <span class="lp-state" :class="current.open.qty > 0 ? 's-abierto' : 's-cerrado'">
              <i></i>{{ current.open.qty > 0 ? 'Abierta' : 'Cerrada' }}
            </span>
          </div>

          <p v-if="elsewhere.length" class="lp-also">
            {{ current.ticker }} también está en
            <button v-for="x in elsewhere" :key="x.key" type="button" class="lp-link" @click="selectedKey = x.key">
              {{ x.name }} ({{ fmtQty(x.qty) }})
            </button>
          </p>

          <p v-if="current.inconsistent" class="lp-note">
            <span class="lp-note-mark" aria-hidden="true">!</span>
            <span>
              En esta cartera hay ventas por {{ fmtQty(current.unmatchedQty) }} unidades más de las que se compraron acá.
              Si la compra la cargaste en otra cartera, asigná la venta a esa cartera o cambiá la cartera de la compra.
            </span>
          </p>

          <dl class="lp-kpis">
            <div class="kpi">
              <dt>Cantidad abierta</dt>
              <dd class="kpi-main">{{ fmtQty(current.open.qty) }}</dd>
              <dd class="kpi-sub" :class="reconciles ? 'ok' : 'warn'">
                <template v-if="reconciles">Coincide con Posiciones abiertas</template>
                <template v-else>
                  Posiciones abiertas dice {{ fmtQty(summaryRow?.quantity ?? 0) }}; la suma de carteras da {{ fmtQty(totalOpenAllPortfolios) }}
                </template>
              </dd>
            </div>
            <div class="kpi">
              <dt>Costo de lo abierto</dt>
              <dd class="kpi-main">${{ fmt(current.open.cost) }}</dd>
              <dd class="kpi-sub">{{ current.open.costUSD != null ? `US$${fmt(current.open.costUSD)}` : 'US$ — falta el CCL en algún lote' }}</dd>
            </div>
            <div class="kpi">
              <dt>Costo unitario</dt>
              <dd class="kpi-main">{{ current.open.unitCost != null ? `$${fmt(current.open.unitCost)}` : '—' }}</dd>
              <dd class="kpi-sub" title="PPC: promedio de todas tus compras abiertas del ticker, en todas las carteras">
                PPC general {{ summaryRow && summaryRow.quantity > 0 ? `$${fmt(summaryRow.avgCost)}` : '—' }}
              </dd>
            </div>
            <div class="kpi">
              <dt>Antigüedad</dt>
              <dd class="kpi-main">{{ fmtDays(current.open.avgAgeDays) }}</dd>
              <dd class="kpi-sub">
                <template v-if="current.open.lotsCount">
                  {{ current.open.lotsCount }} {{ current.open.lotsCount > 1 ? 'lotes abiertos' : 'lote abierto' }}, el más viejo del {{ fmtDate(current.open.oldestLotDate) }}
                </template>
                <template v-else>Sin lotes abiertos</template>
              </dd>
            </div>
            <div class="kpi">
              <dt>Resultado realizado</dt>
              <dd class="kpi-main" :class="plClass(current.realized.pl)">${{ signed(current.realized.pl) }}</dd>
              <dd class="kpi-sub" :class="plClass(current.realized.plUSD)">
                {{ current.realized.plUSD != null ? `US$${signed(current.realized.plUSD)}` : 'US$ —' }}
              </dd>
            </div>
          </dl>

          <section class="lp-sec">
            <header class="lp-sec-head">
              <h4>Lotes</h4>
              <p>En orden de compra. La franja muestra qué parte se vendió y cuánto queda.</p>
            </header>
            <ol class="rows">
              <li v-for="lot in current.lots" :key="lot.id" class="row" :class="{ faded: isFaded(lot.seq), done: lot.status === 'CERRADO' }">
                <div class="row-id">
                  <LotChip :seq="lot.seq" />
                  <span class="row-date">{{ fmtDate(lot.date) }}</span>
                </div>
                <div class="strip" role="img" :aria-label="lotAria(lot)">
                  <span
                    v-for="seg in lotSegments(lot)"
                    :key="seg.key"
                    class="seg"
                    :style="segStyle(seg, lotColor(lot.seq), seg.sold)"
                    :title="seg.title"
                  >{{ segLabel(seg) }}</span>
                </div>
                <div class="row-end">
                  <strong>{{ fmtQty(lot.qtyRemaining) }}</strong>
                  <span class="state" :class="'s-' + lot.status.toLowerCase()"><i></i>{{ STATUS_LABEL[lot.status] }}</span>
                </div>
                <dl class="facts">
                  <div><dt>Compra</dt><dd>{{ fmtQty(lot.qtyOriginal) }} u. a ${{ fmt(lot.price) }}</dd></div>
                  <div>
                    <dt>Costo unitario</dt>
                    <dd>${{ fmt(lot.unitCost) }}<span v-if="lot.unitCostUSD != null" class="dim"> (US${{ fmt(lot.unitCostUSD) }})</span></dd>
                  </div>
                  <div v-for="c in lot.consumedBy" :key="c.saleId">
                    <dt>V{{ c.saleSeq }}</dt>
                    <dd>{{ fmtQty(c.qty) }} u. el {{ fmtDate(c.saleDate) }} a ${{ fmt(c.salePrice) }}</dd>
                  </div>
                </dl>
              </li>
            </ol>
          </section>

          <section v-if="current.sales.length" class="lp-sec">
            <header class="lp-sec-head">
              <h4>Ventas</h4>
              <p>De qué lotes salió cada venta y cuánto resultó en cada tramo.</p>
            </header>
            <ol class="rows">
              <li
                v-for="s in current.sales"
                :key="s.id"
                class="row"
                :class="{ faded: activeLot != null && !s.matches.some((m) => m.lotSeq === activeLot) }"
              >
                <div class="row-id">
                  <span class="vtag">V{{ s.seq }}</span>
                  <span class="row-date">{{ fmtDate(s.date) }}</span>
                </div>
                <div class="strip" role="img" :aria-label="saleAria(s)">
                  <span
                    v-for="seg in saleSegments(s)"
                    :key="seg.key"
                    class="seg"
                    :class="{ faded: seg.seq != null && isFaded(seg.seq) }"
                    :style="seg.seq != null ? segStyle(seg, lotColor(seg.seq), false) : unmatchedStyle(seg)"
                    :title="seg.title"
                  >{{ segLabel(seg) }}</span>
                </div>
                <div class="row-end">
                  <strong :class="plClass(s.realizedPL)">${{ signed(s.realizedPL) }}</strong>
                  <span class="sub" :class="plClass(s.realizedPLUSD)">{{ s.realizedPLUSD != null ? `US$${signed(s.realizedPLUSD)}` : 'US$ —' }}</span>
                </div>
                <div class="matches">
                  <div class="match-head">{{ fmtQty(s.qty) }} u. a ${{ fmt(s.price) }}</div>
                  <div v-for="(m, i) in s.matches" :key="i" class="match" :class="{ faded: isFaded(m.lotSeq) }">
                    <LotChip :seq="m.lotSeq" />
                    <span>{{ fmtQty(m.qty) }} u. del lote del {{ fmtDate(m.lotDate) }}</span>
                    <span class="dim">compra a ${{ fmt(m.buyPrice) }}, {{ fmtDays(m.holdingDays) }} en cartera</span>
                    <span class="match-pl" :class="plClass(m.pl)">{{ signed(m.pl) }}</span>
                  </div>
                  <div v-if="s.unmatchedQty > 0" class="match loss">
                    {{ fmtQty(s.unmatchedQty) }} u. sin lote de compra en esta cartera
                  </div>
                </div>
              </li>
            </ol>
          </section>

          <details class="lp-moves">
            <summary>Historial de movimientos</summary>
            <div class="lp-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Operación</th>
                    <th class="num">Cantidad</th>
                    <th class="num">Precio</th>
                    <th class="num">Posición después</th>
                    <th>Lotes</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="m in current.timeline" :key="m.tradeId">
                    <td>{{ fmtDate(m.date) }}</td>
                    <td>{{ m.operation === 'COMPRA' ? 'Compra' : 'Venta' }}</td>
                    <td class="num">{{ m.operation === 'COMPRA' ? '+' : '−' }}{{ fmtQty(m.qty) }}</td>
                    <td class="num">${{ fmt(m.price) }}</td>
                    <td class="num strong">{{ fmtQty(m.runningQty) }}</td>
                    <td class="lots-cell">
                      <template v-if="m.operation === 'COMPRA'">abre <LotChip :seq="m.lotSeq" /></template>
                      <template v-else>
                        <span class="dim">V{{ m.saleSeq }} consume</span>
                        <template v-for="l in m.lots" :key="l.seq"><LotChip :seq="l.seq" />{{ fmtQty(l.qty) }}</template>
                      </template>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </details>

          <p class="lp-foot">
            Método PEPS (primero en entrar, primero en salir). Las comisiones están incluidas en el costo de cada lote y
            en el neto de cada venta; el USD usa el CCL de cada operación. El PPC de Posiciones abiertas sigue siendo el costo
            promedio: los dos métodos conservan el costo total y solo cambia cómo se reparte entre lo vendido y lo que queda.
            Antes de usar esto para impuestos, confirmá con tu contador qué método de costeo corresponde.
          </p>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.lp {
  --lp-line: rgba(255, 255, 255, 0.09);
  --lp-fill: rgba(255, 255, 255, 0.04);
  --lp-fill-strong: rgba(255, 255, 255, 0.09);
  --lp-gain: #30d158;
  --lp-loss: #ff453a;
  --lp-accent: #0a84ff;
  --lp-warn: #ff9f0a;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', 'Segoe UI', system-ui, sans-serif;
  font-size: 13px;
  line-height: 1.45;
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--lp-line);
  border-radius: 18px;
  padding: 26px 28px;
  display: flex;
  flex-direction: column;
  gap: 22px;
  margin-top: 8px;
  -webkit-font-smoothing: antialiased;
}
.lp button { font-family: inherit; }
.lp button:focus-visible, .lp summary:focus-visible { outline: 2px solid var(--lp-accent); outline-offset: 2px; }

.lp-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.lp-title { margin: 0; font-size: 21px; font-weight: 650; letter-spacing: -0.015em; }
.lp-lede { margin: 6px 0 0; color: var(--text-dim); max-width: 560px; }
.lp-btn {
  appearance: none;
  background: var(--lp-fill);
  color: var(--text);
  border: 1px solid var(--lp-line);
  border-radius: 10px;
  padding: 8px 14px;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s;
}
.lp-btn:hover:not(:disabled) { background: var(--lp-fill-strong); }
.lp-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.lp-empty { color: var(--text-dim); text-align: center; padding: 28px 0; margin: 0; }

/* Cartera: control segmentado */
.lp-tabs {
  display: flex;
  gap: 2px;
  padding: 3px;
  background: var(--lp-fill);
  border: 1px solid var(--lp-line);
  border-radius: 12px;
  align-self: flex-start;
  max-width: 100%;
  overflow-x: auto;
}
.lp-tab {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--text-dim);
  font-size: 13px;
  font-weight: 500;
  padding: 7px 14px;
  border-radius: 9px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
  transition: background 0.15s, color 0.15s;
}
.lp-tab:hover { color: var(--text); }
.lp-tab.on { background: var(--lp-fill-strong); color: var(--text); }
.lp-tab-count { font-size: 11.5px; color: var(--text-dim); font-variant-numeric: tabular-nums; }

.lp-body { display: grid; grid-template-columns: 210px minmax(0, 1fr); gap: 32px; align-items: start; }

/* Lista de posiciones */
.lp-list { display: flex; flex-direction: column; gap: 2px; }
.lp-item {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--text);
  text-align: left;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.15s;
}
.lp-item:hover { background: var(--lp-fill); }
.lp-item.on { background: var(--lp-fill-strong); }
.lp-item.closed .lp-item-main b { color: var(--text-dim); font-weight: 550; }
.lp-item-main { display: flex; flex-direction: column; min-width: 0; }
.lp-item-main b { font-size: 14px; font-weight: 650; letter-spacing: -0.005em; }
.lp-item-main small { color: var(--text-dim); font-size: 11.5px; }
.lp-item-val { color: var(--text-dim); font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; }

/* Detalle */
.lp-detail { display: flex; flex-direction: column; gap: 22px; min-width: 0; }
.lp-dhead { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.lp-dhead h3 { margin: 0; font-size: 26px; font-weight: 650; letter-spacing: -0.02em; }
.lp-kind { color: var(--text-dim); font-size: 12.5px; }
.lp-state, .state { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-dim); }
.lp-state i, .state i { width: 7px; height: 7px; border-radius: 50%; background: var(--text-dim); display: inline-block; }
.s-abierto i { background: var(--lp-accent); }
.s-parcial i { background: var(--lp-warn); }
.s-cerrado i { background: #6b7280; }
.lp-also { margin: -10px 0 0; color: var(--text-dim); }
.lp-link {
  appearance: none;
  background: none;
  border: 0;
  padding: 0;
  margin-left: 8px;
  color: var(--lp-accent);
  font-size: inherit;
  cursor: pointer;
}
.lp-link:hover { text-decoration: underline; }
.lp-note {
  margin: 0;
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 12px 14px;
  background: rgba(255, 159, 10, 0.08);
  border: 1px solid rgba(255, 159, 10, 0.3);
  border-radius: 12px;
  color: var(--text);
}
.lp-note-mark {
  flex: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--lp-warn);
  color: #1a1100;
  font-size: 12px;
  font-weight: 800;
  display: grid;
  place-items: center;
  margin-top: 1px;
}

/* Cifras clave: una sola superficie con divisores finos */
.lp-kpis {
  margin: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(176px, 1fr));
  gap: 1px;
  background: var(--lp-line);
  border: 1px solid var(--lp-line);
  border-radius: 14px;
  overflow: hidden;
}
.kpi { background: var(--bg); padding: 14px 16px; display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.kpi dt { color: var(--text-dim); font-size: 12px; }
.kpi dd { margin: 0; }
.kpi-main { font-size: 22px; font-weight: 600; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.kpi-sub { color: var(--text-dim); font-size: 11.5px; font-variant-numeric: tabular-nums; }
.kpi-sub.ok { color: var(--lp-gain); }
.kpi-sub.warn { color: var(--lp-warn); }
.gain { color: var(--lp-gain); }
.loss { color: var(--lp-loss); }

/* Secciones */
.lp-sec { display: flex; flex-direction: column; gap: 6px; }
.lp-sec-head { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; }
.lp-sec-head h4 { margin: 0; font-size: 16px; font-weight: 650; letter-spacing: -0.01em; }
.lp-sec-head p { margin: 0; color: var(--text-dim); font-size: 12.5px; }
.rows { list-style: none; margin: 0; padding: 0; }
.row {
  display: grid;
  grid-template-columns: 158px minmax(0, 1fr) 124px;
  gap: 8px 20px;
  align-items: center;
  padding: 16px 0;
  border-top: 1px solid var(--lp-line);
  transition: opacity 0.15s;
}
.row:first-child { border-top: 0; }
.row.done .row-date, .row.done .row-end strong { color: var(--text-dim); }
.row-id { display: flex; align-items: center; gap: 10px; }
.row-date { font-weight: 550; white-space: nowrap; }
.vtag {
  display: inline-block;
  min-width: 30px;
  text-align: center;
  font-size: 11px;
  font-weight: 700;
  padding: 3px 7px;
  border-radius: 7px;
  background: var(--lp-fill-strong);
  color: var(--text-dim);
}
.row-end { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; font-variant-numeric: tabular-nums; }
.row-end strong { font-size: 15px; font-weight: 650; }
.row-end .sub { font-size: 11.5px; }

/* La franja: el elemento central del panel */
.strip { display: flex; gap: 2px; height: 26px; min-width: 120px; }
.seg {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 650;
  border-radius: 6px;
  overflow: hidden;
  white-space: nowrap;
  min-width: 4px;
  flex-shrink: 1;
  transition: opacity 0.15s;
}

.facts { grid-column: 1 / -1; margin: 0; display: flex; flex-wrap: wrap; gap: 2px 26px; }
.facts div { display: flex; gap: 8px; align-items: baseline; }
.facts dt { color: var(--text-dim); font-size: 12px; }
.facts dd { margin: 0; font-variant-numeric: tabular-nums; }
.dim { color: var(--text-dim); }

.matches { grid-column: 1 / -1; display: flex; flex-direction: column; gap: 5px; }
.match-head { color: var(--text-dim); font-size: 12px; }
.match { display: flex; align-items: center; gap: 4px 12px; flex-wrap: wrap; transition: opacity 0.15s; font-variant-numeric: tabular-nums; }
.match-pl { margin-left: auto; font-weight: 600; }

.faded { opacity: 0.2; }

/* Historial */
.lp-moves { border-top: 1px solid var(--lp-line); padding-top: 14px; }
.lp-moves summary { cursor: pointer; font-size: 14px; font-weight: 600; list-style: none; display: flex; align-items: center; gap: 8px; }
.lp-moves summary::-webkit-details-marker { display: none; }
.lp-moves summary::before {
  content: '';
  width: 7px;
  height: 7px;
  border-right: 1.5px solid var(--text-dim);
  border-bottom: 1.5px solid var(--text-dim);
  transform: rotate(-45deg);
  transition: transform 0.15s;
}
.lp-moves[open] summary::before { transform: rotate(45deg); }
.lp-scroll { overflow-x: auto; margin-top: 12px; }
.lp-moves table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
.lp-moves th { text-align: left; color: var(--text-dim); font-size: 12px; font-weight: 500; padding: 6px 12px 6px 0; white-space: nowrap; }
.lp-moves td { padding: 9px 12px 9px 0; border-top: 1px solid var(--lp-line); vertical-align: middle; }
.lp-moves .num { text-align: right; white-space: nowrap; }
.lp-moves .strong { font-weight: 650; }
.lots-cell { display: flex; align-items: center; gap: 4px 6px; flex-wrap: wrap; }

.lp-foot { margin: 0; color: var(--text-dim); font-size: 12px; line-height: 1.6; max-width: 760px; }

@media (max-width: 860px) {
  .lp { padding: 18px 16px; }
  .lp-body { grid-template-columns: 1fr; gap: 18px; }
  .lp-list { flex-direction: row; overflow-x: auto; padding-bottom: 4px; }
  .lp-item { flex: none; background: var(--lp-fill); }
  .lp-item-val { display: none; }
  .row { grid-template-columns: 1fr auto; }
  .row .strip { grid-column: 1 / -1; order: 3; }
  .facts { order: 4; }
}
@media (prefers-reduced-motion: reduce) {
  .lp *, .lp *::before { transition: none !important; }
}
</style>

<style>
/* Etiqueta de lote: la renderiza un componente funcional, por eso va sin scoped. */
.lp .lp-chip {
  appearance: none;
  border: 0;
  display: inline-block;
  min-width: 30px;
  text-align: center;
  font: inherit;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  padding: 4px 7px;
  border-radius: 7px;
  cursor: pointer;
  transition: opacity 0.15s;
}
.lp .lp-chip.active { box-shadow: 0 0 0 2px currentColor !important; }
.lp .lp-chip.faded { opacity: 0.3; }
.lp .lp-chip:focus-visible { outline: 2px solid #0a84ff; outline-offset: 2px; }
</style>
