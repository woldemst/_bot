// config.js
const CONFIG = {
  symbols: {
    EURUSD: "EURUSD",
    GBPUSD: "GBPUSD",
    AUDUSD: "AUDUSD",
    EURGBP: "EURGBP",
  },
  timeframe: {
    M1: 1,
    M15: 15,
    H1: 60,
  },
  fastMA: 5,      // Fast EMA period
  slowMA: 20,     // Indicator parameter
  fastEMA: 8,     // Fast EMA (Entry/Pullback)
  slowEMA: 21,    // Slow EMA (Trend filter)
  macdShort: 12,
  macdLong: 26,
  macdSignal: 9,
  rsiPeriod: 14,
  // RSI thresholds (optional, used as additional filter)
  rsiBuyThreshold: 30,   // LONG: RSI < 30
  rsiSellThreshold: 70,  // SHORT: RSI > 70
  // Fixed SL/TP as fallback
  stopLossPips: 5,
  takeProfitPips: 10,
  riskPerTrade: 0.02, // 2% risk per trade
  // Dynamic SL/TP via ATR
  atrMultiplierSL: 1.5,
  atrMultiplierTP: 2.0,
  // Bollinger Bands parameters (for advanced strategy)
  bbPeriod: 20,
  bbMultiplier: 2,
  // Pullback: Maximum deviation from fast EMA (e.g., 0.25%)
  maxDistancePct: 0.0025,
  // Backtesting parameters
  maxTradeDurationCandles: 10,
  maxDrawdownPctLimit: 20,
  minRR: 2.0,
  initialCapital: 500,
};

module.exports = { CONFIG };