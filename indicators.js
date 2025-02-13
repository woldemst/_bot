// Berechnet den einfachen gleitenden Durchschnitt (SMA)
function calculateSMA(prices, period) {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  return slice.reduce((sum, price) => sum + price, 0) / period;
}

// Berechnet den exponentiellen gleitenden Durchschnitt (EMA)
function calculateEMA(prices, period) {
  if (prices.length < period) return null;
  const k = 2 / (period + 1);
  let ema = calculateSMA(prices.slice(0, period), period);
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

// Normalisiert einen Rohpreis (z.B. 83229 → 0.83229)
function normalizePrice(symbol, rawPrice) {
  // Für JPY-Paare: Dividiere durch 1000, sonst durch 100000
  const factor = symbol.includes("JPY") ? 1000 : 100000;
  return parseFloat((rawPrice / factor).toFixed(5));
}

// Gibt den Pip-Multiplikator zurück (0.01 für JPY, sonst 0.0001)
function getPipMultiplier(symbol) {
  return symbol.includes("JPY") ? 0.01 : 0.0001;
}

module.exports = { calculateSMA, calculateEMA, normalizePrice, getPipMultiplier };
