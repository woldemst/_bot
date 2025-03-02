//indicators.js
const CONFIG = {
  macdShort: 12,
  macdLong: 26,
  macdSignal: 9,
  rsiPeriod: 14,
};
// Einfacher gleitender Durchschnitt
const calculateSMA = (prices, period) => {
  if (prices.length < period) return null;
  return prices.slice(-period).reduce((sum, price) => sum + price, 0) / period;
};

// Exponentieller gleitender Durchschnitt
const calculateEMA = (prices, period) => {
  if (prices.length < period) return null;
  const k = 2 / (period + 1);
  let ema = calculateSMA(prices.slice(0, period), period);
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
};

// MACD-Berechnung (Standard: 12, 26, 9)
const calculateMACD = (prices, shortPeriod = CONFIG.macdShort, longPeriod = CONFIG.macdLong, signalPeriod = CONFIG.macdSignal) => {
  let macdValues = [];
  for (let i = longPeriod - 1; i < prices.length; i++) {
    const shortSlice = prices.slice(i - shortPeriod + 1, i + 1);
    const longSlice = prices.slice(i - longPeriod + 1, i + 1);
    const emaShort = calculateEMA(shortSlice, shortPeriod);
    const emaLong = calculateEMA(longSlice, longPeriod);
    macdValues.push(emaShort - emaLong);
  }
  const signalLine = calculateEMA(macdValues, signalPeriod);
  const histogram = macdValues[macdValues.length - 1] - signalLine;
  return { macdLine: macdValues[macdValues.length - 1], signalLine, histogram };
};

// RSI-Berechnung (Standardperiode 14)
const calculateRSI = (prices, period = CONFIG.rsiPeriod) => {
  if (prices.length < period + 1) return null;
  let gains = 0,
    losses = 0;
  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
};

// ATR-Berechnung (Average True Range, Standardperiode 14)
const calculateATR = (candles, period = 14) => {
  if (candles.length < period + 1) return null;
  let trs = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trs.push(tr);
  }
  return calculateSMA(trs, period);
};

module.exports = { calculateSMA, calculateEMA, calculateMACD, calculateRSI, calculateATR };
