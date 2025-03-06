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
    // Weitere Timeframes können für Backtesting genutzt werden
  },
  // Indikatorparameter
  fastEMA: 8,        // Schneller EMA (Einstieg/Pullback)
  slowEMA: 21,       // Langsamer EMA (Trendfilter)
  macdShort: 12,
  macdLong: 26,
  macdSignal: 9,
  rsiPeriod: 14,
  // RSI-Schwellen (optional, hier als zusätzlicher Filter)
  rsiBuyThreshold: 30,   // LONG: RSI < 30
  rsiSellThreshold: 70,  // SHORT: RSI > 70
  // Feste SL/TP als Fallback
  stopLossPips: 5,
  takeProfitPips: 10,
  riskPerTrade: 0.02, // 2% Risiko pro Trade
  // Dynamische SL/TP via ATR
  atrMultiplierSL: 1.5,
  atrMultiplierTP: 2.0,
  // Bollinger-Band-Parameter (für erweiterte Strategie)
  bbPeriod: 20,
  bbMultiplier: 2,
  // Pullback: Maximale Abweichung zum schnellen EMA (z.B. 0,25%)
  maxDistancePct: 0.0025,
  // Backtesting-Parameter
  maxTradeDurationCandles: 10,
  maxDrawdownPctLimit: 20,
  minRR: 2.0,
};

module.exports = { CONFIG };
