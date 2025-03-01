// 1. Configuration
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
  fastEMA: 8, // Schneller EMA (für Pullback und Einstieg)
  slowEMA: 21, // Langsamer EMA (Trendfilter)
  macdShort: 12,
  macdLong: 26,
  macdSignal: 9,
  rsiPeriod: 14,
  // Neue RSI-Schwellen
  rsiBuyThreshold: 30, // LONG: RSI < 30
  rsiSellThreshold: 70, // SHORT: RSI > 70
  stopLossPips: 5, // Feste Stop-Loss-Pips als Fallback
  takeProfitPips: 10, // Feste Take-Profit-Pips als Fallback
  riskPerTrade: 0.02, // 2% Risiko pro Trade
  // Dynamische SL/TP via ATR
  atrMultiplierSL: 1.5,
  atrMultiplierTP: 2.0,
  // Pullback-Bedingung: Maximal erlaubte Abweichung zum schnellen EMA (z.B. 0,25%)
  maxDistancePct: 0.0025,
  // Backtesting-Parameter
  maxTradeDurationCandles: 10,
  maxDrawdownPctLimit: 20,
  minRR: 2.0,
};

module.exports = { CONFIG };