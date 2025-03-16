// index.js
require("dotenv").config();
const { x, connectXAPI, getSocketId } = require("./xapi.js");

const { calculateSMA, calculateEMA, calculateMACD, calculateRSI, calculateATR, calculateBollingerBands } = require("./indicators");
const { backtestStrategy } = require("./backtesting");
const { CONFIG } = require("./config");

// Globales Handling von unhandledRejections
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

let currentBalance = null; // Wird aktualisiert
let currentTrades = []; // Wird über den Trade-Stream aktualisiert

// Dynamische SL/TP-Berechnung mit ATR
const calculateDynamicSLTP = (entryRaw, atr, isBuy) => {
  const slDistance = atr * CONFIG.atrMultiplierSL;
  const tpDistance = atr * CONFIG.atrMultiplierTP;
  return isBuy ? { sl: entryRaw - slDistance, tp: entryRaw + tpDistance } : { sl: entryRaw + slDistance, tp: entryRaw - tpDistance };
};
async function getAccountBalance() {
  if (currentBalance !== null) {
    return currentBalance;
  }
  // Warte solange, bis currentBalance aktualisiert wurde (ohne Timeout-Rejection)
  return new Promise((resolve) => {
    const interval = setInterval(() => {
      if (currentBalance !== null) {
        clearInterval(interval);
        resolve(currentBalance);
      }
    }, 500);
  });
}

const getHistoricalData = async (symbol, timeframe) => {
  try {
    const result = await x.getPriceHistory({ symbol, period: timeframe, socketId: getSocketId() });
    if (result && result.candles) {
      // Normalisiere close, high und low für alle Kerzen
      return result.candles.map((candle) => ({
        close: normalizePrice(symbol, candle.close),
        high: normalizePrice(symbol, candle.high),
        low: normalizePrice(symbol, candle.low),
      }));
    } else {
      return [];
    }
  } catch (err) {
    console.error("Error in getHistoricalData:", err);
    return [];
  }
};

const getCurrentPrice = async (symbol) => {
  const candles = await getHistoricalData(symbol, CONFIG.timeframe.M1);
  if (candles.length === 0) return null;
  const closes = candles.map((c) => c.close);
  return closes[closes.length - 1];
};

// Normalisierungsfunktion: Wandelt Rohpreise in den tatsächlichen Kurs um
const normalizePrice = (symbol, rawPrice) => {
  const factor = symbol.includes("JPY") ? 1000 : 100000;
  return parseFloat((rawPrice / factor).toFixed(5));
};

const getPipMultiplier = (symbol) => {
  return symbol.includes("JPY") ? 0.01 : 0.0001;
};

const calculatePositionSize = (accountBalance, riskPerTrade, stopLossPips, symbol) => {
  const pipMultiplier = getPipMultiplier(symbol);
  const factor = symbol.includes("JPY") ? 1000 : 100000;
  const riskAmount = accountBalance * riskPerTrade;
  return riskAmount / (stopLossPips * (pipMultiplier * factor));
};

// --- Signal-Generierung ---
// Prüft das Handelssignal basierend auf EMA, Bollinger-Bändern und ATR
const checkSignalForSymbol = async (symbol, timeframe, fastPeriod, slowPeriod) => {
  const candles = await getHistoricalData(symbol, timeframe);
  if (!candles.length) {
    console.error(`No data for ${symbol}`);
    return null;
  }
  const closes = candles.map((c) => c.close);
  const fastEMA = calculateEMA(closes, fastPeriod);
  const slowEMA = calculateEMA(closes, slowPeriod);
  const lastPrice = closes[closes.length - 1];

  if (fastEMA > slowEMA) {
    return { signal: "BUY", rawPrice: lastPrice };
  } else if (fastEMA < slowEMA) {
    return { signal: "SELL", rawPrice: lastPrice };
  } else {
    return null;
  }
};

// --- Trendbestimmung auf M15 mittels MACD ---
const checkTrendM15 = async (symbol) => {
  const candles = await getHistoricalData(symbol, CONFIG.timeframe.M15);
  if (!candles.length) {
    console.error(`No M15 data for ${symbol}`);
    return null;
  }
  const closes = candles.map((c) => c.close);
  const macdResult = calculateMACD(closes);
  // Trendbestimmung: Histogram > 0 => BUY, sonst SELL
  const trend = macdResult.histogram > 0 ? "BUY" : "SELL";
  console.log(`M15 MACD Trend for ${symbol}: ${trend} (Histogram: ${macdResult.histogram.toFixed(5)})`);
  return trend;
}; // Multi-Timeframe-Analyse: Zusätzlich wird der H1-Trend (als Filter) geprüft
const checkMultiTimeframeSignal = async (symbol) => {
  const signalM1 = await checkSignalForSymbol(symbol, CONFIG.timeframe.M1, CONFIG.fastEMA, CONFIG.slowEMA);
  if (!signalM1) {
    console.error(`Not enough data or no valid signal for ${symbol} on M1`);
    return null;
  }
  // const trendM15 = await checkTrendM15(symbol);
  // if (!trendM15) return null;

  // if (signalM1.signal === trendM15) {
  //   return { signal: signalM1.signal, rawPrice: signalM1.rawPrice };
  // } else {
  //   console.log(`M1/M15 Conflict: ${signalM1.signal} vs ${trendM15}`);
  //   return null;
  // }

  // // Nur wenn das M1-Signal mit dem M15-Trend übereinstimmt, wird das Signal weitergereicht
  // if (signalM1.signal === trendM15) {
  //   console.log(`Consistent signal for ${symbol}: ${signalM1.signal}`);
  //   return { signal: signalM1.signal, rawPrice: signalM1.rawPrice };
  // } else {
  //   console.log(`Inconsistent signal for ${symbol}: M1=${signalM1.signal} vs. M15=${trendM15}`);
  //   return null;
  // }

  if (signalM1.signal) {
    return { signal: signalM1.signal, rawPrice: signalM1.rawPrice };
  }
  console.error(`Trens widerspricht dem M1 Signal für ${symbol}`);
  return null;
};

// --- Orderausführung ---
// Nutzt den normalisierten Preis, um Entry, SL und TP zu berechnen.
const executeTradeForSymbol = async (symbol, direction, rawPrice, lotSize) => {
  const spread = 0.0002; // Fester Spread in den gleichen Einheiten (z.B. EURUSD)
  // rawPrice ist bereits normalisiert (z.B. 1.09086)
  const entry = direction === "BUY" ? rawPrice + spread : rawPrice;

  // ATR-basierte dynamische SL/TP-Berechnung
  const candles = await getHistoricalData(symbol, CONFIG.timeframe.M1);
  const atr = calculateATR(candles.slice(-15));
  let sl, tp;
  if (atr) {
    const dynamic = calculateDynamicSLTP(entry, atr, direction === "BUY");
    sl = dynamic.sl;
    tp = dynamic.tp;
  } else {
    // Fallback: use fixed SL/TP values, directly in price units
    const rawSL = direction === "BUY" ? entry - CONFIG.stopLossPips * 0.0001 : entry + CONFIG.stopLossPips * 0.0001;
    const rawTP = direction === "BUY" ? entry + CONFIG.takeProfitPips * 0.0001 : entry - CONFIG.takeProfitPips * 0.0001;
    sl = rawSL;
    tp = rawTP;
  }

  console.log(`Executing ${direction} trade for ${symbol}: entry=${entry}, SL=${sl}, TP=${tp}`);

  try {
    const order = await x.Socket.send
      .tradeTransaction({
        cmd: direction === "BUY" ? 0 : 1,
        customComment: `Scalping Bot Order for ${symbol}`,
        expiration: Date.now() + 3600000,
        offset: 0,
        order: 0,
        price: entry,
        sl: sl,
        tp: tp,
        symbol: symbol,
        type: 0,
        volume: lotSize,
      })
      .catch((err) => {
        console.error("tradeTransaction error:", err);
        throw err;
      });
    console.log(`${direction} order executed for ${symbol} at ${entry}, order:`, order);
  } catch (error) {
    console.error(`Failed to execute ${direction} trade for ${symbol}:`, error);
  }
};

// Neue Funktion: Gibt die Anzahl offener Trades für ein bestimmtes Symbol zurück
const getOpenPositionsForSymbol = async (symbol) => {
  return new Promise((resolve) => {
    x.Stream.listen.getTrades((data) => {
      const trades = Array.isArray(data) ? data : [data];
      const openTradesForSymbol = trades.filter((t) => t && !t.closed && t.symbol === symbol);
      console.log(`Open positions for ${symbol}:`, openTradesForSymbol);
      resolve(openTradesForSymbol.length);
    });
  }).catch((err) => {
    console.error("Error fetching open positions for", symbol, ":", err);
    return 0;
  });
};

const getOpenPositionsCount = async () => {
  try {
    const trades = await new Promise((resolve) => {
      x.Stream.listen.getTrades((data) => {
        const trades = Array.isArray(data) ? data : [data];
        resolve(trades);
      });
    });
    const openTrades = trades.filter((t) => t && !t.closed);
    console.log("Open positions update:", openTrades);
    return openTrades.length;
  } catch (err) {
    console.error("Error fetching open positions:", err);
    return 0;
  }
};

// Pro Währungspaar nur ein Trade gleichzeitig
async function checkAndTradeForSymbol(symbol) {
  const signalData = await checkMultiTimeframeSignal(symbol);
  if (!signalData) {
    console.log(`No consistent multi-timeframe signal for ${symbol}`);
    return;
  }
  // console.log(`Signal for ${symbol}: ${signalData.signal} at raw price ${signalData.rawPrice}`);
  // const openPositionsForSymbol = await getOpenPositionsForSymbol(symbol);
  // if (openPositionsForSymbol >= 1) {
  //   console.log(`Trade for ${symbol} is already open. Skipping new trade.`);
  //   return;
  // }
  // const openPositions = await getOpenPositionsCount();
  // if (openPositions >= 5) {
  //   console.log(`Max open positions reached (${openPositions}). No new trade for ${symbol}.`);
  //   return;
  // }
  const currentRawPrice = await getCurrentPrice(symbol);
  console.log(`Current market price for ${symbol}: ${currentRawPrice}`);
  const balance = await getAccountBalance();
  if (!balance) {
    console.error("Couldn't check balance!");
    return;
  }
  const positionSize = calculatePositionSize(balance, CONFIG.riskPerTrade, CONFIG.stopLossPips, symbol);
  console.log(`Placing ${signalData.signal} trade for ${symbol} with lot size: ${positionSize}`);
  await executeTradeForSymbol(symbol, signalData.signal, currentRawPrice, positionSize);
}

// Iteriere über alle definierten Symbole und löse ggf. Trades aus
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
  n;
};

// --- Main function --- //
const startBot = async () => {
  try {
    await connectXAPI();

    // Streams abonnieren
    // x.Stream.subscribe.getTickPrices("EURUSD").catch(() => console.error("subscribe for EURUSD failed"));
    // x.Stream.subscribe
    //   .getTrades()
    //   .then(() => console.log("Trades-Stream abonniert"))
    //   .catch((err) => console.error("Fehler beim Abonnieren des Trades-Streams:", err));

    // x.Stream.subscribe
    //   .getBalance()
    //   .then(() => console.log("Balance-Stream abonniert"))
    //   .catch((err) => console.error("Fehler beim Abonnieren des Balance-Streams:", err));

    // Streams abonnieren
    await Promise.all([
      x.Stream.subscribe.getTickPrices("EURUSD").catch(() => console.error("subscribe for EURUSD failed")),
      x.Stream.subscribe
        .getTrades()
        .then(() => console.log("Trades-Stream abonniert"))
        .catch((err) => console.error("Fehler beim Abonnieren des Trades-Streams:", err)),
      x.Stream.subscribe
        .getBalance()
        .then(() => console.log("Balance-Stream abonniert"))
        .catch((err) => console.error("Fehler beim Abonnieren des Balance-Streams:", err)),
    ]);
    // Listener registrieren
    x.Stream.listen.getTrades((data) => {
      if (data) {
        // Optional: hier können Trade-Daten geloggt werden
      } else {
        console.error("no trades data:", data);
      }
    });
    x.Stream.listen.getBalance((data) => {
      if (data && data.balance !== undefined) {
        currentBalance = data.balance;
        // console.log("Balance updated:", currentBalance);
      } else {
        console.error("Ungültige Balance-Daten:", data);
      }
    });

    // Warten, bis ein Balance-Wert vorliegt
    const initialBalance = await getAccountBalance();
    // console.log("Initial balance received:", initialBalance);
    
    // --- Backtesting für alle Paare ---
    await backtestStrategy(
      CONFIG.symbols.EURUSD, 
      CONFIG.timeframe.M1, 
      Math.floor(new Date("2025-01-14T00:00:00Z").getTime() / 1000), 
      Math.floor(new Date("2025-02-14T00:00:00Z").getTime() / 1000)
    );
    // setInterval(async () => {
    //   if (isMarketOpen()) {
    //     await checkAllPairsAndTrade();
    //   } else {
    //     console.log("Markt geschlossen. Handel wird nicht ausgeführt.");
    //   }
    // }, 10000);

    console.log("Bot läuft...");
  } catch (error) {
    console.error("Error:", error);
    throw error;
  }
};

const isMarketOpen = () => {
  const now = new Date();
  const day = now.getUTCDay();
  const hour = now.getUTCHours();

  // Forex Marktzeiten (UTC):
  // Sydney: 22:00-06:00
  // Tokyo: 00:00-09:00
  // London: 08:00-17:00
  // New York: 13:00-22:00
  return (
    day >= 1 &&
    day <= 5 &&
    (hour >= 22 ||
      hour < 6 || // Sydney
      (hour >= 0 && hour < 9) || // Tokyo
      (hour >= 8 && hour < 17) || // London
      (hour >= 13 && hour < 22)) // New York
  );
};
startBot();
