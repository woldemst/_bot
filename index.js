require("dotenv").config();

const XAPI = require("xapi-node").default;
const { TYPE_FIELD, CMD_FIELD } = XAPI;

// 1. Konfiguration
const CONFIG = {
  symbols: {
    EURUSD: "EURUSD",
    GBPUSD: "GBPUSD",
    // USDJPY: "USDJPY",
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
  fastMA: 5, // Fast Moving Average Periode für kurzfristige Signale
  slowMA: 20, // Slow Moving Average Periode für Trendbestätigung
  stopLossPips: 20, // Stop-Loss in Pips
  takeProfitPips: 40, // Take-Profit in Pips
  riskPerTrade: 0.02, // Risiko pro Trade (2% des Kontos)
};
// Pip-Wert für EURUSD: Für 0.01 Lot ca. 0.1 € pro Pip (kann variieren)
const pipValue = 0.1;

// 2. Authentifizierung mit XAPI
const x = new XAPI({
  accountId: process.env.DEMO_ACCOUNT_ID,
  password: process.env.DEMO_PASSWORD,
  type: "demo",
});

const socketId = x.Socket.getSocketId();
let currentBalance = null;
let currentTrades = [];

// Kontostand (wird über den Balance-Stream aktualisiert)
const getAccountBalance = async () => {
  if (currentBalance !== null) {
    return currentBalance;
  } else {
    console.error("Balance noch nicht verfügbar!");
    return null;
  }
};

// Berechnung einfacher und exponentieller gleitender Durchschnitte
function calculateSMA(prices, period) {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  return slice.reduce((sum, price) => sum + price, 0) / period;
}

function calculateEMA(prices, period) {
  if (prices.length < period) return null;
  const k = 2 / (period + 1);
  let ema = calculateSMA(prices.slice(0, period), period);
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

// connect to XAPI
const connect = async () => {
  try {
    await x.connect();
    console.log("Connection established");
  } catch (error) {
    console.error("Error:", error);
    throw error;
  }
};

// // Funktion, um historische Daten (Candles) abzurufen
// const getHistoricalData = async (symbol, timeframe) => {
//   try {
//     const result = await x.getPriceHistory({
//       symbol: symbol,
//       period: timeframe,
//     });
//     if (result && result.candles) {
//       return result.candles;
//     }
//     return [];
//   } catch (err) {
//     console.error("Promise-Fehler in getHistoricalData:", err);
//     return []; // Rückgabe eines leeren Arrays, um Abstürze zu vermeiden
//   }
// };
// Abrufen historischer Daten (Candles)
const getHistoricalData = async (symbol, timeframe) => {
  try {
    const result = await x.getPriceHistory({ symbol, period: timeframe });
    return result && result.candles ? result.candles : [];
  } catch (err) {
    console.error("Error in getHistoricalData:", err);
    return [];
  }
};

// Abrufen des aktuellen Preises anhand der letzten Kerze im M1-TF
const getCurrentPrice = async (symbol) => {
  const candles = await getHistoricalData(symbol, CONFIG.timeframe.M1);
  if (candles.length === 0) return null;
  const closes = candles.map((c) => c.close);
  return closes[closes.length - 1];
};

// Normalisierungsfunktion: Wandelt Rohwerte in den tatsächlichen Preis um
function normalizePrice(symbol, rawPrice) {
  // Für JPY-Paare: Dividiere durch 1000, sonst durch 100000
  const factor = symbol.includes("JPY") ? 1000 : 100000;
  return parseFloat((rawPrice / factor).toFixed(5));
}

function getPipMultiplier(symbol) {
  return symbol.includes("JPY") ? 0.01 : 0.0001;
}

// Handelssignal basierend auf EMA
const checkSignalForSymbol = async (symbol, timeframe, fastPeriod, slowPeriod) => {
  const candles = await getHistoricalData(symbol, timeframe);
  if (candles.length === 0) {
    console.error(`No data for ${symbol}`);
    return null;
  }
  const closes = candles.map((candle) => candle.close);
  const emaFast = calculateEMA(closes, fastPeriod);
  const emaSlow = calculateEMA(closes, slowPeriod);
  const lastPrice = closes[closes.length - 1];
  console.log(
    `[${symbol} - TF ${timeframe}] emaFast=${emaFast}, emaSlow=${emaSlow}, rawLastPrice=${lastPrice}`
  );
  return emaFast > emaSlow
    ? { signal: "BUY", rawPrice: lastPrice }
    : { signal: "SELL", rawPrice: lastPrice };
};

// Multi-Timeframe-Analyse: Prüfe Signale für M1, M15 und H1
const checkMultiTimeframeSignal = async (symbol) => {
  const signalM1 = await checkSignalForSymbol(
    symbol,
    CONFIG.timeframe.M1,
    CONFIG.fastMA,
    CONFIG.slowMA
  );
  const signalM15 = await checkSignalForSymbol(
    symbol,
    CONFIG.timeframe.M15,
    CONFIG.fastMA,
    CONFIG.slowMA
  );
  const signalH1 = await checkSignalForSymbol(
    symbol,
    CONFIG.timeframe.H1,
    CONFIG.fastMA,
    CONFIG.slowMA
  );
  if (!signalM1 || !signalM15 || !signalH1) {
    console.error(`Not enough data for ${symbol}`);
    return null;
  }
  if (signalM1.signal === signalM15.signal && signalM15.signal === signalH1.signal) {
    return { signal: signalM1.signal, rawPrice: signalM1.rawPrice };
  }
  return null;
};

// Berechnung der Lot-Größe (unter Verwendung des korrekten Pip-Multiplikators)
function calculatePositionSize(accountBalance, riskPerTrade, stopLossPips, symbol) {
  const pipMultiplier = getPipMultiplier(symbol);
  const riskAmount = accountBalance * riskPerTrade;
  return riskAmount / (stopLossPips * pipMultiplier);
}

async function modifyTradeStopLoss(tradeId, newSL) {
  try {
    const result = await x.Socket.send.tradeTransaction({
      cmd: 2, // Modify command
      tradeTransInfo: { tradeId, sl: newSL },
    });
    console.log("Trade modified:", result);
  } catch (err) {
    console.error("Failed to modify trade:", err);
  }
}

// Trailing Stop Logik: Überwacht den Preis und passt den Stop Loss an, wenn sich der Markt zugunsten des Trades bewegt.
function applyTrailingStop(tradeId, symbol, direction, entry) {
  const pipMultiplier = getPipMultiplier(symbol);
  const trailingPips = 10; // Beispiel: 10 Pips trailing
  const trailingDistance = trailingPips * pipMultiplier;
  const checkInterval = 5000; // Prüfe alle 5 Sekunden

  const intervalId = setInterval(async () => {
    try {
      const currentPrice = await getCurrentPrice(symbol);
      if (currentPrice == null) return;
      if (direction === "BUY") {
        if (currentPrice > entry + trailingDistance) {
          const newSL = currentPrice - trailingDistance;
          console.log(`Trailing stop update for trade ${tradeId}: new SL = ${newSL}`);
          await modifyTradeStopLoss(tradeId, newSL);
        }
      } else {
        if (currentPrice < entry - trailingDistance) {
          const newSL = currentPrice + trailingDistance;
          console.log(`Trailing stop update for trade ${tradeId}: new SL = ${newSL}`);
          await modifyTradeStopLoss(tradeId, newSL);
        }
      }
    } catch (err) {
      console.error("Error in trailing stop check:", err);
    }
  }, checkInterval);
  return intervalId;
}

// **Wichtig:** Für BUY-Orders fügen wir den Spread hinzu, für SELL-Orders NICHT.
// Dadurch entspricht der Entry-Preis bei SELL-Orders dem Candle-Preis (der Marktpreis).
async function executeTradeForSymbol(symbol, direction, rawPrice, lotSize) {
  const pipMultiplier = getPipMultiplier(symbol);
  const factor = symbol.includes("JPY") ? 1000 : 100000;
  const spreadRaw = 0.0002 * factor;

  // Für BUY: Spread addieren, für SELL: keinen Spread berücksichtigen
  const rawEntry = direction === "BUY" ? rawPrice + spreadRaw : rawPrice;

  const entry = normalizePrice(symbol, rawEntry);
  const slRaw =
    direction === "BUY"
      ? rawEntry - CONFIG.stopLossPips * (pipValue * factor)
      : rawEntry + CONFIG.stopLossPips * (pipValue * factor);
  const tpRaw =
    direction === "BUY"
      ? rawEntry + CONFIG.takeProfitPips * (pipValue * factor)
      : rawEntry - CONFIG.takeProfitPips * (pipValue * factor);
  const sl = normalizePrice(symbol, slRaw);
  const tp = normalizePrice(symbol, tpRaw);

  console.log(`Executing ${direction} trade for ${symbol}: entry=${entry}, SL=${sl}, TP=${tp}`);

  try {
    const order = await x.Socket.send.tradeTransaction({
      cmd: direction === "BUY" ? 0 : 1, // 0 = BUY, 1 = SELL
      customComment: `Scalping Bot Order for ${symbol}`,
      expiration: Date.now() + 3600000, // 1 Stunde Gültigkeit
      offset: 0,
      order: 0,
      price: entry,
      sl: sl,
      tp: tp,
      symbol: symbol,
      type: 0,
      volume: lotSize,
    });
    console.log(`${direction} order executed for ${symbol} at ${entry}, order:`, order);
  } catch (error) {
    console.error(`Failed to execute ${direction} trade for ${symbol}:`, error);
  }
}

// Funktion, um offene Positionen abzurufen
async function getOpenPositionsCount() {
  try {
    x.Stream.listen.getTrades((data) => {
      console.log("Open positions:", data);
      return data;
    });
  } catch (error) {
    console.error("Error fetching open positions:", error);
    return 0;
  }
}

// // Funktion, um offene Positionen (als Promise) abzurufen
// async function getOpenPositionsCount() {
//   return new Promise((resolve) => {
//     x.Stream.listen.getTrades((data) => {
//       console.log("Open positions update:", data);
//       resolve(Array.isArray(data) ? data.length : 0);
//     });
//   }).catch((err) => {
//     console.error("Error fetching open positions:", err);
//     return 0;
//   });
// }

/// Für jedes Symbol prüfen und ggf. einen Trade auslösen
async function checkAndTradeForSymbol(symbol) {
  const signalData = await checkMultiTimeframeSignal(symbol);
  if (!signalData) {
    console.log(`No consistent multi-timeframe signal for ${symbol}`);
    return;
  }
  console.log(`Signal for ${symbol}: ${signalData.signal} at raw price ${signalData.rawPrice}`);

  const openPositions = await getOpenPositionsCount();
  if (openPositions >= 5) {
    console.log(`Max open positions reached (${openPositions}). No new trade for ${symbol}.`);
    return;
  }

  const balance = await getAccountBalance();
  if (!balance) {
    console.error("Couldn't check balance!");
    return;
  }

  const positionSize = calculatePositionSize(
    balance,
    CONFIG.riskPerTrade,
    CONFIG.stopLossPips,
    symbol
  );
  console.log(`Placing ${signalData.signal} trade for ${symbol} with lot size: ${positionSize}`);
  await executeTradeForSymbol(symbol, signalData.signal, signalData.rawPrice, positionSize);
}

// Iteriere über alle definierten Symbole und prüfe einzeln
async function checkAllPairsAndTrade() {
  for (let symbol of Object.values(CONFIG.symbols)) {
    await checkAndTradeForSymbol(symbol);
  }
}

const tick = async () => {
  x.Stream.listen.getTickPrices((data) => {
    console.log("gotten:", data);
    return data;
  });
};

// main function
const startBot = async () => {
  try {
    await connect();

    // Streams abonnieren
    x.Stream.subscribe
      .getBalance()
      .then(() => console.log("Balance-Stream abonniert"))
      .catch((err) => console.error("Fehler beim Abonnieren des Balance-Streams:", err));
    x.Stream.subscribe
      .getTickPrices("EURUSD")
      .catch(() => console.error("subscribe for EURUSD failed"));
    x.Stream.subscribe
      .getTrades()
      .then(() => console.log("Trades-Stream abonniert"))
      .catch((err) => console.error("Fehler beim Abonnieren des Trades-Streams:", err));

    // register listener
    x.Stream.listen.getBalance((data) => {
      if (data && data.balance !== undefined) {
        currentBalance = data.balance;
        console.log("Balance updated:", currentBalance);
      } else {
        console.error("Ungültige Balance-Daten:", data);
      }
    });

    x.Stream.listen.getTrades((data) => {
      if (data) {
        console.log("trades:", data);
      } else {
        console.error("no trades data:", data);
      }
    });

    // await tick(); // get tick prices

    setInterval(async () => {
      await checkAllPairsAndTrade();
    }, 60000); // 60000

    const historicalData = await getHistoricalData(CONFIG.symbols.EURUSD, CONFIG.timeframe.M1);

    // console.log(historicalData);
    if (historicalData.length === 0) {
      console.log(historicalData);
      console.error("No historical data downloaded!");
      return;
    }

    // extract close prices of the candles

    const closes = historicalData.map((candle) => candle.close);

    console.log("Historical data loaded:", closes.length, "candles");

    console.log("Bot läuft...");
  } catch (error) {
    console.error("Error:", error);
    throw error;
  } finally {
    // await x.disconnect();
    // console.log("Disconnected");
  }
};

startBot();

// calulate SMA und EMA für eine Periode, z. B. 20 Perioden (slowMA)
// const smaSlow = calculateSMA(closes, CONFIG.slowMA);
// const emaSlow = calculateEMA(closes, CONFIG.slowMA);

// // calulate fast Moving Average (z. B. 5 Perioden)
// const smaFast = calculateSMA(closes, CONFIG.fastMA);
// const emaFast = calculateEMA(closes, CONFIG.fastMA);

// console.log(
//   `SMA (slow, ${CONFIG.slowMA}): ${smaSlow}, EMA (slow, ${CONFIG.slowMA}): ${emaSlow}`
// );
// console.log(
//   `SMA (fast, ${CONFIG.fastMA}): ${smaFast}, EMA (fast, ${CONFIG.fastMA}): ${emaFast}`
// );

// Hier kannst du weitere Logik hinzufügen, um anhand der Durchschnittswerte Handelsentscheidungen zu treffen
