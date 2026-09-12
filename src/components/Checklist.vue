<script setup>
import { ref, reactive, onMounted, computed } from 'vue'
import {
  getChecklist,
  createChecklistTicker,
  updateChecklistTicker,
  deleteChecklistTicker,
  addChecklistIndicator,
  updateChecklistIndicator,
  deleteChecklistIndicator,
} from '../services/checklistService'

// Esto es solo una preferencia de UI (panel abierto/cerrado), no datos de
// negocio, así que se queda en localStorage sin problema.
const STORAGE_MINIMIZED = 'tv_checklist_minimized_v1'

const UMBRAL_COMPRAR = 75
const UMBRAL_ESPERAR = 50

const SECTOR_CHECKLISTS = {
  'Tecnológico': [
    { text: 'Tendencia alcista de largo plazo (precio sobre la EMA de 200)', weight: 3 },
    { text: 'Volumen y RVOL por encima de la media, con foco en earnings/guidance', weight: 4 },
    { text: 'Crecimiento de ingresos y margenes sostenido (ultimos trimestres)', weight: 4 },
    { text: 'Golden Cross(ultimo trimestre)', weight: 4 }
  ],
  'Semiconductores': [
    { text: 'Tendencia alcista de largo plazo (precio sobre la EMA de 200)', weight: 3 },
    { text: 'Volumen y RVOL por encima de la media, con foco en earnings/guidance', weight: 4 },
    { text: 'Ciclo de inventarios en fase de recuperación (book-to-bill, channel checks favorables)', weight: 4 }
  ],
  'Energético': [
    { text: 'Tendencia alcista de largo plazo (precio sobre la EMA de 200)', weight: 2 },
    { text: 'Volumen y RVOL por encima de la media operativa', weight: 3 },
    { text: 'Contexto geopolitico / OPEP / inventarios EIA favorable', weight: 4 }
  ],
  'Financiero': [
    { text: 'Tendencia alcista de largo plazo (precio sobre la EMA de 200)', weight: 3 },
    { text: 'Volumen y RVOL por encima de la media operativa', weight: 3 },
    { text: 'Calidad de balance (morosidad, capitalizacion, ROE) saludable', weight: 4 }
  ],
  'Salud': [
    { text: 'Tendencia alcista de largo plazo (precio sobre la EMA de 200)', weight: 3 },
    { text: 'Volumen y RVOL por encima de la media operativa', weight: 3 }
  ],
  'Consumo': [
    { text: 'Tendencia alcista de largo plazo (precio sobre la EMA de 200)', weight: 3 },
    { text: 'Volumen y RVOL por encima de la media operativa', weight: 3 }
  ],
  'Industrial': [
    { text: 'Tendencia alcista de largo plazo (precio sobre la EMA de 200)', weight: 3 },
    { text: 'Volumen y RVOL por encima de la media operativa', weight: 3 }
  ],
  'Materiales': [
    { text: 'Tendencia alcista de largo plazo (precio sobre la EMA de 200)', weight: 2 },
    { text: 'Volumen y RVOL por encima de la media operativa', weight: 3 }
  ],
  'Bienes Raíces': [
    { text: 'Tendencia alcista de largo plazo (precio sobre la EMA de 200)', weight: 3 },
    { text: 'Volumen y RVOL por encima de la media operativa', weight: 3 }
  ],
  'General': [
    { text: 'Tendencia alcista de largo plazo (precio sobre la EMA de 200)', weight: 3 },
    { text: 'Volumen y relativo de volumen (RVOL) por encima de la media operativa', weight: 4 }
  ],
  'Comunicacion': [
    { text: 'Tendencia alcista de largo plazo (precio sobre la EMA de 200)', weight: 3 },
    { text: 'Volumen y relativo de volumen (RVOL) por encima de la media operativa', weight: 4 }
  ]
}

const sectorNames = Object.keys(SECTOR_CHECKLISTS)
const SECTOR_DEFAULT = 'General'

// tickers: { [symbol]: { remoteId, sector, expanded, indicators: [{id,text,weight,checked}] } }
const tickers = reactive({})
const isMinimized = ref(localStorage.getItem(STORAGE_MINIMIZED) === 'true')
// syncStatus refleja el estado de la conexión con el backend (Express + SQLite)
const syncStatus = ref('pending')

const newTickerInput = ref('')
const newTickerSector = ref(SECTOR_DEFAULT)

const newIndicatorTexts = reactive({})
const newIndicatorWeights = reactive({})

const syncTitles = {
  pending: 'Cargando checklist desde el servidor...',
  ok: 'Sincronizado con el backend (SQLite)',
  error: 'No se pudo conectar con el backend; los cambios no se están guardando',
}

// Trae la checklist guardada en el backend al arrancar
async function loadFromBackend() {
  syncStatus.value = 'pending'
  try {
    const remote = await getChecklist()
    Object.keys(tickers).forEach(sym => delete tickers[sym])
    remote.forEach(t => {
      tickers[t.symbol] = {
        remoteId: t.id,
        sector: SECTOR_CHECKLISTS[t.sector] ? t.sector : SECTOR_DEFAULT,
        expanded: t.expanded,
        indicators: t.indicators,
      }
    })
    syncStatus.value = 'ok'
  } catch (e) {
    console.error('No se pudo cargar la checklist', e)
    syncStatus.value = 'error'
  }
}

function getSectorActual(data) {
  return data.sector && SECTOR_CHECKLISTS[data.sector] ? data.sector : SECTOR_DEFAULT
}

function getVeredicto(porcentaje) {
  if (porcentaje >= UMBRAL_COMPRAR) return { clase: 'veredicto-comprar', texto: '✅ Comprar' }
  if (porcentaje >= UMBRAL_ESPERAR) return { clase: 'veredicto-esperar', texto: '⏳ Esperar' }
  return { clase: 'veredicto-no-comprar', texto: '❌ No comprar' }
}

function calcularPorcentaje(sym) {
  const ind = (tickers[sym] && tickers[sym].indicators) || []
  if (!ind.length) return 0
  const pesoTotal = ind.reduce((acc, i) => acc + (Number(i.weight) || 0), 0)
  if (pesoTotal <= 0) return 0
  const pesoCumplido = ind.reduce((acc, i) => acc + (i.checked ? (Number(i.weight) || 0) : 0), 0)
  return Math.round((pesoCumplido / pesoTotal) * 100)
}

function toggleExpand(sym) {
  tickers[sym].expanded = !tickers[sym].expanded
  updateChecklistTicker(tickers[sym].remoteId, { expanded: tickers[sym].expanded })
    .catch(e => console.error('Error guardando expanded', e))
}

function toggleMinimize() {
  isMinimized.value = !isMinimized.value
  localStorage.setItem(STORAGE_MINIMIZED, isMinimized.value.toString())
}

async function deleteTicker(sym) {
  const remoteId = tickers[sym].remoteId
  delete tickers[sym]
  try {
    await deleteChecklistTicker(remoteId)
  } catch (e) {
    console.error('Error eliminando el ticker en el backend', e)
  }
}

async function changeSector(sym, event) {
  const nuevoSector = event.target.value
  if (!SECTOR_CHECKLISTS[nuevoSector]) return
  const confirmar = window.confirm(
    `Vas a cambiar ${sym} al sector "${nuevoSector}".\n` +
    `Esto REEMPLAZA la checklist actual por la checklist por defecto de ese sector. ¿Continuar?`
  )
  if (!confirmar) {
    event.target.value = tickers[sym].sector
    return
  }
  const nuevosIndicadores = SECTOR_CHECKLISTS[nuevoSector].map(d => ({ text: d.text, weight: d.weight }))
  tickers[sym].sector = nuevoSector
  try {
    const updated = await updateChecklistTicker(tickers[sym].remoteId, {
      sector: nuevoSector,
      indicators: nuevosIndicadores,
    })
    tickers[sym].indicators = updated.indicators
  } catch (e) {
    console.error('Error cambiando el sector en el backend', e)
  }
}

async function deleteIndicator(sym, id) {
  tickers[sym].indicators = tickers[sym].indicators.filter(i => i.id !== id)
  try {
    await deleteChecklistIndicator(id)
  } catch (e) {
    console.error('Error eliminando el indicador en el backend', e)
  }
}

async function addIndicator(sym) {
  const texto = (newIndicatorTexts[sym] || '').trim()
  if (!texto) return
  const peso = newIndicatorWeights[sym] || 3
  newIndicatorTexts[sym] = ''
  try {
    const created = await addChecklistIndicator(tickers[sym].remoteId, { text: texto, weight: peso })
    tickers[sym].indicators.push(created)
  } catch (e) {
    console.error('Error agregando el indicador en el backend', e)
  }
}

async function agregarTicker() {
  const sym = newTickerInput.value.trim().toUpperCase()
  const sector = SECTOR_CHECKLISTS[newTickerSector.value] ? newTickerSector.value : SECTOR_DEFAULT
  if (!sym || tickers[sym]) {
    newTickerInput.value = ''
    return
  }
  newTickerInput.value = ''

  const indicatorsPayload = SECTOR_CHECKLISTS[sector].map(d => ({ text: d.text, weight: d.weight }))
  try {
    const created = await createChecklistTicker({ symbol: sym, sector, indicators: indicatorsPayload })
    tickers[sym] = {
      remoteId: created.id,
      sector: created.sector,
      expanded: true,
      indicators: created.indicators,
    }
  } catch (e) {
    console.error('Error creando el ticker en el backend', e)
  }
}

// El checkbox y el select de peso persisten el cambio del indicador
// puntual apenas cambian (v-model ya actualizó ind.checked / ind.weight).
function persistIndicator(ind) {
  updateChecklistIndicator(ind.id, { checked: ind.checked, weight: ind.weight })
    .catch(e => console.error('Error guardando el indicador', e))
}

onMounted(() => {
  loadFromBackend()
})
</script>

<template>
  <div class="card alerts-panel" :class="{ 'panel-collapsed-checklist': isMinimized }">
    <div class="alerts-header" @click="toggleMinimize" style="cursor: pointer;">
      <span class="title">
        📋 Checklist de Compra 
        <span class="chk-sync-dot" :class="`chk-sync-${syncStatus}`" :title="syncTitles[syncStatus]"></span>
      </span>
    </div>

    <div id="tv-checklist-body">
      <div v-if="!Object.keys(tickers).length" class="chk-empty-msg">
        Agregá un ticker abajo para empezar a evaluarlo.
      </div>

      <div 
        v-for="(data, sym) in tickers" 
        :key="sym" 
        class="chk-card" 
        :class="getVeredicto(calcularPorcentaje(sym)).clase"
        :data-ticker="sym"
      >
        <div class="chk-card-header" @click="toggleExpand(sym)">
          <span class="chk-toggle-icon">{{ data.expanded ? '▼' : '▶' }}</span>
          <span class="chk-ticker">{{ sym }}</span>
          <span class="chk-sector-badge">{{ getSectorActual(data) }}</span>
          <span class="chk-percent-badge" :class="getVeredicto(calcularPorcentaje(sym)).clase">
            {{ calcularPorcentaje(sym) }}%
          </span>
          <button class="chk-btn-delete-ticker" @click.stop="deleteTicker(sym)" title="Quitar ticker">✖</button>
        </div>

        <div class="chk-progress-track">
          <div 
            class="chk-progress-fill" 
            :class="getVeredicto(calcularPorcentaje(sym)).clase" 
            :style="{ width: calcularPorcentaje(sym) + '%' }"
          ></div>
        </div>

        <div class="chk-card-body" :class="{ collapsed: !data.expanded }">
          <div class="chk-sector-row">
            Sector:
            <select 
              class="chk-sector-select-inline" 
              :value="getSectorActual(data)" 
              @change="changeSector(sym, $event)"
              title="Cambiar sector (reemplaza la checklist actual por la del sector nuevo)"
            >
              <option v-for="s in sectorNames" :key="s" :value="s">{{ s }}</option>
            </select>
          </div>
          <div class="chk-hint">El peso (x1 a x5) define cuánto pesa cada indicador en el % final.</div>
          
          <div class="chk-items">
            <div v-if="!data.indicators.length" class="chk-empty-msg">
              Este ticker todavía no tiene indicadores. Agregá el primero abajo.
            </div>
            <div v-for="ind in data.indicators" :key="ind.id" class="chk-item-row">
              <input type="checkbox" v-model="ind.checked" @change="persistIndicator(ind)">
              <span class="chk-item-text" @click="ind.checked = !ind.checked; persistIndicator(ind)">{{ ind.text }}</span>
              <select class="chk-item-weight" v-model.number="ind.weight" @change="persistIndicator(ind)" title="Peso de este indicador">
                <option v-for="n in [1,2,3,4,5]" :key="n" :value="n">x{{ n }}</option>
              </select>
              <button class="chk-btn-delete-indicator" @click="deleteIndicator(sym, ind.id)" title="Borrar indicador">✖</button>
            </div>
          </div>

          <div class="chk-add-indicator-row">
            <input 
              type="text" 
              v-model="newIndicatorTexts[sym]" 
              @keydown.enter="addIndicator(sym)" 
              :placeholder="`Nuevo indicador para ${sym}...`"
            >
            <select class="chk-new-weight" v-model.number="newIndicatorWeights[sym]">
              <option v-for="n in [1,2,3,4,5]" :key="n" :value="n">x{{ n }}</option>
            </select>
            <button class="chk-add-indicator-btn" @click="addIndicator(sym)">+</button>
          </div>

          <div class="chk-verdict" :class="getVeredicto(calcularPorcentaje(sym)).clase">
            {{ getVeredicto(calcularPorcentaje(sym)).texto }} ({{ calcularPorcentaje(sym) }}%)
          </div>
        </div>
      </div>
    </div>

    <div class="panel-footer-checklist">
      <input 
        type="text" 
        id="chk-new-ticker-input" 
        v-model="newTickerInput" 
        @keydown.enter="agregarTicker" 
        placeholder="GGAL" 
        maxlength="14"
      >
      <select id="chk-new-ticker-sector" v-model="newTickerSector" title="Sector del ticker (define la checklist inicial)">
        <option v-for="s in sectorNames" :key="s" :value="s">{{ s }}</option>
      </select>
      <button id="chk-add-ticker-btn" class="btn-add" @click="agregarTicker">Agregar Ticker</button>
    </div>
  </div>
</template>

<style scoped>






.alerts-panel{ display:flex;flex-direction:column;gap:0; }
.alerts-header{
  display:flex;justify-content:space-between;align-items:center;gap:10px;
  margin-bottom:12px;flex-wrap:wrap;
}
.title{ font-size:12px;font-weight:700;color:var(--blue, #5c8dff);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:4px; }

.chk-sync-dot { width:7px;height:7px;border-radius:50%;flex-shrink:0;background:#5d606b; }
.chk-sync-off { background:#5d606b; }
.chk-sync-pending { background:#ffb300; }
.chk-sync-syncing { background:#5c8dff;animation:chk-pulse 0.9s infinite ease-in-out; }
.chk-sync-ok { background:#00e676; }
.chk-sync-error { background:#ff5252; }

@keyframes chk-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }

#tv-checklist-body { max-height:480px;overflow-y:auto;margin-bottom:10px; }

.chk-empty-msg { font-size:11px;color:#8a8d9b;text-align:center;padding:14px 4px; }

.chk-card {
    border-radius:10px;margin-bottom:8px;background:rgba(30, 34, 45, 0.55);
    border:1px solid rgba(255, 255, 255, 0.08);border-left:3px solid #5d606b;
    transition:border-color 0.3s ease;overflow:hidden;
}
.chk-card.veredicto-comprar { border-left-color:#00e676; }
.chk-card.veredicto-esperar { border-left-color:#ffb300; }
.chk-card.veredicto-no-comprar { border-left-color:#ff5252; }

.chk-card-header { display:flex;align-items:center;gap:6px;padding:8px 9px;cursor:pointer; }
.chk-toggle-icon { font-size:9px;color:#8a8d9b;flex-shrink:0;width:10px; }
.chk-ticker { font-weight:800;font-size:13px;letter-spacing:0.3px;color:#ffffff;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }

.chk-sector-badge { font-size:9px;font-weight:700;color:var(--blue, #5c8dff);background:rgba(92, 141, 255, 0.15);border-radius:10px;padding:2px 7px;flex-shrink:0;white-space:nowrap; }

.chk-percent-badge { font-size:11px;font-weight:800;padding:2px 7px;border-radius:20px;flex-shrink:0; }
.chk-percent-badge.veredicto-comprar { color:#00e676;background:rgba(0, 230, 118, 0.15); }
.chk-percent-badge.veredicto-esperar { color:#ffb300;background:rgba(255, 179, 0, 0.15); }
.chk-percent-badge.veredicto-no-comprar { color:#ff5252;background:rgba(255, 82, 82, 0.15); }

.chk-progress-track { width:100%;height:4px;background:rgba(255, 255, 255, 0.08);overflow:hidden; }
.chk-progress-fill { height:100%;transition:width 0.25s ease, background-color 0.25s ease; }
.chk-progress-fill.veredicto-comprar { background:#00e676; }
.chk-progress-fill.veredicto-esperar { background:#ffb300; }
.chk-progress-fill.veredicto-no-comprar { background:#ff5252; }

.chk-card-body { padding:9px;border-top:1px solid rgba(255, 255, 255, 0.06); }
.chk-card-body.collapsed { display:none; }

.chk-sector-row { display:flex;align-items:center;gap:6px;font-size:10.5px;color:#8a8d9b;margin-bottom:8px; }
.chk-sector-select-inline { background:rgba(30, 34, 45, 0.9);border:1px solid rgba(255, 255, 255, 0.15);border-radius:5px;color:var(--blue, #5c8dff);font-size:10.5px;font-weight:700;padding:2px 4px;outline:none;cursor:pointer; }

.chk-items { margin-bottom:8px; }
.chk-item-row { display:flex;align-items:center;gap:6px;font-size:11px;color:#cfd2dc;padding:3px 0; }
.chk-item-row input[type="checkbox"] { accent-color:#00e676;cursor:pointer;flex-shrink:0; }
.chk-item-text { flex:1;min-width:0;overflow-wrap:break-word;cursor:pointer; }

.chk-item-weight, .chk-new-weight { background:rgba(30, 34, 45, 0.9);border:1px solid rgba(255, 255, 255, 0.15);border-radius:5px;color:#ffb300;font-size:10px;font-weight:700;padding:2px 3px;outline:none;flex-shrink:0;cursor:pointer; }

.chk-btn-delete-indicator, .chk-btn-delete-ticker { background:transparent;color:#ff5252;border:none;cursor:pointer;font-size:11px;padding:2px 4px;border-radius:4px;opacity:0.7;flex-shrink:0; }
.chk-btn-delete-indicator:hover, .chk-btn-delete-ticker:hover { opacity:1;background:rgba(255, 82, 82, 0.15); }

.chk-add-indicator-row { display:flex;gap:5px;margin-bottom:8px; }
.chk-add-indicator-row input[type="text"] { flex:1;min-width:0;background:rgba(30, 34, 45, 0.7);border:1px solid rgba(255, 255, 255, 0.12);border-radius:6px;color:#ffffff;padding:5px 7px;font-size:11px;outline:none; }

.chk-add-indicator-btn { background:rgba(0, 168, 70, 0.85);color:#ffffff;border:none;border-radius:6px;padding:0 9px;font-size:11px;font-weight:700;cursor:pointer;flex-shrink:0; }
.chk-add-indicator-btn:hover { background:rgba(0, 190, 80, 0.95); }

.chk-verdict { font-size:11px;font-weight:800;text-align:center;text-transform:uppercase;padding:5px 4px;border-radius:6px;letter-spacing:0.3px; }
.chk-verdict.veredicto-comprar { color:#00e676;background:rgba(0, 230, 118, 0.12); }
.chk-verdict.veredicto-esperar { color:#ffb300;background:rgba(255, 179, 0, 0.12); }
.chk-verdict.veredicto-no-comprar { color:#ff5252;background:rgba(255, 82, 82, 0.12); }

.chk-hint { font-size:9.5px;color:#6d707c;margin-bottom:7px; }

.panel-footer-checklist { display:flex;flex-wrap:wrap;gap:6px; }

#chk-new-ticker-input { flex:1;min-width:70px;text-transform:uppercase;font-weight:700;background:rgba(30, 34, 45, 0.7);border:1px solid rgba(255, 255, 255, 0.12);border-radius:6px;color:#ffffff;padding:5px 7px;font-size:11px;outline:none;height:26px; }
#chk-new-ticker-sector { flex:1;min-width:100px;background:rgba(30, 34, 45, 0.7);border:1px solid rgba(255, 255, 255, 0.12);border-radius:6px;color:#ffffff;padding:5px 7px;font-size:11px;outline:none;height:26px;cursor:pointer; }

.btn-add {
  width:100%;background:linear-gradient(135deg, rgba(0,217,163,.85), rgba(0,150,110,.85));
  color:#fff;border:none;padding:8px;border-radius:8px;font-size:11px;font-weight:700;
  text-transform:uppercase;cursor:pointer;
}
#chk-add-ticker-btn { flex-shrink:0;height:26px;padding:0 14px;border-radius:6px; }

.panel-collapsed-checklist #tv-checklist-body,
.panel-collapsed-checklist .panel-footer-checklist { display:none !important; }






</style>

