<script setup>
defineProps({
  dolares: { type: Object, default: () => ({}) },
  riesgoPais: { type: Object, default: null },
  loading: { type: Boolean, default: true },
  compact: { type: Boolean, default: false },
})

function fmt(casa, dolares) {
  const v = dolares?.[casa]?.venta
  return v ? `$${v.toLocaleString('es-AR')}` : '$---'
}
</script>

<template>
  <div class="finance-ticker" :class="{ compact }">
    <div class="fin-card">
      <div class="fin-title">Dólar MEP</div>
      <div class="fin-val mono">{{ loading ? '$---' : fmt('bolsa', dolares) }}</div>
    </div>
    <div class="fin-card">
      <div class="fin-title">Dólar CCL</div>
      <div class="fin-val mono">{{ loading ? '$---' : fmt('contadoconliqui', dolares) }}</div>
    </div>
    <div class="fin-card">
      <div class="fin-title">Dólar Oficial</div>
      <div class="fin-val mono">{{ loading ? '$---' : fmt('oficial', dolares) }}</div>
    </div>
    <div class="fin-card">
      <div class="fin-title">Riesgo País</div>
      <div class="fin-val mono">{{ riesgoPais ? Math.round(riesgoPais.valor) + ' pb' : '---' }}</div>
    </div>
  </div>
</template>

<style scoped>
.finance-ticker{
  display:grid;grid-template-columns:repeat(2, 1fr);gap:10px;
  width:100%;margin-top:28px;
}
.fin-card{
  background:var(--panel);border:1px solid var(--border);border-radius:8px;
  padding:12px;text-align:left;
}
.fin-title{font-size:11px;color:var(--text-dim);text-transform:uppercase;margin-bottom:4px;font-weight:500;}
.fin-val{font-family:var(--font-num);font-size:16px;font-weight:700;color:#ffffff;}

/* Variante compacta: una sola fila de chips finitos, para la topbar */
.finance-ticker.compact{
  display:flex;
  flex-wrap:wrap;
  justify-content:center;
  gap:8px;
  margin-top:0;
}
.finance-ticker.compact .fin-card{
  display:flex;align-items:center;gap:6px;
  padding:5px 12px;border-radius:16px;
}
.finance-ticker.compact .fin-title{
  margin-bottom:0;font-size:10px;white-space:nowrap;
}
.finance-ticker.compact .fin-val{font-size:12px;}
</style>