<script setup>
import { ref } from 'vue'
import StockItem from './StockItem.vue'

const props = defineProps({
  title: { type: String, required: true },
  stocks: { type: Array, required: true },
  placeholder: { type: String, default: 'Ej: AAPL, TSLA' },
  isCedear: { type: Boolean, default: false },
})

const emit = defineEmits([
  'add',
  'remove',
  'update-ratio',
  'reorder'
])

const inputValue = ref('')

const draggedIndex = ref(null)
const dragOverIndex = ref(null)

function handleAdd() {
  if (!inputValue.value.trim()) return

  emit('add', inputValue.value)
  inputValue.value = ''
}

/* ============================
   DRAG & DROP
============================ */

function handleDragStart(event, index) {
  draggedIndex.value = index

  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', index.toString())
}

function handleDragOver(event, index) {
  event.preventDefault()

  if (draggedIndex.value === null) return
  if (draggedIndex.value === index) return

  dragOverIndex.value = index
}

function handleDrop(event, index) {
  event.preventDefault()

  if (draggedIndex.value === null) return

  const fromIndex = draggedIndex.value

  if (fromIndex === index) {
    resetDrag()
    return
  }

  const newStocks = [...props.stocks]

  const movedStock = newStocks.splice(fromIndex, 1)[0]

  /*
   * Calculamos correctamente la posición
   * después de sacar el elemento original.
   */
  let newIndex = index

  if (fromIndex < index) {
    newIndex = index - 1
  }

  newStocks.splice(newIndex, 0, movedStock)

  emit('reorder', newStocks)

  resetDrag()
}

function handleDragEnd() {
  resetDrag()
}

function resetDrag() {
  draggedIndex.value = null
  dragOverIndex.value = null
}
</script>

<template>
  <div class="side-panel">

    <div class="panel-title">
      {{ title }}
    </div>

    <div class="ticker-input-box">
      <input
        v-model="inputValue"
        type="text"
        :placeholder="placeholder"
        @keypress.enter="handleAdd"
      >

      <button @click="handleAdd">
        Ver
      </button>
    </div>

    <div class="stock-list">

      <div
        v-for="(stock, index) in stocks"
        :key="stock.symbol"
        class="stock-item-wrapper"
        :class="{
          dragging: draggedIndex === index,
          'drag-over': dragOverIndex === index
        }"
        draggable="true"
        @dragstart="handleDragStart($event, index)"
        @dragover="handleDragOver($event, index)"
        @drop="handleDrop($event, index)"
        @dragend="handleDragEnd"
      >

        <StockItem
          :stock="stock"
          :is-cedear="isCedear"
          @remove="s => emit('remove', s)"
          @update-ratio="(s, r) => emit('update-ratio', s, r)"
        />

      </div>

      <div
        v-if="!stocks.length"
        class="empty"
      >
        Sin resultados todavía.
      </div>

    </div>
  </div>
</template>

<style scoped>
.side-panel{
  background:var(--panel);
  border:1px solid var(--border);
  border-radius:12px;
  padding:16px;
  display:flex;
  flex-direction:column;
  gap:14px;
}

.panel-title{
  font-size:12px;
  font-weight:600;
  text-transform:uppercase;
  color:var(--text-dim);
  letter-spacing:0.5px;
  border-bottom:1px solid var(--border);
  padding-bottom:8px;
}

.ticker-input-box{
  display:flex;
  gap:6px;
}

.ticker-input-box input{
  flex:1;
  background:var(--bg);
  border:1px solid var(--border);
  border-radius:6px;
  padding:6px 10px;
  color:var(--text);
  font-family:var(--font-num);
  font-size:12px;
  text-transform:uppercase;
  outline:none;
}

.ticker-input-box input:focus{
  border-color:var(--blue);
}

.ticker-input-box button{
  background:var(--bg);
  border:1px solid var(--border);
  border-radius:6px;
  padding:6px 10px;
  color:var(--text-dim);
  cursor:pointer;
  font-weight:600;
}

.ticker-input-box button:hover{
  color:var(--text);
  border-color:var(--text-dim);
}

/* ============================
   LISTA
============================ */

.stock-list{
  display:flex;
  flex-direction:column;
  gap:8px;
  max-height:380px;
  overflow-y:auto;
}

/* ============================
   ELEMENTOS ARRASTRABLES
============================ */

.stock-item-wrapper{
  position:relative;
  cursor:grab;
  transition:opacity 0.15s ease;
}

/*
 * Mientras se está arrastrando:
 * nada de sombras ni transformaciones.
 */
.stock-item-wrapper.dragging{
  opacity:0.45;
  cursor:grabbing;
}

/*
 * Línea que indica dónde se va a colocar.
 */
.stock-item-wrapper.drag-over::before{
  content:'';

  position:absolute;

  top:-5px;
  left:0;
  right:0;

  height:2px;

  background:var(--blue);

  border-radius:2px;

  z-index:20;
  pointer-events:none;
}

/*
 * Pequeño indicador lateral.
 */
.stock-item-wrapper.drag-over::after{
  content:'';

  position:absolute;

  top:-7px;
  left:0;

  width:6px;
  height:6px;

  background:var(--blue);

  border-radius:50%;

  z-index:21;
  pointer-events:none;
}

/* ============================
   CURSOR
============================ */

.stock-item-wrapper:hover{
  cursor:grab;
}

.stock-item-wrapper:active{
  cursor:grabbing;
}

/* ============================
   VACÍO
============================ */

.empty{
  font-size:11px;
  color:var(--text-dim);
  text-align:center;
  padding:10px 0;
}

/* ============================
   SCROLLBAR
============================ */

.stock-list::-webkit-scrollbar{
  width:5px;
}

.stock-list::-webkit-scrollbar-track{
  background:transparent;
}

.stock-list::-webkit-scrollbar-thumb{
  background:var(--border);
  border-radius:10px;
}

.stock-list::-webkit-scrollbar-thumb:hover{
  background:var(--text-dim);
}
</style>