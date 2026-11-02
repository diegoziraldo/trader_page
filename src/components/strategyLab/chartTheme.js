export const COLORS = {
  up: '#00d9a3', down: '#ff4d5e', blue: '#8ab4f8', dim: '#b0b4bc', grid: '#262b36', amber: '#e5b567',
  palette: ['#8ab4f8', '#e5b567', '#00d9a3', '#c58af9', '#ff8a65', '#4dd0e1', '#f48fb1', '#aed581'],
}
export const signColors = (vals) => vals.map((v) => (v === null || v === undefined ? COLORS.dim : v >= 0 ? COLORS.up : COLORS.down))

export function baseOptions(type) {
  const radial = type === 'doughnut' || type === 'pie'
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false, labels: { color: COLORS.dim, boxWidth: 10, font: { size: 11 } } },
      tooltip: { backgroundColor: '#0f1115', borderColor: COLORS.grid, borderWidth: 1, titleColor: '#f1f3f4', bodyColor: '#f1f3f4' },
    },
    scales: radial ? {} : {
      x: { ticks: { color: COLORS.dim, font: { size: 11 }, maxRotation: 0, autoSkip: true }, grid: { color: COLORS.grid } },
      y: { ticks: { color: COLORS.dim, font: { size: 11 } }, grid: { color: COLORS.grid } },
    },
  }
}

export function deepMerge(a, b) {
  if (!b) return a
  const out = Array.isArray(a) ? [...a] : { ...a }
  for (const k of Object.keys(b)) {
    out[k] = b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a && typeof a[k] === 'object' ? deepMerge(a[k], b[k]) : b[k]
  }
  return out
}
