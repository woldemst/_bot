// index.js
require("dotenv").config();
const { x, connectXAPI, getSocketId } = require("./xapi.js");
const { calculateEMA, calculateMACD, calculateATR } = require("./indicators");
const { CONFIG } = require("./config");

// Globales Handling von unhandledRejections
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

let currentBalance = null;
let currentTrades = [];

// Dynamische SL/TP-Berechnung mit ATR (wie im Backtesting)
const calculateDynamicSLTP = (entryRaw, atr, isBuy) => {
  const slDistance = atr * CONFIG.atrMultiplierSL;
  const tpDistance = atr * CONFIG.atrMultiplierTP;
  return isBuy ? { sl: entryRaw - slDistance, tp: entryRaw + tpDistance } : { sl: entryRaw + slDistance, tp: entryRaw - tpDistance };
};

async function getAccountBalance() {
  if (currentBalance !== null) return currentBalance;
  return new Promise((resolve) => {
    const interval = setInterval(() => {
      if (currentBalance !== null) {
        clearInterval(interval);
        resolve(currentBalance);
      }
    }, 500);
  });
}

// Normalisierungsfunktion (keine Änderung – erwartet numeric values)
const normalizePrice = (symbol, rawPrice) => {
  const factor = symbol.includes("JPY") ? 1000 : 100000;
  return parseFloat((rawPrice / factor).toFixed(5));
};

const getPipMultiplier = (symbol) => {
  return symbol.includes("JPY") ? 0.01 : 0.0001;
};

// Abrufen historischer Daten (Live-Daten)
const getHistoricalData = async (symbol, timeframe) => {
  try {
    const result = await x.getPriceHistory({
      symbol,
      period: timeframe,
      socketId: getSocketId(),
    });
    if (result && result.candles) {
      return result.candles.map((candle) => ({
        timestamp: candle.timestamp, // Zum Debuggen
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

const calculatePositionSize = (accountBalance, riskPerTrade, stopLossPips, symbol) => {
  const pipMultiplier = getPipMultiplier(symbol);
  const factor = symbol.includes("JPY") ? 1000 : 100000;
  const riskAmount = accountBalance * riskPerTrade;
  return riskAmount / (stopLossPips * (pipMultiplier * factor));
};

// Signal-Generierung (wie im Backtesting – EMA und MACD)
const generateSignal = async (symbol, timeframe) => {
  const candles = await getHistoricalData(symbol, timeframe);
  if (candles.length < 50) return null; // Mindestanzahl an Kerzen
  const closes = candles.map((c) => c.close);
  const fastEMA = calculateEMA(closes, CONFIG.fastEMA);
  const slowEMA = calculateEMA(closes, CONFIG.slowEMA);
  const macd = calculateMACD(closes);
  const entryRaw = closes[closes.length - 1];

  console.log(`Signal for ${symbol}: fastEMA=${fastEMA.toFixed(5)}, slowEMA=${slowEMA.toFixed(5)}, MACD Histogram=${macd.histogram.toFixed(5)}`);

  if (fastEMA > slowEMA && macd.histogram > 0) {
    return { signal: "BUY", entryRaw };
  } else if (fastEMA < slowEMA && macd.histogram < 0) {
    return { signal: "SELL", entryRaw };
  }
  return null;
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
};
// Multi-Timeframe-Analyse: Zusätzlich wird der H1-Trend (als Filter) geprüft
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

// Live Trade-Ausführung: Integriert die Backtesting-Logik
const executeTradeForSymbol = async (symbol, direction, rawPrice, lotSize) => {
  const spread = 0.0002; // Fester Spread
  const entry = direction === "BUY" ? rawPrice + spread : rawPrice;

  // ATR-Berechnung auf den letzten 15 M1-Kerzen
  const candles = await getHistoricalData(symbol, CONFIG.timeframe.M1);
  const atr = calculateATR(candles.slice(-15));
  let sl, tp;
  if (atr) {
    const dynamic = calculateDynamicSLTP(entry, atr, direction === "BUY");
    sl = dynamic.sl;
    tp = dynamic.tp;
  } else {
    // Fallback: feste SL/TP
    const rawSL = direction === "BUY" ? entry - CONFIG.stopLossPips * 0.0001 : entry + CONFIG.stopLossPips * 0.0001;
    const rawTP = direction === "BUY" ? entry + CONFIG.takeProfitPips * 0.0001 : entry - CONFIG.takeProfitPips * 0.0001;
    sl = rawSL;
    tp = rawTP;
  }

  console.log(`Executing ${direction} trade for ${symbol}: entry=${entry}, SL=${sl}, TP=${tp}`);

  try {
    const order = await x.Socket.send.tradeTransaction({
      cmd: direction === "BUY" ? 0 : 1,
      customComment: `Live Trade Order for ${symbol}`,
      expiration: Date.now() + 3600000,
      offset: 0,
      order: 0,
      price: entry,
      sl: sl,
      tp: tp,
      symbol: symbol,
      type: 0,
      volume: lotSize,
    });
    console.log(`${direction} order executed for ${symbol} at ${entry}`, order);
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

// Live Trading Logik, die die Backtesting-Signal- und Exit-Logik integriert
const checkAndTradeForSymbol = async (symbol) => {
  // Hole Signal aus den letzten 50 M1-Kerzen
  const signalData = await generateSignal(symbol, CONFIG.timeframe.M1);
  if (!signalData) {
    console.log(`No valid signal for ${symbol}`);
    return;
  }
  const entryRaw = signalData.entryRaw;
  console.log(`Signal for ${symbol}: ${signalData.signal} at price ${entryRaw}`);

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

  // Hier könnte man zusätzliche Logik für Exit (z.B. Trailing Stop) implementieren
  // Für ein Live-Trading könnte man eine feste SL/TP-Berechnung (wie unten) vornehmen:
  const candles = await getHistoricalData(symbol, CONFIG.timeframe.M1);
  const atr = calculateATR(candles.slice(-15));
  let sl, tp;
  if (atr) {
    const dynamic = calculateDynamicSLTP(entryRaw, atr, signalData.signal === "BUY");
    sl = dynamic.sl;
    tp = dynamic.tp;
  } else {
    sl = signalData.signal === "BUY" ? entryRaw - CONFIG.stopLossPips * 0.0001 : entryRaw + CONFIG.stopLossPips * 0.0001;
    tp = signalData.signal === "BUY" ? entryRaw + CONFIG.takeProfitPips * 0.0001 : entryRaw - CONFIG.takeProfitPips * 0.0001;
  }

  console.log(`Trade details for ${symbol}: Entry=${entryRaw}, SL=${sl}, TP=${tp}`);

  // Berechne Positionsgröße
  const balance = await getAccountBalance();
  if (!balance) {
    console.error("Balance not available.");
    return;
  }
  const pipMultiplier = getPipMultiplier(symbol);
  const riskAmount = balance * (CONFIG.riskPerTrade || 0.02);
  const pipsRisked = (signalData.signal === "BUY" ? entryRaw - sl : sl - entryRaw) / pipMultiplier;
  const positionSize = riskAmount / pipsRisked;
  console.log(`Placing ${signalData.signal} trade for ${symbol} with lot size: ${positionSize}`);

  // Führe den Trade aus
  await executeTradeForSymbol(symbol, signalData.signal, entryRaw, positionSize);
};

const checkAllPairsAndTrade = async () => {
  for (let symbol of Object.values(CONFIG.symbols)) {
    await checkAndTradeForSymbol(symbol);
  }
};

const tick = async () => {
  x.Stream.listen.getTickPrices((data) => {
    console.log("gotten:", data);
    return data;
  });
  n;
};

const startBot = async () => {
  try {
    await connectXAPI();
    // Abonniere Streams
    await Promise.all([
      x.Stream.subscribe.getTickPrices("EURUSD").catch(() => console.error("subscribe for EURUSD failed")),
      x.Stream.subscribe
        .getTrades()
        .then(() => console.log("Trades-Stream subscribed"))
        .catch((err) => console.error("Error subscribing trades:", err)),
      x.Stream.subscribe
        .getBalance()
        .then(() => console.log("Balance-Stream subscribed"))
        .catch((err) => console.error("Error subscribing balance:", err)),
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
        console.log("Balance updated:", currentBalance);
      } else {
        console.error("Invalid balance data:", data);
      }
    });
    // Warte auf den ersten Balance-Wert
    const initialBalance = await getAccountBalance();
    console.log("Initial balance:", initialBalance);

    // Hier kannst du den Live-Trading-Loop starten (z. B. alle 60 Sekunden)

    // --- Backtesting für alle Paare ---
    // await backtestStrategy(
    //   CONFIG.symbols.EURUSD,
    //   CONFIG.timeframe.M1,
    //   Math.floor(new Date("2025-01-14T00:00:00Z").getTime() / 1000),
    //   Math.floor(new Date("2025-02-14T00:00:00Z").getTime() / 1000)
    // );

    setInterval(async () => {
      if (isMarketOpen()) {
        await checkAllPairsAndTrade();
      } else {
        console.log("Markt geschlossen. Handel wird nicht ausgeführt.");
      }
    }, 60000);

    console.log("Bot is live...");
  } catch (error) {
    console.error("Error:", error);
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
