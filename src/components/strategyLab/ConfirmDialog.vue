<script setup>
defineProps({
  title: { type: String, default: 'Confirmar' },
  message: { type: String, required: true },
  confirmText: { type: String, default: 'Confirmar' },
  danger: { type: Boolean, default: true },
  busy: { type: Boolean, default: false },
})
defineEmits(['confirm', 'cancel'])
</script>

<template>
  <div class="sl-modal-bg" style="z-index: 1200" @click.self="$emit('cancel')">
    <div class="sl-modal narrow">
      <div class="sl-panel-head"><span class="sl-panel-title">{{ title }}</span></div>
      <div class="sl-panel-body" style="display: flex; flex-direction: column; gap: 14px">
        <div style="line-height: 1.5">{{ message }}</div>
        <div style="display: flex; justify-content: flex-end; gap: 8px">
          <button class="sl-btn" :disabled="busy" @click="$emit('cancel')">Cancelar</button>
          <button class="sl-btn" :class="danger ? 'danger' : 'primary'" :disabled="busy" @click="$emit('confirm')">{{ confirmText }}</button>
        </div>
      </div>
    </div>
  </div>
</template>
