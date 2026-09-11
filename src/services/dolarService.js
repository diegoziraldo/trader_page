// Servicio de datos macro Argentina. Ambas APIs son públicas, gratuitas
// y permiten llamadas directas desde el navegador (CORS habilitado).

const DOLAR_API = 'https://dolarapi.com/v1/dolares'
const RIESGO_PAIS_API = 'https://api.argentinadatos.com/v1/finanzas/indices/riesgo-pais/ultimo'

/**
 * Devuelve todas las cotizaciones de dólar (oficial, blue, bolsa/MEP, contadoconliqui/CCL, cripto, etc.)
 * @returns {Promise<Record<string, {compra:number, venta:number, casa:string}>>}
 */
export async function fetchDolares() {
  const res = await fetch(DOLAR_API)
  if (!res.ok) throw new Error('No se pudo obtener la cotización del dólar')
  const data = await res.json()
  return Object.fromEntries(data.map(d => [d.casa, d]))
}

/**
 * Devuelve el último valor del Riesgo País (JP Morgan, vía argentinadatos.com)
 * @returns {Promise<{valor:number, fecha:string}>}
 */
export async function fetchRiesgoPais() {
  const res = await fetch(RIESGO_PAIS_API)
  if (!res.ok) throw new Error('No se pudo obtener el Riesgo País')
  return res.json()
}