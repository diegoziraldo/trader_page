// Helper compartido para consultar precios reales en Finnhub.
//
// Necesitás una API key gratuita: https://finnhub.io/register
// Una vez que la tengas, creá un archivo `.env` en la raíz del proyecto con:
//
//   VITE_FINNHUB_API_KEY=tu_api_key_aca
//
// El plan gratuito permite ~60 requests/minuto, por eso en useStocks.js
// espaciamos los pedidos en vez de dispararlos todos juntos.

const FINNHUB_TOKEN = import.meta.env.VITE_FINNHUB_API_KEY
const BASE_URL = 'https://finnhub.io/api/v1'

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Trae la cotización actual de un ticker de USA (NYSE/NASDAQ) desde Finnhub.
 * @param {string} symbol - ej: "AAPL"
 */
export async function fetchQuote(symbol) {
  if (!FINNHUB_TOKEN) {
    throw new Error(
      'Falta VITE_FINNHUB_API_KEY. Creá un .env con tu API key gratuita de finnhub.io'
    )
  }

  const url = `${BASE_URL}/quote?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_TOKEN}`
  const res = await fetch(url)

  if (res.status === 429) {
    throw new Error(`Rate limit de Finnhub alcanzado (símbolo ${symbol})`)
  }
  if (!res.ok) {
    throw new Error(`Finnhub respondió ${res.status} para ${symbol}`)
  }

  const data = await res.json()

  // Finnhub devuelve todos los campos en 0 cuando el símbolo no existe
  // o no hay datos disponibles para él.
  if (data.c === 0 && data.pc === 0) {
    throw new Error(`Símbolo inválido o sin datos: ${symbol}`)
  }

  return {
    price: data.c, // precio actual
    change: data.d, // variación en $ vs cierre anterior
    changePercent: data.dp, // variación en % vs cierre anterior
    high: data.h,
    low: data.l,
    open: data.o,
    previousClose: data.pc,
    timestamp: data.t,
  }
}