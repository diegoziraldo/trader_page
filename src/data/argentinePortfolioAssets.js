// src/data/argentinePortfolioAssets.js
//
// Catálogo de referencia de instrumentos para armar una cartera "profesional"
// típica de un inversor argentino: los CEDEARs más líquidos de BYMA (cruzados
// contra la lista real de tickers con CEDEAR en cedearTickers.js) y las
// acciones argentinas más operadas del panel líder/general del Merval.
//
// IMPORTANTE — esto es información de referencia, no de mercado en vivo:
//  - `beta` es un valor aproximado de referencia (distintas fuentes y
//    ventanas de cálculo dan números distintos; es orientativo para pensar
//    el perfil de riesgo, no un dato exacto ni actualizado en tiempo real).
//  - No incluye el ratio de conversión del CEDEAR a propósito: el ratio
//    cambia con splits/ajustes y hay que confirmarlo con el broker antes de
//    operar. Por eso el campo "ratio" se carga a mano en el formulario.
//
// Si un ticker que necesitás no está acá, cargalo igual a mano en el
// formulario (tipo de activo y sector manuales) — simplemente no vas a
// tener beta automático para esa posición hasta que se agregue al catálogo.
//
// sector usa las mismas categorías que ya se muestran en el selector de
// sector del formulario (PortfolioBuilder.vue).

export const PORTFOLIO_ASSET_CATALOG = [
  // ---------------- CEDEARs: Tecnología ----------------
  { ticker: 'AAPL', name: 'Apple Inc.', assetType: 'CEDEAR', sector: 'Tecnología', beta: 1.2 },
  { ticker: 'MSFT', name: 'Microsoft Corp.', assetType: 'CEDEAR', sector: 'Tecnología', beta: 0.9 },
  { ticker: 'NVDA', name: 'NVIDIA Corp.', assetType: 'CEDEAR', sector: 'Tecnología', beta: 1.7 },
  { ticker: 'ORCL', name: 'Oracle Corp.', assetType: 'CEDEAR', sector: 'Tecnología', beta: 1.1 },
  { ticker: 'CRM', name: 'Salesforce Inc.', assetType: 'CEDEAR', sector: 'Tecnología', beta: 1.2 },
  { ticker: 'ADBE', name: 'Adobe Inc.', assetType: 'CEDEAR', sector: 'Tecnología', beta: 1.3 },
  { ticker: 'IBM', name: 'IBM Corp.', assetType: 'CEDEAR', sector: 'Tecnología', beta: 0.7 },
  { ticker: 'CSCO', name: 'Cisco Systems', assetType: 'CEDEAR', sector: 'Tecnología', beta: 0.9 },
  { ticker: 'QCOM', name: 'Qualcomm Inc.', assetType: 'CEDEAR', sector: 'Tecnología', beta: 1.3 },
  { ticker: 'INTC', name: 'Intel Corp.', assetType: 'CEDEAR', sector: 'Tecnología', beta: 1.0 },
  { ticker: 'AMD', name: 'Advanced Micro Devices', assetType: 'CEDEAR', sector: 'Tecnología', beta: 1.7 },
  { ticker: 'SHOP', name: 'Shopify Inc.', assetType: 'CEDEAR', sector: 'Tecnología', beta: 2.3 },
  { ticker: 'GLOB', name: 'Globant S.A.', assetType: 'CEDEAR', sector: 'Tecnología', beta: 1.5 },
  { ticker: 'ASML', name: 'ASML Holding', assetType: 'CEDEAR', sector: 'Tecnología', beta: 1.1 },
  { ticker: 'TSM', name: 'Taiwan Semiconductor', assetType: 'CEDEAR', sector: 'Tecnología', beta: 1.2 },
  { ticker: 'SAP', name: 'SAP SE', assetType: 'CEDEAR', sector: 'Tecnología', beta: 0.9 },
  { ticker: 'SONY', name: 'Sony Group Corp.', assetType: 'CEDEAR', sector: 'Tecnología', beta: 0.8 },
  { ticker: 'TXN', name: 'Texas Instruments', assetType: 'CEDEAR', sector: 'Tecnología', beta: 1.0 },
  { ticker: 'MU', name: 'Micron Technology', assetType: 'CEDEAR', sector: 'Tecnología', beta: 1.5 },
  { ticker: 'LRCX', name: 'Lam Research', assetType: 'CEDEAR', sector: 'Tecnología', beta: 1.4 },
  { ticker: 'AMAT', name: 'Applied Materials', assetType: 'CEDEAR', sector: 'Tecnología', beta: 1.3 },
  { ticker: 'NOW', name: 'ServiceNow Inc.', assetType: 'CEDEAR', sector: 'Tecnología', beta: 1.1 },

  // ---------------- CEDEARs: Comunicación ----------------
  { ticker: 'GOOGL', name: 'Alphabet Inc.', assetType: 'CEDEAR', sector: 'Comunicación', beta: 1.05 },
  { ticker: 'META', name: 'Meta Platforms', assetType: 'CEDEAR', sector: 'Comunicación', beta: 1.2 },
  { ticker: 'NFLX', name: 'Netflix Inc.', assetType: 'CEDEAR', sector: 'Comunicación', beta: 1.3 },
  { ticker: 'DIS', name: 'Walt Disney Co.', assetType: 'CEDEAR', sector: 'Comunicación', beta: 1.2 },
  { ticker: 'T', name: 'AT&T Inc.', assetType: 'CEDEAR', sector: 'Comunicación', beta: 0.6 },
  { ticker: 'VZ', name: 'Verizon Communications', assetType: 'CEDEAR', sector: 'Comunicación', beta: 0.4 },
  { ticker: 'TMUS', name: 'T-Mobile US', assetType: 'CEDEAR', sector: 'Comunicación', beta: 0.7 },
  { ticker: 'BIDU', name: 'Baidu Inc.', assetType: 'CEDEAR', sector: 'Comunicación', beta: 0.7 },
  { ticker: 'SNAP', name: 'Snap Inc.', assetType: 'CEDEAR', sector: 'Comunicación', beta: 1.4 },
  { ticker: 'SPOT', name: 'Spotify Technology', assetType: 'CEDEAR', sector: 'Comunicación', beta: 1.3 },

  // ---------------- CEDEARs: Consumo ----------------
  { ticker: 'AMZN', name: 'Amazon.com Inc.', assetType: 'CEDEAR', sector: 'Consumo', beta: 1.3 },
  { ticker: 'TSLA', name: 'Tesla Inc.', assetType: 'CEDEAR', sector: 'Consumo', beta: 2.0 },
  { ticker: 'MCD', name: "McDonald's Corp.", assetType: 'CEDEAR', sector: 'Consumo', beta: 0.7 },
  { ticker: 'NKE', name: 'Nike Inc.', assetType: 'CEDEAR', sector: 'Consumo', beta: 1.1 },
  { ticker: 'SBUX', name: 'Starbucks Corp.', assetType: 'CEDEAR', sector: 'Consumo', beta: 1.0 },
  { ticker: 'HD', name: 'Home Depot Inc.', assetType: 'CEDEAR', sector: 'Consumo', beta: 1.0 },
  { ticker: 'MELI', name: 'MercadoLibre Inc.', assetType: 'CEDEAR', sector: 'Consumo', beta: 1.6 },
  { ticker: 'BABA', name: 'Alibaba Group', assetType: 'CEDEAR', sector: 'Consumo', beta: 0.5 },
  { ticker: 'KO', name: 'Coca-Cola Co.', assetType: 'CEDEAR', sector: 'Consumo', beta: 0.55 },
  { ticker: 'PEP', name: 'PepsiCo Inc.', assetType: 'CEDEAR', sector: 'Consumo', beta: 0.5 },
  { ticker: 'WMT', name: 'Walmart Inc.', assetType: 'CEDEAR', sector: 'Consumo', beta: 0.5 },
  { ticker: 'PG', name: 'Procter & Gamble', assetType: 'CEDEAR', sector: 'Consumo', beta: 0.4 },
  { ticker: 'COST', name: 'Costco Wholesale', assetType: 'CEDEAR', sector: 'Consumo', beta: 0.75 },
  { ticker: 'TM', name: 'Toyota Motor Corp.', assetType: 'CEDEAR', sector: 'Consumo', beta: 0.6 },
  { ticker: 'JD', name: 'JD.com Inc.', assetType: 'CEDEAR', sector: 'Consumo', beta: 0.6 },
  { ticker: 'NIO', name: 'NIO Inc.', assetType: 'CEDEAR', sector: 'Consumo', beta: 2.2 },
  { ticker: 'PDD', name: 'PDD Holdings (Pinduoduo)', assetType: 'CEDEAR', sector: 'Consumo', beta: 0.7 },
  { ticker: 'ABNB', name: 'Airbnb Inc.', assetType: 'CEDEAR', sector: 'Consumo', beta: 1.2 },
  { ticker: 'BKNG', name: 'Booking Holdings', assetType: 'CEDEAR', sector: 'Consumo', beta: 1.2 },

  // ---------------- CEDEARs: Financiero ----------------
  { ticker: 'JPM', name: 'JPMorgan Chase', assetType: 'CEDEAR', sector: 'Financiero', beta: 1.1 },
  { ticker: 'BAC', name: 'Bank of America', assetType: 'CEDEAR', sector: 'Financiero', beta: 1.3 },
  { ticker: 'GS', name: 'Goldman Sachs', assetType: 'CEDEAR', sector: 'Financiero', beta: 1.3 },
  { ticker: 'V', name: 'Visa Inc.', assetType: 'CEDEAR', sector: 'Financiero', beta: 1.0 },
  { ticker: 'MA', name: 'Mastercard Inc.', assetType: 'CEDEAR', sector: 'Financiero', beta: 1.1 },
  { ticker: 'C', name: 'Citigroup Inc.', assetType: 'CEDEAR', sector: 'Financiero', beta: 1.5 },
  { ticker: 'WFC', name: 'Wells Fargo', assetType: 'CEDEAR', sector: 'Financiero', beta: 1.1 },
  { ticker: 'BRK.B', name: 'Berkshire Hathaway', assetType: 'CEDEAR', sector: 'Financiero', beta: 0.85 },
  { ticker: 'PYPL', name: 'PayPal Holdings', assetType: 'CEDEAR', sector: 'Financiero', beta: 1.4 },
  { ticker: 'AXP', name: 'American Express', assetType: 'CEDEAR', sector: 'Financiero', beta: 1.2 },
  { ticker: 'SPGI', name: 'S&P Global Inc.', assetType: 'CEDEAR', sector: 'Financiero', beta: 1.1 },
  { ticker: 'SCHW', name: 'Charles Schwab Corp.', assetType: 'CEDEAR', sector: 'Financiero', beta: 1.2 },

  // ---------------- CEDEARs: Salud ----------------
  { ticker: 'JNJ', name: 'Johnson & Johnson', assetType: 'CEDEAR', sector: 'Salud', beta: 0.5 },
  { ticker: 'PFE', name: 'Pfizer Inc.', assetType: 'CEDEAR', sector: 'Salud', beta: 0.55 },
  { ticker: 'MRK', name: 'Merck & Co.', assetType: 'CEDEAR', sector: 'Salud', beta: 0.4 },
  { ticker: 'ABBV', name: 'AbbVie Inc.', assetType: 'CEDEAR', sector: 'Salud', beta: 0.6 },
  { ticker: 'UNH', name: 'UnitedHealth Group', assetType: 'CEDEAR', sector: 'Salud', beta: 0.6 },
  { ticker: 'LLY', name: 'Eli Lilly and Co.', assetType: 'CEDEAR', sector: 'Salud', beta: 0.4 },
  { ticker: 'BMY', name: 'Bristol-Myers Squibb', assetType: 'CEDEAR', sector: 'Salud', beta: 0.4 },
  { ticker: 'ABT', name: 'Abbott Laboratories', assetType: 'CEDEAR', sector: 'Salud', beta: 0.7 },
  { ticker: 'TMO', name: 'Thermo Fisher Scientific', assetType: 'CEDEAR', sector: 'Salud', beta: 0.9 },
  { ticker: 'DHR', name: 'Danaher Corp.', assetType: 'CEDEAR', sector: 'Salud', beta: 0.9 },
  { ticker: 'CVS', name: 'CVS Health Corp.', assetType: 'CEDEAR', sector: 'Salud', beta: 0.7 },
  { ticker: 'MDT', name: 'Medtronic plc', assetType: 'CEDEAR', sector: 'Salud', beta: 0.7 },
  { ticker: 'ISRG', name: 'Intuitive Surgical', assetType: 'CEDEAR', sector: 'Salud', beta: 1.1 },

  // ---------------- CEDEARs: Industrial ----------------
  { ticker: 'BA', name: 'Boeing Co.', assetType: 'CEDEAR', sector: 'Industrial', beta: 1.4 },
  { ticker: 'CAT', name: 'Caterpillar Inc.', assetType: 'CEDEAR', sector: 'Industrial', beta: 1.1 },
  { ticker: 'GE', name: 'General Electric', assetType: 'CEDEAR', sector: 'Industrial', beta: 1.1 },
  { ticker: 'HON', name: 'Honeywell Intl.', assetType: 'CEDEAR', sector: 'Industrial', beta: 0.9 },
  { ticker: 'MMM', name: '3M Co.', assetType: 'CEDEAR', sector: 'Industrial', beta: 1.0 },
  { ticker: 'FDX', name: 'FedEx Corp.', assetType: 'CEDEAR', sector: 'Industrial', beta: 1.1 },
  { ticker: 'LMT', name: 'Lockheed Martin', assetType: 'CEDEAR', sector: 'Industrial', beta: 0.6 },
  { ticker: 'RTX', name: 'RTX Corp. (Raytheon)', assetType: 'CEDEAR', sector: 'Industrial', beta: 0.9 },
  { ticker: 'DE', name: 'Deere & Co.', assetType: 'CEDEAR', sector: 'Industrial', beta: 1.0 },

  // ---------------- CEDEARs: Energía ----------------
  { ticker: 'XOM', name: 'Exxon Mobil Corp.', assetType: 'CEDEAR', sector: 'Energía', beta: 0.9 },
  { ticker: 'CVX', name: 'Chevron Corp.', assetType: 'CEDEAR', sector: 'Energía', beta: 1.0 },
  { ticker: 'PBR', name: 'Petrobras', assetType: 'CEDEAR', sector: 'Energía', beta: 1.3 },

  // ---------------- CEDEARs: Materiales ----------------
  { ticker: 'VALE', name: 'Vale S.A.', assetType: 'CEDEAR', sector: 'Materiales', beta: 1.1 },
  { ticker: 'FCX', name: 'Freeport-McMoRan', assetType: 'CEDEAR', sector: 'Materiales', beta: 1.8 },
  { ticker: 'NEM', name: 'Newmont Corp.', assetType: 'CEDEAR', sector: 'Materiales', beta: 0.4 },
  { ticker: 'GOLD', name: 'Barrick Gold Corp.', assetType: 'CEDEAR', sector: 'Materiales', beta: 0.4 },

  // ---------------- Acciones argentinas: Financiero ----------------
  { ticker: 'GGAL', name: 'Grupo Financiero Galicia', assetType: 'ACCION_AR', sector: 'Financiero', beta: 1.7 },
  { ticker: 'BMA', name: 'Banco Macro', assetType: 'ACCION_AR', sector: 'Financiero', beta: 1.7 },
  { ticker: 'SUPV', name: 'Grupo Supervielle', assetType: 'ACCION_AR', sector: 'Financiero', beta: 1.9 },
  { ticker: 'BBAR', name: 'BBVA Banco Francés', assetType: 'ACCION_AR', sector: 'Financiero', beta: 1.7 },
  { ticker: 'VALO', name: 'Grupo Financiero Valores', assetType: 'ACCION_AR', sector: 'Financiero', beta: 1.3 },
  { ticker: 'BYMA', name: 'Bolsas y Mercados Argentinos', assetType: 'ACCION_AR', sector: 'Financiero', beta: 1.0 },

  // ---------------- Acciones argentinas: Energía ----------------
  { ticker: 'YPFD', name: 'YPF S.A.', assetType: 'ACCION_AR', sector: 'Energía', beta: 1.7 },
  { ticker: 'PAMP', name: 'Pampa Energía', assetType: 'ACCION_AR', sector: 'Energía', beta: 1.6 },
  { ticker: 'CEPU', name: 'Central Puerto', assetType: 'ACCION_AR', sector: 'Energía', beta: 1.4 },

  // ---------------- Acciones argentinas: Utilities ----------------
  { ticker: 'TGSU2', name: 'Transportadora Gas del Sur', assetType: 'ACCION_AR', sector: 'Utilities', beta: 1.1 },
  { ticker: 'TGNO4', name: 'Transportadora Gas del Norte', assetType: 'ACCION_AR', sector: 'Utilities', beta: 1.0 },
  { ticker: 'EDN', name: 'Edenor', assetType: 'ACCION_AR', sector: 'Utilities', beta: 1.5 },
  { ticker: 'TRAN', name: 'Transener', assetType: 'ACCION_AR', sector: 'Utilities', beta: 1.1 },
  { ticker: 'DGCU2', name: 'Distribuidora de Gas Cuyana', assetType: 'ACCION_AR', sector: 'Utilities', beta: 0.9 },

  // ---------------- Acciones argentinas: Materiales ----------------
  { ticker: 'TXAR', name: 'Ternium Argentina', assetType: 'ACCION_AR', sector: 'Materiales', beta: 1.3 },
  { ticker: 'ALUA', name: 'Aluar', assetType: 'ACCION_AR', sector: 'Materiales', beta: 1.2 },
  { ticker: 'LOMA', name: 'Loma Negra', assetType: 'ACCION_AR', sector: 'Materiales', beta: 1.3 },

  // ---------------- Acciones argentinas: Real Estate ----------------
  { ticker: 'CRES', name: 'Cresud', assetType: 'ACCION_AR', sector: 'Real Estate', beta: 1.4 },
  { ticker: 'IRSA', name: 'IRSA Inversiones y Representaciones', assetType: 'ACCION_AR', sector: 'Real Estate', beta: 1.5 },
  { ticker: 'IRCP', name: 'IRSA Propiedades Comerciales', assetType: 'ACCION_AR', sector: 'Real Estate', beta: 1.3 },

  // ---------------- Acciones argentinas: Industrial ----------------
  { ticker: 'COME', name: 'Sociedad Comercial del Plata', assetType: 'ACCION_AR', sector: 'Industrial', beta: 1.5 },
  { ticker: 'MIRG', name: 'Mirgor', assetType: 'ACCION_AR', sector: 'Industrial', beta: 1.5 },

  // ---------------- Acciones argentinas: Comunicación ----------------
  { ticker: 'TECO2', name: 'Telecom Argentina', assetType: 'ACCION_AR', sector: 'Comunicación', beta: 1.1 },
  { ticker: 'CVH', name: 'Cablevisión Holding', assetType: 'ACCION_AR', sector: 'Comunicación', beta: 1.2 },
]

export const PORTFOLIO_ASSET_BY_TICKER = Object.fromEntries(
  PORTFOLIO_ASSET_CATALOG.map((a) => [a.ticker, a])
)

// Catálogo agrupado por sector, ordenado alfabéticamente dentro de cada
// grupo (queda disponible por si en el futuro se vuelve a usar un selector
// con catálogo; hoy el campo Ticker del formulario es manual).
export function getCatalogGroupedBySector() {
  const bySector = {}
  for (const asset of PORTFOLIO_ASSET_CATALOG) {
    if (!bySector[asset.sector]) bySector[asset.sector] = []
    bySector[asset.sector].push(asset)
  }
  return Object.entries(bySector)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([sector, items]) => ({
      sector,
      items: [...items].sort((a, b) => a.ticker.localeCompare(b.ticker)),
    }))
}
