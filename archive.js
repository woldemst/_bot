// trading.js
const { x, connect } = require("./api");
const { CONFIG, pipValue } = require("./config");
const { calculateSMA, calculateEMA, normalizePrice, getPipMultiplier } = require("./indicators");
const { getHistoricalData, getCurrentPrice } = require("./data");

// Variable, in der der aktuelle Kontostand gespeichert wird (wird über einen Stream aktualisiert)
let currentBalance = null;

// Listener für den Kontostand
function registerBalanceListener() {
  x.Stream.listen.getBalance((data) => {
    if (data && data.balance !== undefined) {
      currentBalance = data.balance;
      console.log("Balance updated:", currentBalance);
    } else {
      console.error("Ungültige Balance-Daten:", data);
    }
  });
}

// Gibt den aktuellen Kontostand zurück (sofern verfügbar)
async function getAccountBalance() {
  if (currentBalance !== null) {
    return currentBalance;
  } else {
    console.error("Balance noch nicht verfügbar!");
    return null;
  }
}

// Berechnet die Lot-Größe basierend auf Kontostand, Risiko, StopLoss und Symbol
function calculatePositionSize(accountBalance, riskPerTrade, stopLossPips, symbol) {
  const pipMultiplier = getPipMultiplier(symbol);
  const riskAmount = accountBalance * riskPerTrade;
  return riskAmount / (stopLossPips * pipMultiplier);
}

// Prüft das Handelssignal für ein Symbol (basierend auf EMA)
async function checkSignalForSymbol(symbol, timeframe, fastPeriod, slowPeriod) {
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
}

// Prüft, ob auf mehreren Timeframes dasselbe Signal vorliegt
async function checkMultiTimeframeSignal(symbol) {
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
}

// Führt den Handel für ein einzelnes Symbol aus
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

// Führt einen Trade aus, indem der Entry, SL und TP normalisiert werden
async function executeTradeForSymbol(symbol, direction, rawPrice, lotSize) {
  const pipMultiplier = getPipMultiplier(symbol);
  const factor = symbol.includes("JPY") ? 1000 : 100000;
  const spreadRaw = 0.0002 * factor;
  const rawEntry = direction === "BUY" ? rawPrice + spreadRaw : rawPrice; // Für SELL: keine Spread-Anpassung
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

// Öffentliche Positionen abrufen (als Promise)
async function getOpenPositionsCount() {
  return new Promise((resolve) => {
    x.Stream.listen.getTrades((data) => {
      console.log("Open positions update:", data);
      resolve(Array.isArray(data) ? data.length : 0);
    });
  }).catch((err) => {
    console.error("Error fetching open positions:", err);
    return 0;
  });
}

async function checkAllPairsAndTrade() {
  for (let symbol of Object.values(CONFIG.symbols)) {
    await checkAndTradeForSymbol(symbol);
  }
}

module.exports = {
  checkAllPairsAndTrade,
  getOpenPositionsCount,
  getAccountBalance,
  checkMultiTimeframeSignal,
  executeTradeForSymbol,
  getHistoricalData,
  getCurrentPrice,
  checkSignalForSymbol,
  calculatePositionSize,
  connect,
  registerBalanceListener,
};


// // index.js
// require("dotenv").config();
// const { connect, x } = require("./api");
// const { registerBalanceListener } = require("./trading");
// const { checkAllPairsAndTrade } = require("./trading");
// const { getHistoricalData } = require("./data");
// const { CONFIG } = require("./config");

// // Optional: Registriere weitere Listener, z. B. für Tick-Preise
// x.Stream.subscribe
//   .getTickPrices("EURUSD")
//   .catch(() => console.error("subscribe for EURUSD failed"));

// x.Stream.subscribe
//   .getTrades()
//   .then(() => console.log("Trades-Stream abonniert"))
//   .catch((err) => console.error("Fehler beim Abonnieren des Trades-Streams:", err));

// // Starte den Bot
// const startBot = async () => {
//   try {
//     await connect();
//     registerBalanceListener();
//     console.log("Bot läuft...");

//     // Alle 60 Sekunden alle Symbole prüfen und ggf. handeln
//     setInterval(async () => {
//       await checkAllPairsAndTrade();
//     }, 60000);

//     // Lade historische Daten (optional, z.B. zum Testen)
//     const historicalData = await getHistoricalData(CONFIG.symbols.EURUSD, CONFIG.timeframe.M1);
//     if (historicalData.length === 0) {
//       console.error("No historical data downloaded!");
//       return;
//     }
//     console.log("Historical data loaded:", historicalData.length, "candles");
//   } catch (error) {
//     console.error("Error:", error);
//     throw error;
//   }
// };

// startBot();




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


const historicalData = await getHistoricalData(CONFIG.symbols.EURUSD, CONFIG.timeframe.M1);
if (historicalData.length === 0) {
  console.error("No historical data downloaded!");
  return;
}
const closes = historicalData.map((candle) => candle.close);
console.log("Historical data loaded:", closes.length, "candles");



// --- Verbessertes Backtesting ---
async function backtestStrategy(symbol, timeframe, startTimestamp, endTimestamp) {
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

  // Globales Drawdown-Limit und Mindest-RR
  const maxDrawdownPctLimit = CONFIG.maxDrawdownPctLimit;
  const minRR = CONFIG.minRR;
  const maxDuration = CONFIG.maxTradeDurationCandles;

  // Simuliere Trades ab Candle 50
  for (let i = 50; i < candles.length - 1; i++) {
    if (((initialCapital - equity) / initialCapital) * 100 >= maxDrawdownPctLimit) {
      console.log("Maximaler Drawdown erreicht – keine weiteren Trades simuliert.");
      break;
    }

    const slice = candles.slice(0, i + 1);
    const closes = slice.map((c) => c.close);

    const emaFast = calculateEMA(closes, CONFIG.fastMA);
    const emaSlow = calculateEMA(closes, CONFIG.slowMA);
    const recentCloses = closes.slice(-50);
    const macdData = calculateMACD(recentCloses);
    const rsiValue = calculateRSI(recentCloses);
    const entryRaw = closes[closes.length - 1];

    let signal = null;
    if (emaFast > emaSlow && macdData.histogram > 0 && rsiValue < 70) {
      signal = "BUY";
    } else if (emaFast < emaSlow && macdData.histogram < 0 && rsiValue > 30) {
      signal = "SELL";
    }
    if (!signal) continue;

    // Nur Trades berücksichtigen, wenn das erwartete RR >= minRR ist
    if (expectedRR < minRR) continue;

    // Simulation des Trades: Suche nach TP/SL in den nächsten maxDuration Candles
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

  // Berechne maximalen Drawdown
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
  console.log("Equity Curve (letzte 10 Werte):", equityCurve.slice(-10));

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
}


const checkSignalForSymbol = async (symbol, timeframe, fastPeriod, slowPeriod) => {
  const candles = await getHistoricalData(symbol, timeframe);
  if (candles.length === 0) {
    console.error(`No data for ${symbol}`);
    return null;
  }
  const closes = candles.map((c) => c.close);
  const emaFast = calculateEMA(closes, fastPeriod);
  const emaSlow = calculateEMA(closes, slowPeriod);
  const lastPrice = closes[closes.length - 1];

  const recentCloses = closes.slice(-50);
  const macdData = calculateMACD(recentCloses);
  const rsiValue = calculateRSI(recentCloses);

  if (emaFast > emaSlow && macdData.histogram > 0 && rsiValue < 70) {
    return { signal: "BUY", rawPrice: lastPrice };
  } else if (emaFast < emaSlow && macdData.histogram < 0 && rsiValue > 30) {
    return { signal: "SELL", rawPrice: lastPrice };
  } else {
    return null;
  }
};



const tick = async () => {
  x.Stream.listen.getTickPrices((data) => {
    console.log("gotten:", data);
    return data;
  });
};



// require("dotenv").config();
// const { x, connectXAPI } = require("./xapi");
// const { calculateEMA, calculateMACD, calculateATR } = require("./indicators");
// // const { backtestStrategy } = require("./backtesting");
// const { CONFIG } = require("./config");

// let currentBalance = null;

// const calculateDynamicSLTP = (entryRaw, atr, isBuy) => {
//   const slDistance = atr * CONFIG.atrMultiplierSL;
//   const tpDistance = atr * CONFIG.atrMultiplierTP;

//   let sl = isBuy ? entryRaw - slDistance : entryRaw + slDistance;
//   let tp = isBuy ? entryRaw + tpDistance : entryRaw - tpDistance;

//   return {
//     sl: parseFloat(sl.toFixed(5)),
//     tp: parseFloat(tp.toFixed(5)),
//   };
// };

// // Kontostand (wird über den Balance‑Stream aktualisiert)
// const getAccountBalance = async () => {
//   if (currentBalance !== null) {
//     return currentBalance;
//   } else {
//     console.error("Balance noch nicht verfügbar!");
//     return null;
//   }
// };

// // async function getAccountBalance() {
// //   if (currentBalance !== null) return currentBalance;
// //   return new Promise((resolve) => {
// //     const interval = setInterval(() => {
// //       if (currentBalance !== null) {
// //         clearInterval(interval);
// //         resolve(currentBalance);
// //       }
// //     }, 500);
// //   });
// // }

// // Historische Daten abrufen (Candles)
// const getHistoricalData = async (symbol, timeframe) => {
//   try {
//     const result = await x.getPriceHistory({
//       symbol,
//       period: timeframe,
//       // socketId: getSocketId(),
//     });

//     if (!result || !result.candles) {
//       console.error(`No historical data returned for ${symbol}`);
//       return [];
//     }
//     return result.candles.map((candle) => ({
//       timestamp: candle.timestamp,
//       close: normalizePrice(symbol, candle.close),
//       high: normalizePrice(symbol, candle.high),
//       low: normalizePrice(symbol, candle.low),
//     }));
//     // return result && result.candles ? result.candles : [];
//   } catch (err) {
//     console.error("Error in getHistoricalData:", err);
//     return [];
//   }
// };

// // Aktuellen Marktpreis (letzte Kerze im M1) abrufen
// const getCurrentPrice = async (symbol) => {
//   const candles = await getHistoricalData(symbol, CONFIG.timeframe.M1);
//   if (candles.length === 0) return null;
//   const closes = candles.map((c) => c.close);
//   return closes[closes.length - 1];
// };

// // Normalisierungsfunktion: Wandelt Rohpreise in den tatsächlichen Kurs um
// function normalizePrice(symbol, rawPrice) {
//   const factor = symbol.includes("JPY") ? 1000 : 100000;
//   return parseFloat((rawPrice / factor).toFixed(5));
// }

// // Liefert den Pip-Multiplikator
// function getPipMultiplier(symbol) {
//   return symbol.includes("JPY") ? 0.01 : 0.0001;
// }

// // Signal-Generierung (wie im Backtesting – EMA und MACD)
// const generateSignal = async (symbol, timeframe) => {
//   const candles = await getHistoricalData(symbol, timeframe);
//   if (candles.length < 50) return null; // Mindestanzahl an Kerzen
//   const closes = candles.map((c) => c.close);
//   const fastEMA = calculateEMA(closes, CONFIG.fastEMA);
//   const slowEMA = calculateEMA(closes, CONFIG.slowEMA);
//   const macd = calculateMACD(closes);
//   const lastPrice = closes[closes.length - 1];

//   console.log(
//     `Signal for ${symbol}: fastEMA=${fastEMA.toFixed(5)}, slowEMA=${slowEMA.toFixed(5)}, MACD Histogram=${macd.histogram.toFixed(5)}`
//   );

//   if (fastEMA > slowEMA && macd.histogram > 0) {
//     return { signal: 0, lastPrice };
//   } else if (fastEMA < slowEMA && macd.histogram < 0) {
//     return { signal: 1, lastPrice };
//   }
//   return null;
// };

// // Multi-Timeframe-Analyse: Prüfe Signale für M1, M15 und H1
// const checkMultiTimeframeSignal = async (symbol) => {
//   // Check if there is already an open trade for this symbol
//   // const openPositionsForSymbol = await getOpenPositionsForSymbol(symbol);
//   // if (openPositionsForSymbol >= 1) {
//   //   console.log(`Trade for ${symbol} is already open. Skipping new trade.`);
//   //   return;
//   // }
//   // const openPositions = await getOpenPositionsCount();
//   // if (openPositions >= 5) {
//   //   console.log(`Max open positions reached (${openPositions}). No new trade for ${symbol}.`);
//   //   return;
//   // const signalM15 = await generateSignal(symbol, CONFIG.timeframe.M15);
//   // const signalH1 = await generateSignal(symbol, CONFIG.timeframe.H1);
//   const signalM1 = await generateSignal(symbol, CONFIG.timeframe.M1);
//   if (!signalM1) {
//     console.error(`Not enough data or no valid signal for ${symbol} on M1`);
//     return null;
//   }
//   return { signal: signalM1.signal, lastPrice: signalM1.lastPrice };
// };

// // Berechnung der Lot-Größe (nur 1 Trade pro Währungspaar, max. 5 insgesamt)
// function calculatePositionSize(accountBalance, riskPerTrade, stopLossPips, symbol) {
//   const pipMultiplier = getPipMultiplier(symbol);
//   const factor = symbol.includes("JPY") ? 1000 : 100000;
//   const riskAmount = accountBalance * riskPerTrade;
//   return riskAmount / (stopLossPips * (pipMultiplier * factor));
// }
// // const calculatePositionSize = (accountBalance, riskPerTrade, stopLossPips, symbol) => {
// //   const riskAmount = accountBalance * riskPerTrade;
// //   // For non-JPY pairs, each pip is typically worth $10 per lot.
// //   const pipValuePerLot = 10;
// //   return riskAmount / (stopLossPips * pipValuePerLot);
// // };

// // Neue Funktion: Gibt die Anzahl offener Trades für ein bestimmtes Symbol zurück
// const getOpenPositionsForSymbol = async (symbol) => {
//   return new Promise((resolve) => {
//     x.Stream.listen.getTrades((data) => {
//       const trades = Array.isArray(data) ? data : [data];
//       const openTradesForSymbol = trades.filter((t) => t && !t.closed && t.symbol === symbol);
//       console.log(`Open positions for ${symbol}:`, openTradesForSymbol);
//       resolve(openTradesForSymbol.length);
//     });
//   }).catch((err) => {
//     console.error("Error fetching open positions for", symbol, ":", err);
//     return 0;
//   });
// };

// // Orderausführung: Nutzt den aktuellen Marktpreis als Basis und normalisiert die Preise korrekt
// async function executeTradeForSymbol(symbol, direction, rawPrice, lotSize) {
//   const factor = symbol.includes("JPY") ? 1000 : 100000;
//   const pipMultiplier = getPipMultiplier(symbol);
//   const spreadRaw = 0.0002 * factor;
//   const rawEntry = direction === 0 ? rawPrice + spreadRaw : rawPrice;
//   const entry = normalizePrice(symbol, rawEntry);
//   const rawSL =
//     direction === 0 ? rawEntry - CONFIG.stopLossPips * (pipMultiplier * factor) : rawEntry + CONFIG.stopLossPips * (pipMultiplier * factor);
//   const rawTP =
//     direction === 0
//       ? rawEntry + CONFIG.takeProfitPips * (pipMultiplier * factor)
//       : rawEntry - CONFIG.takeProfitPips * (pipMultiplier * factor);
//   const sl = normalizePrice(symbol, rawSL);
//   const tp = normalizePrice(symbol, rawTP);

//   console.log(`Executing ${direction} trade for ${symbol}: entry=${entry}, SL=${sl}, TP=${tp}`);
//   console.log("entry:", entry, "stop loss:", sl, "take profit:", tp);

//   try {
//     console.log(entry, sl, tp);

//     const order = await x.Socket.send.tradeTransaction({
//       cmd: direction, // 0 for BUY, 1 for SELL
//       customComment: `Scalping Bot Order for ${symbol}`,
//       expiration: Date.now() + 3600000,
//       offset: 0,
//       order: 0,
//       price: entry,
//       sl: sl,
//       tp: tp,
//       symbol: symbol,
//       type: 0, // OPEN = 0, PENDING = 1, CLOSE = 2, MODIFY = 3, DELETE = 4,
//       volume: lotSize,
//     });
//     console.log(`${direction} order executed for ${symbol} at ${entry}, order:`, order);
//   } catch (error) {
//     console.error(`Failed to execute ${direction} trade for ${symbol}:`, error);
//   }
// }

// // Offene Positionen abrufen (als Promise verpackt)
// async function getOpenPositionsCount() {
//   return new Promise((resolve) => {
//     x.Stream.listen.getTrades((data) => {
//       // Wir gehen davon aus, dass data entweder ein Array oder ein einzelnes Objekt ist
//       const trades = Array.isArray(data) ? data : [data];
//       const openTrades = trades.filter((t) => t && !t.closed);
//       console.log("Open positions update:", openTrades);
//       resolve(openTrades.length);
//     });
//   }).catch((err) => {
//     console.error("Error fetching open positions:", err);
//     return 0;
//   });
// }

// // Für jedes Symbol prüfen und ggf. einen Trade auslösen (max. 1 Trade pro Symbol)
// async function checkAndTradeForSymbol(symbol) {
//   const signalData = await checkMultiTimeframeSignal(symbol);
//   if (!signalData) {
//     console.log(`No consistent multi-timeframe signal for ${symbol}`);
//     return;
//   }
//   console.log(`Signal for ${symbol}: ${signalData.signal} at raw price ${signalData.rawPrice}`);

//   // Prüfe, ob bereits ein Trade für dieses Symbol offen ist
//   // const openPositions = await getOpenPositionsCount();
//   // if (openPositions >= 5) {
//   //   console.log(`Max open positions reached (${openPositions}). No new trade for ${symbol}.`);
//   //   return;
//   // }

//   const currentRawPrice = await getCurrentPrice(symbol);
//   console.log(`Current market price for ${symbol}: ${currentRawPrice}`);

//   const balance = await getAccountBalance();
//   if (!balance) {
//     console.error("Couldn't check balance!");
//     return;
//   }

//   const positionSize = calculatePositionSize(balance, CONFIG.riskPerTrade, CONFIG.stopLossPips, symbol);
//   console.log(`Placing ${signalData.signal} trade for ${symbol} with lot size: ${positionSize}`);
//   await executeTradeForSymbol(symbol, signalData.signal, currentRawPrice, positionSize);
// }

// // Iteriere über alle definierten Symbole und prüfe einzeln
// async function checkAllPairsAndTrade() {
//   for (let symbol of Object.values(CONFIG.symbols)) {
//     await checkAndTradeForSymbol(symbol);
//   }
// }

// const checkTradeStatus = async (orderId) => {
//   try {
//     const tradeStatus = await x.Socket.send.tradeTransactionStatus({
//       order: orderId,
//     });
//     console.log("Trade status:", tradeStatus);
//     return tradeStatus;
//   } catch (err) {
//     console.error("Failed to check trade status:", err);
//     return null;
//   }
// };

// const placeOrder = async () => {
//   const symbol = "EURUSD";
//   const currentRawPrice = await getCurrentPrice(symbol);
//   if (!currentRawPrice) {
//     console.error("Failed to retrieve current price.");
//     return;
//   }

//   // Calculate proper values with factor adjustment
//   const factor = symbol.includes("JPY") ? 1000 : 100000;
//   const pipMultiplier = getPipMultiplier(symbol);

//   // Convert raw price to actual price format
//   const entry = normalizePrice(symbol, currentRawPrice);

//   // Calculate SL/TP in actual price format (not pips)
//   const slDistance = CONFIG.stopLossPips * (pipMultiplier * factor);
//   const tpDistance = CONFIG.takeProfitPips * (pipMultiplier * factor);

//   const sl = normalizePrice(symbol, currentRawPrice - slDistance);
//   const tp = normalizePrice(symbol, currentRawPrice + tpDistance);

//   // Use fixed volume for testing
//   const volume = 0.01; // Minimum lot size for most brokers

//   const orderData = {
//     cmd: 0, // BUY
//     symbol: symbol,
//     price: entry,
//     sl: sl,
//     tp: tp,
//     volume: volume,
//     type: 0,
//     order: 0,
//   };

//   try {
//     console.log("Attempting to place order with data:", orderData);
//     const result = await x.Socket.send.tradeTransaction(orderData);
//     console.log("Order response:", result);

//     // Fix the success check condition
//     if (result && result.data && result.data.returnData && result.data.returnData.order) {
//       const orderId = result.data.returnData.order;
//       console.log("Order successfully placed with ID:", orderId);

//       // Check trade status after a short delay
//       setTimeout(async () => {
//         await checkTradeStatus(orderId);
//       }, 1000);
//     } else {
//       console.error("Order not accepted - no order ID in response");
//     }
//   } catch (err) {
//     console.error("Order failed:", err);
//   }
// };

// const test = async () => {
//   // --- Backtesting für alle Paare ---
//   // console.log("Starting backtesting...");
//   // await backtestStrategy(
//   //   CONFIG.symbols.EURUSD,
//   //   CONFIG.timeframe.M1,
//   //   Math.floor(new Date("2023-01-14T00:00:00Z").getTime() / 1000),
//   //   Math.floor(new Date("2023-02-14T00:00:00Z").getTime() / 1000)
//   // );
// };

// // Main function
// const startBot = async () => {
//   try {
//     // Remove the duplicate connection call
//     const connected = await connectXAPI();

//     if (!connected) {
//       console.error("Failed to connect to XTB API. Exiting...");
//       return;
//     }

//     // Fix for Stream subscription - wrap in try/catch blocks
//     try {
//       console.log("Subscribing to balance stream...");
//       x.Stream.subscribe.getBalance();
//       console.log("Balance-Stream abonniert");
//     } catch (err) {
//       console.error("Fehler beim Abonnieren des Balance-Streams:", err);
//     }

//     try {
//       console.log("Subscribing to trades stream...");
//       x.Stream.subscribe.getTrades();
//       console.log("Trades-Stream abonniert");
//     } catch (err) {
//       console.error("Fehler beim Abonnieren des Trades-Streams:", err);
//     }

//     // Register balance listener
//     try {
//       x.Stream.listen.getBalance((data) => {
//         if (data && data.balance !== undefined) {
//           currentBalance = data.balance;
//           console.log("Balance updated:", currentBalance);
//         } else {
//           console.error("Ungültige Balance-Daten:", data);
//         }
//       });
//     } catch (err) {
//       console.error("Error setting up balance listener:", err);
//     }

//     // Listener registrieren
//     x.Stream.listen.getTrades((data) => {
//       if (data) {
//         console.log("trades:", data);
//       } else {
//         console.error("no trades data:", data);
//       }
//     });

//     console.log("Bot läuft...");

//     // For testing, run backtesting instead of live trading
//     await test().catch((err) => {
//       console.error("Error in test function:", err);
//     });

//     // Comment out the interval for now
//     /*
//     setInterval(() => {
//       placeOrder().catch((err) => {
//         console.error("Error in placeOrder:", err);
//       });
//     }, 10000);
//     */
//   } catch (error) {
//     console.error("Error in startBot:", error);
//   }
// };

// startBot();
