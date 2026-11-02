import { describe, it, expect, beforeAll, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { Hono } from 'hono'
import { makeD1 } from './d1shim.mjs'
import { strategyLab } from '../functions/_lib/strategyLabRoutes.js'
import StrategyLab from '../src/components/strategyLab/StrategyLab.vue'

const db = makeD1(['migrations/004_strategy_lab.sql'])
const app = new Hono().basePath('/api'); app.route('/strategy-lab', strategyLab)
globalThis.fetch = (url, init) => app.fetch(new Request('http://localhost' + url, init), { DB: db })

const post = async (path, body) => { const r = await fetch('/api/strategy-lab' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json(); if (!r.ok) throw new Error(j.error); return j }
const warns = []
beforeAll(async () => {
  vi.spyOn(console, 'warn').mockImplementation((...a) => warns.push(a.join(' ')))
  vi.spyOn(console, 'error').mockImplementation((...a) => warns.push(a.join(' ')))
  const s = await post('/strategies', { name: 'HMA + RSI', category: 'Tendencia', version: { directionMode: 'BOTH', timeframes: ['1H'], indicators: ['HMA 50'], conditions: [{ label: 'Sobre HMA 50', required: true }, { label: 'RSI 50-70', required: true }] } })
  const ids = s.current.conditions.map((c) => c.id)
  const wins = [1, 1, -1, 1, -1, 1, 1, -1, 1, 1, -1, 1]
  for (let i = 0; i < wins.length; i++) {
    await post('/trades', { strategyId: s.id, recordType: i % 3 === 0 ? 'REAL' : 'BACKTEST', symbol: ['NVDA', 'MELI', 'NU'][i % 3], direction: 'LONG', timeframe: '1H',
      entryDate: `2026-0${1 + (i % 4)}-${String(3 + i).padStart(2, '0')}`, entryTime: `${10 + (i % 5)}:00`, entryPrice: 100, stopLoss: 95, takeProfit: 110, quantity: 10,
      exitDate: `2026-0${1 + (i % 4)}-${String(3 + i).padStart(2, '0')}`, exitTime: `${15 + (i % 3)}:00`, exitPrice: wins[i] > 0 ? 108 : 95,
      conditionResults: ids.map((id, k) => ({ conditionId: id, status: i % 4 === 0 && k === 1 ? 'NOT_MET' : 'MET' })) })
  }
  await post('/trades', { strategyId: s.id, recordType: 'BACKTEST', symbol: 'AAPL', direction: 'LONG', timeframe: '1H', entryDate: '2026-02-20', entryPrice: 50, conditionResults: ids.map((id) => ({ conditionId: id, status: 'MET' })) })
})

describe('Strategy Lab (UI + Hono + SQLite)', () => {
  it('recorre todas las pestañas sin errores ni warnings de Vue', async () => {
    const w = mount(StrategyLab, { attachTo: document.body })
    await flushPromises(); await flushPromises()
    const text = () => w.text()
    expect(text()).toContain('Indicadores globales')
    expect(text()).toContain('Win rate')
    expect(text()).toContain('Mejor estrategia')
    const tabs = w.findAll('.sl-tab')
    const names = tabs.map((t) => t.text())
    expect(names).toEqual(['Dashboard', 'Estrategias', 'Registrar', 'Historial', 'Estadísticas', 'Comparador', 'Descubrimiento'])
    const expected = { Estrategias: 'HMA + RSI', Registrar: 'Validación de reglas', Historial: 'Operaciones (13)', Estadísticas: 'Racha máx. de ganancias', Comparador: 'Estrategias a comparar', Descubrimiento: 'Cómo leer esta sección' }
    for (const t of tabs.slice(1)) { await t.trigger('click'); await flushPromises(); expect(text(), t.text()).toContain(expected[t.text()]) }
    w.unmount()
    expect(warns.filter((m) => /\[Vue warn\]|Error/.test(m))).toEqual([])
  })

  it('historial: filtra, abre detalle y marca la pendiente', async () => {
    const w = mount(StrategyLab, { attachTo: document.body })
    await flushPromises(); await flushPromises()
    await w.findAll('.sl-tab')[3].trigger('click'); await flushPromises()
    expect(w.findAll('tbody tr.clickable').length).toBe(13)
    expect(w.text()).toContain('Pendiente')
    await w.find('input[placeholder="NVDA"]').setValue('meli'); await flushPromises()
    expect(w.findAll('tbody tr.clickable').length).toBe(4)
    await w.find('tbody tr.clickable').trigger('click'); await flushPromises()
    expect(w.text()).toContain('cumplimiento')
    w.unmount()
  })

  it('registrar: valida y guarda una operación desde el formulario', async () => {
    const w = mount(StrategyLab, { attachTo: document.body })
    await flushPromises(); await flushPromises()
    await w.findAll('.sl-tab')[2].trigger('click'); await flushPromises()
    expect(w.text()).toContain('Pendiente para poder guardar')
    const set = async (sel, v) => { await w.find(sel).setValue(v) }
    await set('input[placeholder="NVDA"]', 'googl')
    const nums = w.findAll('input[type="number"]')
    await nums[0].setValue('200'); await nums[1].setValue('190')
    for (const b of w.findAll('.sl-seg button.met')) await b.trigger('click')
    await w.findAll('.sl-btn.primary').at(-1).trigger('click'); await flushPromises(); await flushPromises()
    expect(w.text()).toContain('Operaciones (14)')
    expect(w.text()).toContain('GOOGL')
    w.unmount()
  })
})
