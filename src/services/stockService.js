// Cotizaciones de acciones en vivo vía Finnhub.
// Finnhub permite llamadas directas desde el navegador (CORS ok) y su plan
// gratuito alcanza para este panel (60 llamadas/minuto).
//
// La API key se lee de una variable de entorno de Vite. Creá un archivo
// ".env" en la raíz del proyecto (podés copiar ".env.example") con:
//   VITE_FINNHUB_API_KEY=tu_clave_aca
//
// Finnhub free tier NO tiene cobertura de BYMA/BCBA (CEDEARs argentinos),
// solo NYSE/NASDAQ y algunos mercados globales. Por eso el precio de
// CEDEARs no sale de acá directamente: se calcula con getTheoreticalCedear()
// más abajo, combinando el precio real de EE.UU. con el dólar CCL.

const FINNHUB_BASE = 'https://finnhub.io/api/v1'
const API_KEY = import.meta.env.VITE_FINNHUB_API_KEY

function assertApiKey() {
  if (!API_KEY) {
    throw new Error(
      'Falta VITE_FINNHUB_API_KEY. Creá un archivo .env con tu clave de Finnhub (ver .env.example).'
    )
  }
}

/**
 * Cotización en vivo de una acción de NYSE/NASDAQ.
 * @param {string} symbol Ej: 'AAPL', 'TSLA'
 * @returns {Promise<{price:number, change:number, changePercent:number}>}
 */
export async function fetchQuote(symbol) {
  assertApiKey()
  const url = `${FINNHUB_BASE}/quote?symbol=${encodeURIComponent(symbol)}&token=${API_KEY}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Error consultando ${symbol} en Finnhub`)
  const data = await res.json()

  // Finnhub devuelve c:0 cuando el símbolo no existe/no tiene datos.
  if (!data || data.c === 0) {
    throw new Error(`Símbolo "${symbol}" no encontrado en Finnhub`)
  }

  return {
    price: data.c,          // precio actual
    change: data.d,         // variación absoluta
    changePercent: data.dp, // variación %
  }
}

/**
 * Nombre "lindo" de la compañía (Finnhub free tier trae poco detalle de perfil,
 * así que esto queda como mejora futura si se suma un endpoint de /stock/profile2).
 */
export async function fetchCompanyName(symbol) {
  assertApiKey()
  const url = `${FINNHUB_BASE}/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${API_KEY}`
  const res = await fetch(url)
  if (!res.ok) return null
  const data = await res.json()
  return data?.name || null
}

/**
 * Precio teórico de un CEDEAR en ARS, calculado en vivo:
 *   (precio USD subyacente ÷ ratio) × dólar CCL
 * @param {number} usdPrice precio real de la acción en EE.UU. (Finnhub)
 * @param {number} ratio    cuántos CEDEARs representan 1 acción
 * @param {number} cclRate  cotización del dólar CCL (venta)
 */
export function getTheoreticalCedear(usdPrice, ratio, cclRate) {
  if (!usdPrice || !ratio || !cclRate) return null
  return (usdPrice / ratio) * cclRate
}