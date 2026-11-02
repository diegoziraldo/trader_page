<script setup>
import { ref } from 'vue'
const props = defineProps({
  modelValue: { type: Array, required: true },
  placeholder: { type: String, default: 'Escribí y Enter' },
  suggestions: { type: Array, default: () => [] },
  disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])
const text = ref('')
const listId = `sl-tags-${Math.random().toString(36).slice(2, 8)}`
function commit() {
  const parts = text.value.split(',').map((s) => s.trim()).filter(Boolean)
  if (!parts.length) return
  emit('update:modelValue', [...new Set([...props.modelValue, ...parts])])
  text.value = ''
}
const remove = (t) => emit('update:modelValue', props.modelValue.filter((x) => x !== t))
</script>

<template>
  <div style="display: flex; flex-direction: column; gap: 6px">
    <div class="sl-chips">
      <span v-for="t in modelValue" :key="t" class="sl-chip">{{ t }}<button v-if="!disabled" type="button" @click="remove(t)">×</button></span>
      <span v-if="!modelValue.length" class="dim">—</span>
    </div>
    <template v-if="!disabled">
      <datalist :id="listId"><option v-for="s in suggestions" :key="s" :value="s" /></datalist>
      <input v-model="text" class="sl-input" :list="listId" :placeholder="placeholder" @keydown.enter.prevent="commit" @blur="commit" />
    </template>
  </div>
</template>
