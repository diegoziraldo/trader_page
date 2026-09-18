<script setup>
import { ref } from 'vue'
import StockItem from './StockItem.vue'

const props = defineProps({
  title: { type: String, required: true },
  stocks: { type: Array, required: true },
  placeholder: { type: String, default: 'Ej: AAPL, TSLA' },
  isCedear: { type: Boolean, default: false },
})

const emit = defineEmits(['add', 'remove', 'update-ratio'])

const inputValue = ref('')

function handleAdd() {
  if (!inputValue.value.trim()) return
  emit('add', inputValue.value)
  inputValue.value = ''
}
</script>

<template>
  <div class="side-panel">
    <div class="panel-title">{{ title }}</div>

    <div class="ticker-input-box">
      <input
        v-model="inputValue"
        type="text"
        :placeholder="placeholder"
        @keypress.enter="handleAdd"
      >
      <button @click="handleAdd">Ver</button>
    </div>

    <div class="stock-list">
      <StockItem
        v-for="stock in stocks"
        :key="stock.symbol"
        :stock="stock"
        :is-cedear="isCedear"
        @remove="s => emit('remove', s)"
        @update-ratio="(s, r) => emit('update-ratio', s, r)"
      />
      <div v-if="!stocks.length" class="empty">Sin resultados todavía.</div>
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
.ticker-input-box{display:flex;gap:6px;}
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
.ticker-input-box input:focus{border-color:var(--blue);}
.ticker-input-box button{
  background:var(--bg);
  border:1px solid var(--border);
  border-radius:6px;
  padding:6px 10px;
  color:var(--text-dim);
  cursor:pointer;
  font-weight:600;
}
.ticker-input-box button:hover{color:var(--text);border-color:var(--text-dim);}

.stock-list{
  display:flex;
  flex-direction:column;
  gap:8px;
  max-height:380px;
  overflow-y:auto;
}
.empty{font-size:11px;color:var(--text-dim);text-align:center;padding:10px 0;}

@media (max-width: 480px) {
  .ticker-input-box input,
  .ticker-input-box button{ font-size:16px; padding:8px 10px; }
  .stock-list{ max-height:none; }
}
</style>