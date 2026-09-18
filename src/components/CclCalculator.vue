<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { fetchQuote } from '../services/stockService'

const props = defineProps({
  title: { type: String, default: 'Calculadora CCL CEDEAR' },
})

// =========================================================
// CONFIGURACIÓN
// =========================================================
const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQAyQ6X3RaJtEHAYCwnUQ4yxvVao9qudjalrbJEH3T9Yqy1DxBcluc04xWa0KsKSw/pub?gid=235667307&single=true&output=csv'
const RAVA_URL = 'https://www.rava.com/perfil/DOLAR%20CCL'
const RAVA_INTERVAL = 5000
// data912.com es una API pública y gratuita de datos de mercado argentino.
// /live/arg_cedears trae, para cada especie que cotiza en BYMA, su último
// precio en pesos (campo "c"). El símbolo coincide con el ticker de EE.UU.
// (ej: "AAPL"), así que con eso alcanza para traer el precio del CEDEAR
// automáticamente, sin que el usuario lo tenga que tipear.
const CEDEARS_LIVE_URL = 'https://data912.com/live/arg_cedears'
const CEDEARS_INTERVAL = 20_000
// Mismo intervalo de refresco que usa el panel de "Acciones USA" de la
// izquierda (composables/useStocks.js), para pedir el precio con la misma
// frecuencia y no duplicar de más las llamadas a Finnhub.
const USA_PRICE_INTERVAL = 20_000
// Cuánto esperar sin tipear antes de pedir los datos del ticker nuevo.
const PRICE_DEBOUNCE = 600

// =========================================================
// ESTADOS REACTIVOS
// =========================================================
const statusText = ref('Cargando...')
const statusClass = ref('ccl-wait')

const ticker = ref('AAPL')
const cedearPrice = ref('')
const ratioActual = ref(NaN)
const precioUSAActual = ref(NaN)
const cclRavaActual = ref(NaN)

const message = ref('')
const resultText = ref('—')
const ravaText = ref('ESPERANDO')
const ravaClass = ref('ccl-wait')
const differenceText = ref('—')
const differenceColor = ref('var(--text)')
// true mientras el precio del CEDEAR haya sido completado automáticamente
// (data912) y el usuario no lo haya tocado a mano.
const cedearPriceIsAuto = ref(false)

let datosRatios = []
let datosCedearsLive = []
let intervaloRava = null
let intervaloPrecioUSA = null
let intervaloCedears = null
let debouncePrecio = null
let cargandoRava = false

// =========================================================
// COMPUTED PROPS (Estilos dinámicos)
// =========================================================
const ratioText = computed(() => {
  if (isNaN(ratioActual.value)) return '—'
  return Number(ratioActual.value).toLocaleString('en-US', { maximumFractionDigits: 8 })
})

const ratioClass = computed(() => (isNaN(ratioActual.value) ? 'ccl-error' : 'ccl-ok'))

const usaPriceText = computed(() => {
  if (isNaN(precioUSAActual.value) || precioUSAActual.value <= 0) return 'ESPERANDO'
  return '$' + formatearNumero(precioUSAActual.value)
})

const usaPriceClass = computed(() => (isNaN(precioUSAActual.value) || precioUSAActual.value <= 0 ? 'ccl-wait' : 'ccl-ok'))

// =========================================================
// FUNCIONES AUXILIARES
// =========================================================
function normalizar(valor) {
  return String(valor || '').trim().toUpperCase()
}

function formatearNumero(numero) {
  return Number(numero).toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  })
}

function parseCSV(text) {
  const rows = []
  let row = []
  let value = ''
  let quotes = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === '"') {
      if (quotes && text[i + 1] === '"') {
        value += '"'
        i++
        continue
      }
      quotes = !quotes
      continue
    }
    if (char === ',' && !quotes) {
      row.push(value)
      value = ''
      continue
    }
    if ((char === '\n' || char === '\r') && !quotes) {
      if (char === '\r' && text[i + 1] === '\n') i++
      row.push(value)
      value = ''
      if (row.some(x => x.trim() !== '')) rows.push(row)
      row = []
      continue
    }
    value += char
  }
  if (value.length || row.length) {
    row.push(value)
    if (row.some(x => x.trim() !== '')) rows.push(row)
  }
  return rows
}

function convertirRatio(valor) {
  let texto = String(valor || '').trim().replace(/\s/g, '').replace(',', '.')
  if (texto.includes(':')) {
    const partes = texto.split(':')
    const a = parseFloat(partes[0])
    const b = parseFloat(partes[1])
    if (!isNaN(a) && !isNaN(b) && b !== 0) return a / b
  }
  return parseFloat(texto)
}

function parsearPrecio(valor) {
  let texto = String(valor || '').trim()
  if (!texto) return NaN
  texto = texto.replace(/\$/g, '')
  if (texto.includes('.') && texto.includes(',')) {
    if (texto.lastIndexOf('.') < texto.lastIndexOf(',')) {
      texto = texto.replace(/\./g, '').replace(',', '.')
    } else {
      texto = texto.replace(/,/g, '')
    }
  } else if (texto.includes('.')) {
    texto = texto.replace(/\./g, '')
  } else if (texto.includes(',')) {
    texto = texto.replace(',', '.')
  }
  return parseFloat(texto)
}

// =========================================================
// CARGA DE RATIOS (CSV)
// =========================================================
async function cargarRatios() {
  statusText.value = 'Conectando...'
  statusClass.value = 'ccl-wait'

  try {
    const response = await fetch(CSV_URL)
    if (!response.ok) throw new Error('Error Google Sheets HTTP ' + response.status)

    const text = await response.text()
    const rows = parseCSV(text)
    if (!rows.length) throw new Error('CSV vacío')

    const headers = rows[0].map(h => normalizar(h))
    const tickerIndex = headers.findIndex(h => h.includes('TICKER'))
    const ratioNumIndex = headers.findIndex(h => h.includes('RATIO NUMÉRICO'))
    const ratioTextIndex = headers.findIndex(h => h.includes('RATIO CEDEAR'))

    if (tickerIndex === -1) throw new Error('No se encontró Ticker')

    datosRatios = []
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]
      const tck = normalizar(row[tickerIndex])
      if (!tck) continue

      let ratio = NaN
      if (ratioNumIndex !== -1) ratio = convertirRatio(row[ratioNumIndex])
      if (isNaN(ratio) && ratioTextIndex !== -1) ratio = convertirRatio(row[ratioTextIndex])

      datosRatios.push({ ticker: tck, ratio })
    }

    statusText.value = 'CONECTADO'
    statusClass.value = 'ccl-ok'
    buscarRatio()
    iniciarRava()
  } catch (error) {
    statusText.value = 'ERROR'
    statusClass.value = 'ccl-error'
    message.value = error.message
  }
}

function buscarRatio() {
  const tck = normalizar(ticker.value)
  const encontrado = datosRatios.find(item => item.ticker === tck)

  if (!encontrado) {
    ratioActual.value = NaN
    return null
  }

  ratioActual.value = Number(encontrado.ratio)
  return ratioActual.value
}

function onTickerInput() {
  buscarRatio()
  // Espera a que dejes de tipear para no pedirle a las APIs en cada letra.
  if (debouncePrecio) clearTimeout(debouncePrecio)
  debouncePrecio = setTimeout(() => {
    actualizarPrecioUSA()
    buscarPrecioCedear()
  }, PRICE_DEBOUNCE)
}

// Si el usuario edita el precio del CEDEAR a mano, dejamos de pisarlo con
// el valor automático hasta que cambie de ticker de nuevo.
function onCedearPriceInput() {
  cedearPriceIsAuto.value = false
  calcularCCLSiPosible()
}

// =========================================================
// PRECIO USA (Finnhub) — mismo pedido que usa el panel de
// "Acciones USA" de la izquierda (services/stockService.js -> fetchQuote)
// =========================================================
async function actualizarPrecioUSA() {
  const tck = normalizar(ticker.value)
  if (!tck) {
    precioUSAActual.value = NaN
    return
  }
  try {
    const q = await fetchQuote(tck)
    precioUSAActual.value = q.price
    calcularCCLSiPosible()
  } catch (e) {
    precioUSAActual.value = NaN
    message.value = e.message
  }
}

function iniciarPrecioUSA() {
  if (intervaloPrecioUSA) clearInterval(intervaloPrecioUSA)
  actualizarPrecioUSA()
  intervaloPrecioUSA = setInterval(actualizarPrecioUSA, USA_PRICE_INTERVAL)
}

// =========================================================
// PRECIO CEDEAR EN PESOS (data912.com, en vivo, sin API key)
// =========================================================
async function cargarCedearsLive() {
  try {
    const res = await fetch(CEDEARS_LIVE_URL)
    if (!res.ok) throw new Error('Error consultando data912')
    datosCedearsLive = await res.json()
    buscarPrecioCedear()
  } catch (e) {
    console.error('No se pudo cargar el precio de CEDEARs (data912)', e)
  }
}

function buscarPrecioCedear() {
  const tck = normalizar(ticker.value)
  const encontrado = datosCedearsLive.find(item => normalizar(item.symbol) === tck)

  if (!encontrado || !encontrado.c) {
    cedearPriceIsAuto.value = false
    return
  }

  cedearPrice.value = String(encontrado.c)
  cedearPriceIsAuto.value = true
  calcularCCLSiPosible()
}

function iniciarPrecioCedear() {
  if (intervaloCedears) clearInterval(intervaloCedears)
  cargarCedearsLive()
  intervaloCedears = setInterval(cargarCedearsLive, CEDEARS_INTERVAL)
}

// =========================================================
// CÁLCULOS
// =========================================================
function calcularCCL() {
  const ratio = buscarRatio()
  if (isNaN(ratio) || ratio <= 0) {
    resultText.value = '—'
    message.value = 'No hay ratio válido'
    return
  }

  const precioCedear = parsearPrecio(cedearPrice.value)
  if (isNaN(precioCedear) || precioCedear <= 0) {
    resultText.value = '—'
    message.value = 'Ingresá el precio del CEDEAR'
    return
  }

  if (isNaN(precioUSAActual.value) || precioUSAActual.value <= 0) {
    resultText.value = '—'
    message.value = 'Esperando precio de la Watchlist'
    return
  }

  const ccl = (precioCedear * ratio) / precioUSAActual.value
  resultText.value = '$' + formatearNumero(ccl)
  message.value = 'CCL actualizado'
  calcularDiferencia()
}

function calcularCCLSiPosible() {
  const precioCedear = parsearPrecio(cedearPrice.value)
  const ratio = ratioActual.value

  if (isNaN(precioCedear) || precioCedear <= 0 || isNaN(ratio) || ratio <= 0 || isNaN(precioUSAActual.value) || precioUSAActual.value <= 0) {
    return
  }

  const ccl = (precioCedear * ratio) / precioUSAActual.value
  resultText.value = '$' + formatearNumero(ccl)
  message.value = 'CCL actualizado'
  calcularDiferencia()
}

function calcularDiferencia() {
  if (isNaN(cclRavaActual.value) || cclRavaActual.value <= 0) {
    differenceText.value = '—'
    return
  }

  const cclImplicito = parsearPrecio(resultText.value)
  if (isNaN(cclImplicito) || cclImplicito <= 0) {
    differenceText.value = '—'
    return
  }

  const diferencia = (cclImplicito / cclRavaActual.value - 1) * 100
  const signo = diferencia >= 0 ? '+' : ''
  differenceText.value = signo + diferencia.toFixed(2) + '%'

  if (diferencia > 0) differenceColor.value = '#ef4444'
  else if (diferencia < 0) differenceColor.value = '#22c55e'
  else differenceColor.value = 'var(--text)'
}

// =========================================================
// RAVA
// =========================================================
async function actualizarRava() {
  if (cargandoRava) return
  cargandoRava = true

  try {
    const response = await fetch(RAVA_URL + '?_=' + Date.now())
    if (!response.ok) throw new Error('Rava HTTP ' + response.status)

    const html = await response.text()
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')

    const textoCompleto = String(doc.body.innerText || '').replace(/\s+/g, ' ')
    const posicion = textoCompleto.indexOf('DOLAR CCL')

    if (posicion !== -1) {
      const fragmento = textoCompleto.substring(posicion, posicion + 500)
      const valores = fragmento.match(/\d{1,3}(?:\.\d{3})*,\d{2}/g)

      if (valores && valores.length) {
        for (const valor of valores) {
          const numero = parseFloat(valor.replace(/\./g, '').replace(',', '.'))
          if (numero > 100) {
            cclRavaActual.value = numero
            ravaText.value = '$' + formatearNumero(numero)
            ravaClass.value = 'ccl-ok'
            calcularDiferencia()
            break
          }
        }
      }
    }
  } catch (error) {
    ravaText.value = 'ERROR'
    ravaClass.value = 'ccl-error'
  } finally {
    cargandoRava = false
  }
}

function iniciarRava() {
  if (intervaloRava) clearInterval(intervaloRava)
  actualizarRava()
  intervaloRava = setInterval(actualizarRava, RAVA_INTERVAL)
}

// =========================================================
// LIFECYCLE
// =========================================================
onMounted(() => {
  cargarRatios()
  iniciarPrecioUSA()
  iniciarPrecioCedear()
})

onUnmounted(() => {
  if (intervaloRava) clearInterval(intervaloRava)
  if (intervaloPrecioUSA) clearInterval(intervaloPrecioUSA)
  if (intervaloCedears) clearInterval(intervaloCedears)
  if (debouncePrecio) clearTimeout(debouncePrecio)
})
</script>

<template>
  <div class="side-panel">
    <div class="panel-title">{{ title }}</div>

    <div class="ccl-status-box">
      Estado: <span :class="statusClass">{{ statusText }}</span>
    </div>

    <div class="input-group">
      <label>Ticker USA</label>
      <div class="ticker-input-box">
        <input
          v-model="ticker"
          type="text"
          @input="onTickerInput"
          placeholder="Ej: AAPL"
          autocomplete="off"
          spellcheck="false"
        >
      </div>
    </div>

    <div class="input-group">
      <label>
        Precio CEDEAR en pesos
        <span v-if="cedearPriceIsAuto" class="auto-tag">(automático)</span>
      </label>
      <div class="ticker-input-box">
        <input
          v-model="cedearPrice"
          type="text"
          inputmode="decimal"
          @input="onCedearPriceInput"
          @keypress.enter="calcularCCL"
          placeholder="Ej: 24060"
          autocomplete="off"
        >
        <button @click="calcularCCL">Calcular</button>
      </div>
    </div>

    <div class="data-rows-container">
      <div class="ccl-data-row">
        <span>Ratio CEDEAR</span>
        <strong :class="ratioClass">{{ ratioText }}</strong>
      </div>

      <div class="ccl-data-row">
        <span>Precio acción USA</span>
        <strong :class="usaPriceClass">{{ usaPriceText }}</strong>
      </div>

      <div class="ccl-data-row">
        <span>Fuente precio USA</span>
        <strong class="ccl-ok">FINNHUB</strong>
      </div>

      <div class="ccl-data-row">
        <span>Fuente precio CEDEAR</span>
        <strong :class="cedearPriceIsAuto ? 'ccl-ok' : 'ccl-wait'">
          {{ cedearPriceIsAuto ? 'DATA912' : 'MANUAL' }}
        </strong>
      </div>
    </div>

    <div class="ccl-result-box">
      <div class="ccl-result-title">CCL IMPLÍCITO</div>
      <div class="ccl-result-value">{{ resultText }}</div>
    </div>

    <div class="ccl-result-box">
      <div class="ccl-result-title">CCL REFERENCIA RAVA</div>
      <div class="ccl-rava-value" :class="ravaClass">{{ ravaText }}</div>
    </div>

    <div class="ccl-data-row">
      <span>Diferencia</span>
      <strong :style="{ color: differenceColor }">{{ differenceText }}</strong>
    </div>

    <div v-if="message" class="ccl-message">{{ message }}</div>
  </div>
</template>

<style scoped>
.side-panel {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.panel-title {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--text-dim);
  letter-spacing: 0.5px;
  border-bottom: 1px solid var(--border);
  padding-bottom: 8px;
}

.ccl-status-box {
  background: var(--bg);
  border: 1px solid var(--border);
  padding: 8px 10px;
  border-radius: 6px;
  color: var(--text-dim);
  font-size: 12px;
}

.input-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.input-group label {
  font-size: 11px;
  color: var(--text-dim);
  font-weight: 500;
}

.auto-tag {
  color: #22c55e;
  font-weight: 600;
  text-transform: none;
}

.ticker-input-box {
  display: flex;
  gap: 6px;
}

.ticker-input-box input {
  flex: 1;
  min-width: 0;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 10px;
  color: var(--text);
  font-family: var(--font-num, inherit);
  font-size: 12px;
  text-transform: uppercase;
  outline: none;
}

.ticker-input-box input:focus {
  border-color: var(--blue, #2563eb);
}

.ticker-input-box button {
  flex-shrink: 0;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 10px;
  color: var(--text-dim);
  cursor: pointer;
  font-weight: 600;
  font-size: 12px;
  white-space: nowrap;
}

.ticker-input-box button:hover {
  color: var(--text);
  border-color: var(--text-dim);
}

.data-rows-container {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ccl-data-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-dim);
  font-size: 12px;
}

.ccl-data-row strong {
  color: var(--text);
  font-size: 12px;
  font-family: var(--font-num, inherit);
}

.ccl-result-box {
  padding: 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  text-align: center;
}

.ccl-result-title {
  color: var(--text-dim);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.5px;
  margin-bottom: 4px;
}

.ccl-result-value {
  font-size: 20px;
  font-weight: bold;
  color: #22c55e;
  font-family: var(--font-num, inherit);
}

.ccl-rava-value {
  font-size: 15px;
  font-weight: bold;
  font-family: var(--font-num, inherit);
}

.ccl-message {
  text-align: center;
  font-size: 11px;
  color: var(--text-dim);
}

.ccl-error {
  color: #ef4444 !important;
}

.ccl-ok {
  color: #22c55e !important;
}

.ccl-wait {
  color: #fbbf24 !important;
}

@media (max-width: 480px) {
  /* 16px evita que iOS haga zoom automático al enfocar estos inputs */
  .ticker-input-box input {
    font-size: 16px;
  }
}
</style>