// indicators.js
const CONFIG = {
  macdShort: 12,
  macdLong: 26,
  macdSignal: 9,
  rsiPeriod: 14,
};

const calculateSMA = (prices, period) => {
  if (prices.length < period) return null;
  return prices.slice(-period).reduce((sum, price) => sum + price, 0) / period;
};

const calculateEMA = (prices, period) => {
  if (prices.length < period) return null;
  const k = 2 / (period + 1);
  let ema = calculateSMA(prices.slice(0, period), period);
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
};

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

const calculateATR = (candles, period = 14) => {
  if (candles.length < period + 1) return null;
  
  const trueRanges = [];
  
  // Calculate True Range for each candle
  for (let i = 1; i < candles.length; i++) {
    const prevClose = candles[i - 1].close;
    const { high, low } = candles[i];
    
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trueRanges.push(tr);
  }

  // Initial ATR as simple average
  let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
  
  // Smoothing of subsequent values
  for (let i = period; i < trueRanges.length; i++) {
    atr = ((atr * (period - 1)) + trueRanges[i]) / period;
  }

  return parseFloat(atr.toFixed(5));
};

const calculateBollingerBands = (prices, period, multiplier) => {
  if (prices.length < period) return null;
  const sma = calculateSMA(prices, period);
  const slice = prices.slice(-period);
  const squaredDiffs = slice.map((price) => Math.pow(price - sma, 2));
  const variance = calculateSMA(squaredDiffs, period);
  const stdDev = Math.sqrt(variance);
  const upperBand = sma + multiplier * stdDev;
  const lowerBand = sma - multiplier * stdDev;
  return { sma, upperBand, lowerBand };
};
const calculateRSI = (prices, period = 14) => {
  if (prices.length < period + 1) return null;
  
  // First period: calculate average gains and losses
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) {
      gains += change;
    } else {
      losses -= change; // change is negative
    }
  }
  
  let avgGain = gains / period;
  let avgLoss = losses / period;
  
  // Smoothing for subsequent periods
  for (let i = period + 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) {
      avgGain = ((avgGain * (period - 1)) + change) / period;
      avgLoss = ((avgLoss * (period - 1)) + 0) / period;
    } else {
      avgGain = ((avgGain * (period - 1)) + 0) / period;
      avgLoss = ((avgLoss * (period - 1)) - change) / period;
    }
  }
  
  // If avgLoss is 0, RSI is 100 (strong uptrend)
  if (avgLoss === 0) return 100;
  
  const rs = avgGain / avgLoss;
  const rsi = 100 - (100 / (1 + rs));
  return rsi;
};
module.exports = {
  calculateSMA,
  calculateEMA,
  calculateMACD,
  calculateRSI,
  calculateATR,
  calculateBollingerBands,
};
