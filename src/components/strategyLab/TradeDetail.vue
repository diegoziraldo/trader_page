<script setup>
import { ref, computed, onMounted } from 'vue'
import { useStrategyLab } from '../../composables/useStrategyLab.js'
import { fmtValue, fmtNum, fmtDateTime, tone, MARKET_LABELS, OUTCOME_LABELS, RECORD_LABELS } from '../../services/strategyLab/format.js'

const props = defineProps({ trade: { type: Object, required: true } })
defineEmits(['close', 'edit', 'delete'])
const { api } = useStrategyLab()
const attachments = ref([])
const loadingLinks = ref(false)
const linksError = ref('')
const zoom = ref(null)
const links = computed(() => attachments.value.filter((a) => a.kind === 'link'))
const images = computed(() => attachments.value.filter((a) => a.kind !== 'link'))
const STATUS = { MET: ['Cumplida', 'pos'], NOT_MET: ['No cumplida', 'neg'], NA: ['No aplica', 'dim'] }
const KIND = { ENTRY: 'Entrada', EXIT: 'Salida', FILTER: 'Filtro' }
onMounted(async () => {
  if (!props.trade.attachmentCount) return
  loadingLinks.value = true
  try { attachments.value = await api.listAttachments(props.trade.id) } catch (e) { linksError.value = e.message || 'No se pudieron cargar los links' } finally { loadingLinks.value = false }
})
</script>

<template>
  <div class="sl-modal-bg" @click.self="$emit('close')">
    <div class="sl-modal">
      <div class="sl-panel-head">
        <span class="sl-panel-title">{{ trade.symbol }} · {{ trade.direction }} · {{ trade.strategyName }} v{{ trade.versionNumber }}</span>
        <span style="display: flex; gap: 8px">
          <button class="sl-btn sm" @click="$emit('edit')">Editar</button>
          <button class="sl-btn sm danger" @click="$emit('delete')">Eliminar</button>
          <button class="sl-btn sm ghost" @click="$emit('close')">✕</button>
        </span>
      </div>
      <div class="sl-panel-body" style="display: flex; flex-direction: column; gap: 16px">
        <div style="display: flex; gap: 8px; flex-wrap: wrap">
          <span class="sl-badge" :class="trade.recordType === 'REAL' ? 'real' : 'bt'">{{ RECORD_LABELS[trade.recordType] }}</span>
          <span v-if="trade.status === 'PENDING'" class="sl-badge warn">Pendiente</span>
          <span v-else class="sl-badge" :class="trade.outcome === 'WIN' ? 'win' : trade.outcome === 'LOSS' ? 'loss' : ''">{{ OUTCOME_LABELS[trade.outcome] }}</span>
          <span class="sl-badge">{{ MARKET_LABELS[trade.instrumentType] }}</span>
          <span v-if="trade.market" class="sl-badge">{{ trade.market }}</span>
          <span class="sl-badge">{{ trade.timeframe }}</span>
        </div>
        <div v-if="trade.assetName" class="dim">{{ trade.assetName }}</div>

        <div v-if="trade.attachmentCount" class="sl-panel" style="background: var(--bg)">
          <div class="sl-panel-head"><span class="sl-panel-title">Links de TradingView ({{ links.length }})</span></div>
          <div v-if="loadingLinks" class="dim" style="padding: 10px 14px">Cargando links…</div>
          <div v-else-if="linksError" class="sl-error" style="margin: 10px 14px">{{ linksError }}</div>
          <div v-else-if="!links.length" class="dim" style="padding: 10px 14px">Esta operación no tiene links.</div>
          <div v-for="(a, i) in links" :key="a.id" style="display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 7px 14px; border-top: 1px solid var(--border)">
            <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap"><span class="dim">{{ i + 1 }}.</span> {{ a.url.replace(/^https?:\/\/(www\.)?/, '') }}</span>
            <a :href="a.url" target="_blank" rel="noopener noreferrer" class="sl-btn sm" style="text-decoration: none; flex-shrink: 0">Abrir ↗</a>
          </div>
        </div>

        <div class="sl-cols" style="font-family: var(--font-num)">
          <div><div class="sl-label">Entrada</div>{{ fmtNum(trade.entryPrice, 4) }}<div class="dim">{{ fmtDateTime(trade.entryDate, trade.entryTime) }}</div></div>
          <div><div class="sl-label">Stop loss</div>{{ trade.stopLoss === null ? '—' : fmtNum(trade.stopLoss, 4) }}</div>
          <div><div class="sl-label">Take profit</div>{{ trade.takeProfit === null ? '—' : fmtNum(trade.takeProfit, 4) }}</div>
          <div><div class="sl-label">R:R planeado</div>{{ trade.plannedRR === null ? '—' : fmtNum(trade.plannedRR) }}</div>
          <div><div class="sl-label">Cantidad</div>{{ trade.quantity ?? '—' }}</div>
          <div><div class="sl-label">Riesgo</div>{{ trade.riskMoney === null ? '—' : fmtNum(trade.riskMoney) }}<span v-if="trade.riskPercent !== null" class="dim"> · {{ trade.riskPercent }}%</span></div>
          <div><div class="sl-label">Salida</div>{{ trade.exitPrice === null ? '—' : fmtNum(trade.exitPrice, 4) }}<div class="dim">{{ fmtDateTime(trade.exitDate, trade.exitTime) }}</div></div>
          <div><div class="sl-label">Comisiones</div>{{ fmtNum(trade.fees) }}</div>
        </div>

        <div v-if="trade.status === 'CLOSED'" class="sl-cols" style="font-family: var(--font-num); font-size: 16px">
          <div><div class="sl-label">Resultado %</div><b :class="tone(trade.resultPct)">{{ fmtValue(trade.resultPct, 'PCT') }}</b></div>
          <div><div class="sl-label">Resultado {{ trade.currency || '$' }}</div><b :class="tone(trade.resultAmount)">{{ trade.resultAmount === null ? '—' : fmtValue(trade.resultAmount, 'AMOUNT') }}</b></div>
          <div><div class="sl-label">Resultado R{{ trade.rBasis === 'GROSS' ? ' (bruto)' : '' }}</div><b :class="tone(trade.resultR)">{{ trade.resultR === null ? '—' : fmtValue(trade.resultR, 'R') }}</b></div>
          <div><div class="sl-label">Duración</div>{{ trade.durationMinutes !== null ? `${Math.floor(trade.durationMinutes / 60)} h ${trade.durationMinutes % 60} min` : trade.durationDays !== null ? `${trade.durationDays} día(s)` : '—' }}</div>
        </div>

        <div>
          <div class="sl-panel-title" style="margin-bottom: 6px">Reglas · cumplimiento {{ trade.compliance.pct === null ? '—' : trade.compliance.pct.toFixed(0) + '%' }} ({{ trade.compliance.met }} de {{ trade.compliance.applicable }} aplicables)</div>
          <div v-if="!trade.conditionResults.length" class="dim">La versión no tenía condiciones.</div>
          <table v-else class="sl-table">
            <tbody>
              <tr v-for="c in trade.conditionResults" :key="c.conditionId" :class="{ dimmed: !c.enabled }">
                <td><span class="sl-badge">{{ KIND[c.kind] }}</span></td>
                <td style="white-space: normal">{{ c.label }}<span v-if="!c.required" class="dim"> · opcional</span><span v-if="!c.enabled" class="dim"> · desactivada en la versión</span></td>
                <td :class="STATUS[c.status][1]">{{ STATUS[c.status][0] }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="trade.notes"><div class="sl-panel-title" style="margin-bottom: 4px">Observaciones</div><div style="white-space: pre-wrap; line-height: 1.5">{{ trade.notes }}</div></div>
        <div v-if="images.length"><div class="sl-panel-title" style="margin-bottom: 6px">Capturas guardadas anteriormente</div>
          <div class="sl-img-grid"><img v-for="a in images" :key="a.id" :src="a.dataUrl" :alt="a.filename" @click="zoom = a.dataUrl" /></div></div>
      </div>
    </div>
    <div v-if="zoom" class="sl-modal-bg" style="z-index: 1300; align-items: center" @click.stop="zoom = null"><img :src="zoom" style="max-width: 96vw; max-height: 92vh" /></div>
  </div>
</template>
