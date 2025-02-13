// config.js
module.exports = {
    CONFIG: {
      symbols: {
        EURUSD: "EURUSD",
        GBPUSD: "GBPUSD",
        USDJPY: "USDJPY",
        AUDUSD: "AUDUSD",
        EURGBP: "EURGBP",
      },
      timeframe: {
        M1: 1,
        M5: 5,
        M15: 15,
        H1: 60,
        H4: 240,
        D1: 1440,
      },
      fastMA: 5,         // Fast MA-Periode
      slowMA: 20,        // Slow MA-Periode
      stopLossPips: 20,  // Stop-Loss in Pips
      takeProfitPips: 40,// Take-Profit in Pips
      riskPerTrade: 0.02 // Risiko pro Trade (2% des Kontos)
    },
    pipValue: 0.1 // Pip-Wert (für 0.01 Lot, z. B. 0.1 € pro Pip)
  };
  