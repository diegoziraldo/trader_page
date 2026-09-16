<script setup>
const props = defineProps({
  stock: { type: Object, required: true },
  isCedear: { type: Boolean, default: false },
})

const emit = defineEmits(['remove', 'update-ratio'])

function fmtPrice(stock) {
  if (stock.loading) return '···'
  if (stock.error) return 'N/D'
  if (stock.price == null) return '$---'
  return props.isCedear
    ? `$${stock.price.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
    : `$${stock.price.toFixed(2)}`
}
</script>

<template>
  <div class="stock-item" :title="stock.error || ''">
    <div class="stock-info">
      <div class="stock-sym">{{ stock.symbol }}</div>
      <div class="stock-name">{{ stock.name }}</div>
      <div v-if="isCedear" class="ratio-row">
        <span>Ratio</span>
        <input
          class="ratio-input"
          type="number"
          :value="stock.ratio"
          min="1"
          @change="emit('update-ratio', stock.symbol, $event.target.value)"
        >
        <span>: 1</span>
      </div>
    </div>
    <div class="stock-right">
      <div class="stock-price mono" :class="{ down: stock.error }">{{ fmtPrice(stock) }}</div>
      <div
        v-if="!isCedear && stock.changePercent != null && !stock.loading && !stock.error"
        class="stock-change mono"
        :class="stock.changePercent >= 0 ? 'up' : 'down'"
      >
        {{ stock.changePercent >= 0 ? '+' : '' }}{{ stock.changePercent.toFixed(2) }}%
      </div>
      <button class="remove-btn" title="Quitar" @click="emit('remove', stock.symbol)">×</button>
    </div>
  </div>
</template>

<style scoped>
.stock-item{
  display:flex;
  justify-content:space-between;
  align-items:center;
  padding:8px 10px;
  background:var(--bg);
  border-radius:6px;
  border:1px solid var(--border);
  gap:8px;
}
.stock-info{ min-width:0; }
.stock-sym{font-weight:700;font-size:12px;color:#ffffff;}
.stock-name{
  font-size:10.5px;color:var(--text-dim);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.ratio-row{display:flex;align-items:center;gap:4px;margin-top:3px;font-size:9.5px;color:var(--text-dim);}
.ratio-input{
  width:36px;background:var(--panel);border:1px solid var(--border);border-radius:4px;
  color:var(--text);font-family:var(--font-num);font-size:10px;padding:2px 3px;text-align:center;outline:none;
}
.ratio-input:focus{border-color:var(--blue);}
.stock-right{display:flex;flex-direction:column;align-items:flex-end;gap:2px;position:relative;flex-shrink:0;}
.stock-price{font-family:var(--font-num);font-weight:700;font-size:12px;color:var(--blue);}
.stock-change{font-size:10px;font-weight:600;}
.remove-btn{
  position:absolute;top:-14px;right:-6px;background:transparent;border:none;color:var(--text-dim);
  font-size:14px;cursor:pointer;line-height:1;opacity:0;transition:opacity .15s;
  padding:6px;
}
.stock-item:hover .remove-btn{opacity:1;}
.remove-btn:hover{color:var(--down);}

/* En dispositivos táctiles no existe hover, así que el botón de borrar
   quedaría invisible para siempre: lo mostramos siempre en ese caso. */
@media (hover: none) {
  .remove-btn{ opacity: 0.7; position: static; padding: 4px 6px; }
}
</style>