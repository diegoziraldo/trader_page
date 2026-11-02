<script setup>
defineProps({ items: { type: Array, required: true } })
</script>

<template>
  <div class="sl-kpis">
    <div v-for="it in items" :key="it.label" class="sl-kpi" :title="it.title || ''">
      <div class="sl-kpi-label">{{ it.label }}</div>
      <div class="sl-kpi-value" :class="it.tone || 'neu'">{{ it.value }}</div>
      <div v-if="it.sub" class="sl-kpi-sub">{{ it.sub }}</div>
    </div>
  </div>
</template>
