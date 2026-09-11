// Top ~150 tickers del S&P 500 ordenados por peso de mercado (mayor a menor).
// Se usa solo para ORDENAR el calendario de balances (mostrar primero las
// compañías más grandes/relevantes). Dato de referencia estático, igual
// que en el script original — no depende de ningún endpoint.
export const SP500_BY_WEIGHT = [
  'NVDA', 'AAPL', 'MSFT', 'AMZN', 'GOOGL', 'GOOG', 'AVGO', 'META', 'TSLA', 'BRK.B',
  'LLY', 'JPM', 'MU', 'WMT', 'AMD', 'V', 'XOM', 'JNJ', 'MA', 'INTC',
  'CSCO', 'BAC', 'ABBV', 'COST', 'AMAT', 'ORCL', 'CVX', 'GE', 'CAT', 'UNH',
  'KO', 'LRCX', 'HD', 'PG', 'MS', 'MRK', 'NFLX', 'GS', 'PLTR', 'PM',
  'RTX', 'PANW', 'DELL', 'GEV', 'WFC', 'TXN', 'KLAC', 'ANET', 'AXP', 'C',
  'LIN', 'TMO', 'IBM', 'CRWD', 'AMGN', 'APH', 'VZ', 'SNDK', 'PEP', 'TMUS',
  'STX', 'MCD', 'ABT', 'BA', 'SCHW', 'WDC', 'NEE', 'ADI', 'BLK', 'TJX',
  'MRVL', 'UNP', 'DIS', 'ETN', 'WELL', 'DE', 'GILD', 'T', 'QCOM', 'CRM',
  'BKNG', 'UBER', 'COP', 'PFE', 'DHR', 'APP', 'LMT', 'PLD', 'ISRG', 'CVS',
  'CB', 'BMY', 'COF', 'SYK', 'GLW', 'PH', 'SPGI', 'PGR', 'FTNT', 'VRTX',
  'LOW', 'NOW', 'SBUX', 'HWM', 'MO', 'MDT', 'BX', 'ADP', 'SO', 'BNY',
  'GD', 'PWR', 'EQIX', 'TT', 'ACN', 'VRT', 'NEM', 'PNC', 'ADBE', 'USB',
  'CEG', 'DDOG', 'DUK', 'MCK', 'CME', 'KKR', 'CDNS', 'CSX', 'MMC', 'MNST',
  'FCX', 'MAR', 'MMM', 'UPS', 'WM', 'MPC', 'CMI', 'ABNB', 'JCI', 'VLO',
  'HCA', 'DASH', 'CMCSA', 'INTU', 'EMR', 'RCL', 'WMB', 'SHW', 'ICE', 'MCO',
]

/** Índice de importancia (0 = compañía más grande). Lo que no está en la lista queda al final. */
const IMPORTANCE_MAP = Object.fromEntries(SP500_BY_WEIGHT.map((sym, idx) => [sym, idx]))

export function importanciaDe(ticker) {
  return IMPORTANCE_MAP[ticker] !== undefined ? IMPORTANCE_MAP[ticker] : 9999
}