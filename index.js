require("dotenv").config();
const XAPI = require("xapi-node").default;
const { calculateSMA, calculateEMA, calculateMACD, calculateRSI, calculateATR } = require("./indicators");

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

// Globales Handling von unhandledRejections
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

// 2. Authentifizierung mit XAPI
const x = new XAPI({
  accountId: process.env.DEMO_ACCOUNT_ID,
  password: process.env.DEMO_PASSWORD,
  type: "demo",
});
const socketId = x.Socket.getSocketId();

let currentBalance = null; // Wird über den Balance-Stream aktualisiert
let currentTrades = []; // Wird über den Trade-Stream aktualisiert

// Dynamische SL/TP-Berechnung mit ATR
const calculateDynamicSLTP = (entryRaw, atr, isBuy) => {
  const slDistance = atr * CONFIG.atrMultiplierSL;
  const tpDistance = atr * CONFIG.atrMultiplierTP;
  return isBuy ? { sl: entryRaw - slDistance, tp: entryRaw + tpDistance } : { sl: entryRaw + slDistance, tp: entryRaw - tpDistance };
};

// --- Verbindung & Datenabruf ---
const connect = async () => {
  try {
    await x.connect();
    console.log("Connection established");
  } catch (error) {
    console.error("Error:", error);
    throw error;
  }
};

// const getAccountBalance = async () => {
//   if (currentBalance !== null) {
//     return currentBalance;
//   } else {
//     console.error("Balance noch nicht verfügbar!");
//     return null;
//   }
// };

const getAccountBalance = async () => {
  try {
    x.Stream.listen.getBalance((data) => {
      if (data && data.balance !== undefined) {
        currentBalance = data.balance;
        console.log("Balance updated:", currentBalance);
      } else {
        console.error("Ungültige Balance-Daten:", data);
      }
    });
  } catch (err) {
    console.error("Error getting account balance:", err);
    return null;
  }
};

const getHistoricalData = async (symbol, timeframe) => {
  try {
    const result = await x.getPriceHistory({ symbol, period: timeframe });
    return result && result.candles ? result.candles : [];
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
// Prüft das Handelssignal basierend auf EMA, MACD und RSI
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
  const distancePct = Math.abs(lastPrice - fastEMA) / fastEMA;
  const rsi = calculateRSI(closes.slice(-50));

  if (fastEMA > slowEMA && distancePct < CONFIG.maxDistancePct && rsi < CONFIG.rsiBuyThreshold) {
    return { signal: "BUY", rawPrice: lastPrice };
  } else if (fastEMA < slowEMA && distancePct < CONFIG.maxDistancePct && rsi > CONFIG.rsiSellThreshold) {
    return { signal: "SELL", rawPrice: lastPrice };
  } else {
    return null;
  }
};

// Multi-Timeframe-Analyse: Prüft die Signale in M1, M15 und H1
// const checkMultiTimeframeSignal = async (symbol) => {
//   const signalM1 = await checkSignalForSymbol(symbol, CONFIG.timeframe.M1, CONFIG.fastMA, CONFIG.slowMA);
//   const signalM15 = await checkSignalForSymbol(symbol, CONFIG.timeframe.M15, CONFIG.fastMA, CONFIG.slowMA);
//   const signalH1 = await checkSignalForSymbol(symbol, CONFIG.timeframe.H1, CONFIG.fastMA, CONFIG.slowMA);

//   // if (!signalM1 || !signalM15 || !signalH1) {
//   if (!signalM1 || !signalM15) {
//     console.error(`Not enough data for ${symbol}`);
//     return null;
//   }
//   if (signalM1.signal === signalM15.signal && signalM15.signal === signalH1.signal) {
//     return { signal: signalM1.signal, rawPrice: signalM1.rawPrice };
//   }
//   return null;
// };

// Multi-Timeframe-Analyse: Zusätzlich wird der H1-Trend (als Filter) geprüft
const checkMultiTimeframeSignal = async (symbol) => {
  const signalM1 = await checkSignalForSymbol(symbol, CONFIG.timeframe.M1, CONFIG.fastEMA, CONFIG.slowEMA);
  if (!signalM1) {
    console.error(`Not enough data or no valid signal for ${symbol} on M1`);
    return null;
  }
  // H1 Trendfilter:
  const h1Candles = await getHistoricalData(symbol, CONFIG.timeframe.H1);
  if (!h1Candles.length) {
    console.error(`No H1 data for ${symbol}`);
    return null;
  }
  const h1Closes = h1Candles.map((c) => c.close);
  const h1FastEMA = calculateEMA(h1Closes, CONFIG.fastEMA);
  const h1SlowEMA = calculateEMA(h1Closes, CONFIG.slowEMA);
  const h1Trend = h1FastEMA > h1SlowEMA ? "BUY" : "SELL";
  // Nur wenn H1-Trend mit M1-Signal übereinstimmt, wird das Signal weitergegeben
  if (signalM1.signal === h1Trend) {
    return { signal: signalM1.signal, rawPrice: signalM1.rawPrice };
  }
  console.error(`H1 Trend (${h1Trend}) widerspricht dem M1 Signal für ${symbol}`);
  return null;
};
// --- Orderausführung ---
// Nutzt den normalisierten Preis, um Entry, SL und TP zu berechnen.
const executeTradeForSymbol = async (symbol, direction, rawPrice, lotSize) => {
  const factor = symbol.includes("JPY") ? 1000 : 100000;
  const pipMultiplier = getPipMultiplier(symbol);
  const spreadRaw = 0.0002 * factor;
  const rawEntry = direction === "BUY" ? rawPrice + spreadRaw : rawPrice;
  const entry = normalizePrice(symbol, rawEntry);

  // ATR-basierte dynamische SL/TP-Berechnung
  const candles = await getHistoricalData(symbol, CONFIG.timeframe.M1);
  const atr = calculateATR(candles.slice(-15));
  let sl, tp;
  if (atr) {
    const dynamic = calculateDynamicSLTP(rawEntry, atr, direction === "BUY");
    sl = normalizePrice(symbol, dynamic.sl);
    tp = normalizePrice(symbol, dynamic.tp);
  } else {
    const rawSL =
      direction === "BUY"
        ? rawEntry - CONFIG.stopLossPips * (pipMultiplier * factor)
        : rawEntry + CONFIG.stopLossPips * (pipMultiplier * factor);
    const rawTP =
      direction === "BUY"
        ? rawEntry + CONFIG.takeProfitPips * (pipMultiplier * factor)
        : rawEntry - CONFIG.takeProfitPips * (pipMultiplier * factor);
    sl = normalizePrice(symbol, rawSL);
    tp = normalizePrice(symbol, rawTP);
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

async function getOpenPositionsCount() {
  return new Promise((resolve) => {
    x.Stream.listen.getTrades((data) => {
      const trades = Array.isArray(data) ? data : [data];
      const openTrades = trades.filter((t) => t && !t.closed);
      console.log("Open positions update:", openTrades);
      resolve(openTrades.length);
    });
  }).catch((err) => {
    console.error("Error fetching open positions:", err);
    return 0;
  });
}

// Pro Währungspaar nur ein Trade gleichzeitig
async function checkAndTradeForSymbol(symbol) {
  const signalData = await checkMultiTimeframeSignal(symbol);
  if (!signalData) {
    console.log(`No consistent multi-timeframe signal for ${symbol}`);
    return;
  }
  console.log(`Signal for ${symbol}: ${signalData.signal} at raw price ${signalData.rawPrice}`);
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
};

// --- Verbessertes Backtesting ---
const backtestStrategy = async (symbol, timeframe, startTimestamp, endTimestamp) => {
  console.log(`Backtesting ${symbol} from ${new Date(startTimestamp * 1000)} to ${new Date(endTimestamp * 1000)}`);
  let allData;
  try {
    allData = await x.getPriceHistory({ symbol, period: timeframe, start: startTimestamp, end: endTimestamp });
  } catch (err) {
    console.error("Error during getPriceHistory:", err);
    return;
  }
  if (!allData || !allData.candles) {
    console.error("Keine historischen Daten gefunden.");
    return;
  }
  const candles = allData.candles;
  console.log(`Backtesting: ${candles.length} Candles geladen.`);

  let trades = [];
  let equityCurve = [];
  let equity = 500; // Startkapital
  const initialCapital = equity;

  const factor = symbol.includes("JPY") ? 1000 : 100000;
  const pipMultiplier = getPipMultiplier(symbol);
  const riskDistance = CONFIG.stopLossPips * (pipMultiplier * factor);
  const rewardDistance = CONFIG.takeProfitPips * (pipMultiplier * factor);
  const expectedRR = rewardDistance / riskDistance;

  const maxDrawdownPctLimit = CONFIG.maxDrawdownPctLimit;
  const minRR = CONFIG.minRR;
  const maxDuration = CONFIG.maxTradeDurationCandles;

  for (let i = 50; i < candles.length - 1; i++) {
    if (((initialCapital - equity) / initialCapital) * 100 >= maxDrawdownPctLimit) {
      console.log("Maximaler Drawdown erreicht – keine weiteren Trades simuliert.");
      break;
    }
    const slice = candles.slice(0, i + 1);
    const closes = slice.map((c) => c.close);
    const fastEMA = calculateEMA(closes, CONFIG.fastEMA);
    const slowEMA = calculateEMA(closes, CONFIG.slowEMA);
    const recentCloses = closes.slice(-50);
    const macdData = calculateMACD(recentCloses);
    const rsiValue = calculateRSI(recentCloses);
    const entryRaw = closes[closes.length - 1];

    let signal = null;
    if (fastEMA > slowEMA && macdData.histogram > 0 && rsiValue < 70) {
      signal = "BUY";
    } else if (fastEMA < slowEMA && macdData.histogram < 0 && rsiValue > 30) {
      signal = "SELL";
    }
    if (!signal) continue;
    if (expectedRR < minRR) continue;

    let exitRaw = null;
    let exitReason = null;
    let durationCandles = 0;
    for (let j = i + 1; j < Math.min(i + 1 + maxDuration, candles.length); j++) {
      durationCandles = j - i;
      const candle = candles[j];
      if (signal === "BUY") {
        if (candle.low <= entryRaw - riskDistance) {
          exitRaw = entryRaw - riskDistance;
          exitReason = "SL";
          break;
        }
        if (candle.high >= entryRaw + rewardDistance) {
          exitRaw = entryRaw + rewardDistance;
          exitReason = "TP";
          break;
        }
      } else {
        if (candle.high >= entryRaw + riskDistance) {
          exitRaw = entryRaw + riskDistance;
          exitReason = "SL";
          break;
        }
        if (candle.low <= entryRaw - rewardDistance) {
          exitRaw = entryRaw - rewardDistance;
          exitReason = "TP";
          break;
        }
      }
    }
    if (exitRaw === null) {
      exitRaw = candles[Math.min(i + maxDuration, candles.length - 1)].close;
      exitReason = "EndOfPeriod";
      durationCandles = Math.min(maxDuration, candles.length - i - 1);
    }

    const profitRaw = signal === "BUY" ? exitRaw - entryRaw : entryRaw - exitRaw;
    const profitPips = profitRaw / (pipMultiplier * factor);
    const entryNorm = normalizePrice(symbol, entryRaw);
    const exitNorm = normalizePrice(symbol, exitRaw);
    const profitPct = ((exitNorm - entryNorm) / entryNorm) * 100;

    trades.push({
      signal,
      entry: entryRaw,
      normalizedEntry: entryNorm,
      exit: exitRaw,
      normalizedExit: exitNorm,
      profit: profitRaw,
      profitPct,
      profitPips,
      durationCandles,
      exitReason,
      rrRatio: expectedRR.toFixed(2),
    });
    equity += profitRaw;
    equityCurve.push(equity);
  }

  const totalTrades = trades.length;
  const wins = trades.filter((t) => t.profit > 0).length;
  const losses = totalTrades - wins;
  const totalProfit = equity - initialCapital;
  const totalProfitPct = (totalProfit / initialCapital) * 100;
  const avgProfit = totalTrades ? totalProfit / totalTrades : 0;
  const avgProfitPct = totalTrades ? totalProfitPct / totalTrades : 0;

  let maxDrawdown = 0;
  let peak = equityCurve[0] || initialCapital;
  for (let value of equityCurve) {
    if (value > peak) peak = value;
    const drawdown = peak - value;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }
  const maxDrawdownPct = (maxDrawdown / initialCapital) * 100;
  const avgDuration = totalTrades ? trades.reduce((sum, t) => sum + t.durationCandles, 0) / totalTrades : 0;
  const avgRR = totalTrades ? trades.reduce((sum, t) => sum + parseFloat(t.rrRatio), 0) / totalTrades : 0;

  console.log(`Backtesting Ergebnisse für ${symbol}:`);
  console.log(`Trades: ${totalTrades}, Wins: ${wins} (${((wins / totalTrades) * 100).toFixed(2)}%), Losses: ${losses}`);
  console.log(`Total Profit: ${totalProfit.toFixed(2)} (${totalProfitPct.toFixed(2)}%)`);
  console.log(`Average Profit per Trade: ${avgProfit.toFixed(2)} (${avgProfitPct.toFixed(2)}%)`);
  console.log(`Max Drawdown: ${maxDrawdown.toFixed(2)} (${maxDrawdownPct.toFixed(2)}%)`);
  console.log(`Average Trade Duration (Candles): ${avgDuration.toFixed(2)}`);
  console.log(`Average RR Ratio: ${avgRR.toFixed(2)}`);
  console.log("Detailed Trades Sample:", trades.slice(0, 10));

  console.log("Equity Curve (letzte 10 Werte):", equityCurve.slice(10));
  // console.log("Equity Curve (letzte 10 Werte):", equityCurve);

  return {
    totalTrades,
    wins,
    losses,
    totalProfit,
    totalProfitPct,
    avgProfit,
    avgProfitPct,
    maxDrawdown,
    maxDrawdownPct,
    avgDuration,
    avgRR,
    trades,
    equityCurve,
  };
};

// --- Backtesting für alle Paare ---
const test = async () => {
  const startTimestamp = Math.floor(new Date("2025-01-14T00:00:00Z").getTime() / 1000);
  const endTimestamp = Math.floor(new Date("2025-02-14T00:00:00Z").getTime() / 1000);
  const result = await backtestStrategy(CONFIG.symbols.AUDUSD, CONFIG.timeframe.M1, startTimestamp, endTimestamp);

  // console.log("Backtesting results:", result);

  // let allResults = {};
  // for (let symbol of Object.values(CONFIG.symbols)) {
  //   console.log(`\n======================\nBacktesting für ${symbol}`);

  //   const result = await backtestStrategy(CONFIG.symbols.EURUSD, CONFIG.timeframe.M1, startTimestamp, endTimestamp);
  //   allResults[symbol] = result;
  // }
  // return allResults;
};

// --- Main function ---
const startBot = async () => {
  try {
    await connect();

    // Streams abonnieren
    x.Stream.subscribe
      .getBalance()
      .then(() => console.log("Balance-Stream abonniert"))
      .catch((err) => console.error("Fehler beim Abonnieren des Balance-Streams:", err));
    x.Stream.subscribe.getTickPrices("EURUSD").catch(() => console.error("subscribe for EURUSD failed"));
    x.Stream.subscribe
      .getTrades()
      .then(() => console.log("Trades-Stream abonniert"))
      .catch((err) => console.error("Fehler beim Abonnieren des Trades-Streams:", err));

    // // Listener registrieren
    // x.Stream.listen.getBalance((data) => {
    //   if (data && data.balance !== undefined) {
    //     currentBalance = data.balance;
    //     console.log("Balance updated:", currentBalance);
    //   } else {
    //     console.error("Ungültige Balance-Daten:", data);
    //   }
    // });
    await getAccountBalance();

    x.Stream.listen.getTrades((data) => {
      if (data) {
        // Optional: hier können Trade-Daten geloggt werden
      } else {
        console.error("no trades data:", data);
      }
    });

    test();
    // setInterval(async () => {
    //   await checkAllPairsAndTrade();
    // }, 60000);

    console.log("Bot läuft...");
  } catch (error) {
    console.error("Error:", error);
    throw error;
  }
};

startBot();
