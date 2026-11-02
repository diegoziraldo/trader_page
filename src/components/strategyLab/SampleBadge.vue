<script setup>
import { computed } from 'vue'
import { sampleReliability } from '../../services/strategyLab/stats.js'

const props = defineProps({ n: { type: Number, required: true } })
const r = computed(() => sampleReliability(props.n))
const short = computed(() => ({ INSUFFICIENT: 'insuficiente', LOW: 'orientativa', MODERATE: '', ADEQUATE: '' })[r.value.level])
</script>

<template>
  <span class="sl-badge" :class="{ warn: r.warn }" :title="r.label + ' (n = ' + n + ')'">
    n={{ n }}<template v-if="short"> · {{ short }}</template>
  </span>
</template>
