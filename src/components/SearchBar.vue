<script setup>
import { ref } from 'vue'

defineProps({ compact: { type: Boolean, default: false } })

const query = ref('')
const focused = ref(false)

function doSearch() {
  const q = query.value.trim()
  if (!q) return
  window.location.href = `https://www.google.com/search?q=${encodeURIComponent(q)}`
}

function onKeypress(e) {
  if (e.key === 'Enter') doSearch()
}
</script>

<template>
  <div class="search-shell" :class="{ focus: focused, compact }">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M21 21l-4.35-4.35M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z" stroke="#9aa0a6" stroke-width="2" stroke-linecap="round"/>
    </svg>
    <input
      v-model="query"
      type="text"
      placeholder="Búsqueda en Google..."
      autocomplete="off"
      @keypress="onKeypress"
      @focus="focused = true"
      @blur="focused = false"
    >
  </div>
  <button v-if="!compact" class="search-btn" @click="doSearch">Búsqueda en Google</button>
</template>

<style scoped>
.search-shell{
  display:flex;align-items:center;gap:12px;
  width:100%;padding:0 18px;height:50px;
  background:var(--panel);
  border:1px solid var(--border);border-radius:25px;
  transition:box-shadow .15s, border-color .15s;
  margin-bottom:14px;
}
.search-shell:hover, .search-shell.focus{
  box-shadow:0 1px 10px rgba(0,0,0,.5);border-color:var(--blue);
}
.search-shell.compact{ height:38px;padding:0 14px;margin-bottom:0; }
.search-shell.compact input{ font-size:13px; }
.search-shell svg{flex-shrink:0;}
.search-shell input{
  flex:1;border:none;outline:none;font-size:15px;color:var(--text);background:transparent;
}
.search-btn{
  background:var(--panel);border:1px solid var(--border);border-radius:6px;
  color:var(--text-dim);font-size:13px;padding:8px 18px;cursor:pointer;
  transition:all .2s;
}
.search-btn:hover{border-color:var(--text-dim);color:var(--text);}
</style>