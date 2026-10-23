<script setup>
import { ref, computed, onMounted } from 'vue'
import { auditData } from '../services/dataAudit'
import { getTrades } from '../services/tradesService'
import { getPositions } from '../services/portfoliosService'
import { syncPortfolioFromTrades } from '../services/portfolioSyncService'

// Control de datos: compara tus trades contra las posiciones de cada cartera y
// marca lo que no cierra. Lo que se puede arreglar sin riesgo (posiciones
// desfasadas) se corrige con un clic; lo demás (ventas de más, duplicadas,
// fechas futuras, operaciones sin cartera) te lo explica para que lo decidas
// vos: este panel nunca modifica ni borra operaciones.
const props = defineProps({
  portfolios: { type: Array, required: true },
  // Inyectables para poder probar el panel sin base de datos.
  loadTrades: { type: Function, default: getTrades },
  loadPositions: { type: Function, default: getPositions },
  runSync: { type: Function, default: syncPortfolioFromTrades },
})
const emit = defineEmits(['fixed'])

const loading = ref(false)
const fixing = ref(false)
const error = ref('')
const result = ref(null)
const checkedAt = ref(null)
let tradesCache = []

const nameOf = (id) => props.portfolios.find((p) => String(p.id) === String(id))?.name || `Cartera ${id}`
const SEVERITY_LABEL = { alta: 'Crítico', media: 'Revisar', baja: 'Aviso' }

async function run() {
  loading.value = true
  error.value = ''
  try {
    tradesCache = await props.loadTrades()
    const positionsByPortfolio = {}
    await Promise.all(
      props.portfolios.map(async (p) => {
        positionsByPortfolio[p.id] = await props.loadPositions(p.id)
      })
    )
    result.value = auditData({ trades: tradesCache, portfolios: props.portfolios, positionsByPortfolio })
    checkedAt.value = new Date()
  } catch (e) {
    error.value = e.message || 'No se pudo revisar'
  } finally {
    loading.value = false
  }
}

async function fix(portfolioIds) {
  fixing.value = true
  error.value = ''
  try {
    for (const pid of portfolioIds) await props.runSync(pid, { trades: tradesCache })
    emit('fixed')
    await run()
  } catch (e) {
    error.value = e.message || 'No se pudo corregir'
  } finally {
    fixing.value = false
  }
}

const fixableCount = computed(() => (result.value?.issues || []).filter((i) => i.fix === 'sync').length)
const timeLabel = computed(() =>
  checkedAt.value ? checkedAt.value.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : ''
)

onMounted(run)
</script>

<template>
  <section class="audit" aria-label="Control de datos">
    <header class="audit-head">
      <div>
        <div class="audit-title">Control de datos</div>
        <div class="audit-sub">
          Compara tus operaciones de Mis Trades con las posiciones de cada cartera. No modifica ni borra operaciones.
        </div>
      </div>
      <button type="button" class="audit-btn" :disabled="loading || fixing" @click="run">
        {{ loading ? 'Revisando…' : 'Revisar de nuevo' }}
      </button>
    </header>

    <p v-if="error" class="audit-error">{{ error }}</p>

    <template v-if="result">
      <div v-if="result.healthy" class="audit-ok">
        <span class="audit-ok-mark" aria-hidden="true">✓</span>
        <div>
          <strong>Todo en orden.</strong>
          Revisé {{ result.checked.trades }} operaciones y {{ result.checked.positions }} posiciones en
          {{ result.checked.portfolios }} {{ result.checked.portfolios === 1 ? 'cartera' : 'carteras' }};
          las cantidades y los costos coinciden con tus trades.
          <span v-if="timeLabel" class="audit-time">Revisado a las {{ timeLabel }}.</span>
        </div>
      </div>

      <template v-else>
        <div class="audit-summary">
          <span v-if="result.counts.alta" class="audit-count sev-alta">{{ result.counts.alta }} {{ result.counts.alta === 1 ? 'crítico' : 'críticos' }}</span>
          <span v-if="result.counts.media" class="audit-count sev-media">{{ result.counts.media }} para revisar</span>
          <span v-if="result.counts.baja" class="audit-count sev-baja">{{ result.counts.baja }} {{ result.counts.baja === 1 ? 'aviso' : 'avisos' }}</span>
          <span class="audit-time">
            {{ result.checked.trades }} operaciones y {{ result.checked.positions }} posiciones revisadas<template v-if="timeLabel"> a las {{ timeLabel }}</template>
          </span>
          <button
            v-if="fixableCount"
            type="button"
            class="audit-btn audit-btn-primary"
            :disabled="loading || fixing"
            @click="fix(result.fixableCartera)"
          >{{ fixing ? 'Corrigiendo…' : `Corregir ${fixableCount} ${fixableCount === 1 ? 'posición' : 'posiciones'} desde mis trades` }}</button>
        </div>

        <ul class="audit-list">
          <li v-for="issue in result.issues" :key="issue.id" class="audit-item" :class="'sev-' + issue.severity">
            <span class="audit-badge" :class="'sev-' + issue.severity">{{ SEVERITY_LABEL[issue.severity] }}</span>
            <div class="audit-body">
              <div class="audit-item-title">{{ issue.title }}</div>
              <div class="audit-item-detail">{{ issue.detail }}</div>
            </div>
            <button
              v-if="issue.fix === 'sync' && issue.portfolioId != null"
              type="button"
              class="audit-btn"
              :disabled="loading || fixing"
              :title="`Sincroniza ${nameOf(issue.portfolioId)} con Mis Trades`"
              @click="fix([issue.portfolioId])"
            >Corregir</button>
          </li>
        </ul>
      </template>
    </template>

    <p v-else-if="loading" class="audit-loading">Revisando tus datos…</p>
  </section>
</template>

<style scoped>
.audit {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.audit-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.audit-title { font-size: 16px; font-weight: 700; color: var(--text); }
.audit-sub { font-size: 12.5px; color: var(--text-dim); margin-top: 4px; max-width: 620px; line-height: 1.5; }
.audit-btn {
  background: var(--panel);
  border: 1px solid var(--border);
  color: var(--text-dim);
  border-radius: 8px;
  padding: 7px 12px;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.audit-btn:hover:not(:disabled) { color: var(--text); border-color: var(--text-dim); }
.audit-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.audit-btn-primary { background: #2563eb; border-color: #2563eb; color: #fff; }
.audit-btn-primary:hover:not(:disabled) { background: #1d4ed8; border-color: #1d4ed8; color: #fff; }
.audit-error {
  margin: 0;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.4);
  color: #ef4444;
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 13px;
}
.audit-loading { margin: 0; color: var(--text-dim); font-size: 13px; }
.audit-ok {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  background: rgba(34, 197, 94, 0.08);
  border: 1px solid rgba(34, 197, 94, 0.3);
  border-radius: 10px;
  padding: 12px 14px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text);
}
.audit-ok-mark {
  flex: none;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #22c55e;
  color: #052e16;
  font-size: 12px;
  font-weight: 800;
  display: grid;
  place-items: center;
}
.audit-time { color: var(--text-dim); font-size: 12px; }
.audit-summary { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.audit-count { font-size: 12px; font-weight: 700; padding: 4px 10px; border-radius: 999px; }
.sev-alta.audit-count, .sev-alta.audit-badge { background: rgba(239, 68, 68, 0.15); color: #ef4444; }
.sev-media.audit-count, .sev-media.audit-badge { background: rgba(234, 179, 8, 0.15); color: #eab308; }
.sev-baja.audit-count, .sev-baja.audit-badge { background: rgba(176, 180, 188, 0.15); color: var(--text-dim); }
.audit-summary .audit-btn { margin-left: auto; }
.audit-list { list-style: none; margin: 0; padding: 0; border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
.audit-item { display: flex; gap: 12px; align-items: flex-start; padding: 12px 14px; border-top: 1px solid var(--border); }
.audit-item:first-child { border-top: 0; }
.audit-badge { flex: none; font-size: 11px; font-weight: 700; padding: 3px 9px; border-radius: 999px; margin-top: 1px; min-width: 62px; text-align: center; }
.audit-body { flex: 1; min-width: 0; }
.audit-item-title { font-size: 13.5px; font-weight: 600; color: var(--text); }
.audit-item-detail { font-size: 12.5px; color: var(--text-dim); margin-top: 2px; line-height: 1.5; }
@media (max-width: 760px) {
  .audit { padding: 14px 12px; }
  .audit-item { flex-wrap: wrap; }
  .audit-summary .audit-btn { margin-left: 0; width: 100%; }
}
</style>
