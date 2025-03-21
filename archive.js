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
