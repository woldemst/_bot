require("dotenv").config();
const XAPI = require("xapi-node").default;
const { TYPE_FIELD, CMD_FIELD } = XAPI;

// 1. Configuration
const CONFIG = {
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
  fastMA: 5, // EMA-Schnellperiode
  slowMA: 20, // EMA-Langperiode
  macdShort: 12,
  macdLong: 26,
  macdSignal: 9,
  rsiPeriod: 14,
  stopLossPips: 5, // Feste Stop-Loss-Pips als Fallback
  takeProfitPips: 10, // Feste Take-Profit-Pips als Fallback
  riskPerTrade: 0.02, // 2% Risiko pro Trade
  // Dynamische SL/TP: Multiplikatoren für ATR-basierte Berechnung
  atrMultiplierSL: 1.5,
  atrMultiplierTP: 2.0,
  // Backtesting-Parameter
  maxTradeDurationCandles: 10, // maximal betrachtete Candles für einen Trade
  maxDrawdownPctLimit: 10, // Stoppe Backtesting, wenn Drawdown 10% erreicht
  minRR: 2.0, // Mindest-Erwartungs-RR, damit ein Trade berücksichtigt wird
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
// --- Indikator-Funktionen ---

// Einfacher gleitender Durchschnitt
function calculateSMA(prices, period) {
  if (prices.length < period) return null;
  return prices.slice(-period).reduce((sum, price) => sum + price, 0) / period;
}

// Exponentieller gleitender Durchschnitt
function calculateEMA(prices, period) {
  if (prices.length < period) return null;
  const k = 2 / (period + 1);
  let ema = calculateSMA(prices.slice(0, period), period);
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

// MACD-Berechnung (Standard: 12, 26, 9)
function calculateMACD(prices, shortPeriod = CONFIG.macdShort, longPeriod = CONFIG.macdLong, signalPeriod = CONFIG.macdSignal) {
  let macdValues = [];
  for (let i = longPeriod - 1; i < prices.length; i++) {
    const shortSlice = prices.slice(i - shortPeriod + 1, i + 1);
    const longSlice = prices.slice(i - longPeriod + 1, i + 1);
    const emaShort = calculateEMA(shortSlice, shortPeriod);
    const emaLong = calculateEMA(longSlice, longPeriod);
    macdValues.push(emaShort - emaLong);
  }
  const signalLine = calculateEMA(macdValues, signalPeriod);
  const histogram = macdValues[macdValues.length - 1] - signalLine;
  return { macdLine: macdValues[macdValues.length - 1], signalLine, histogram };
}

// RSI-Berechnung (Standardperiode 14)
function calculateRSI(prices, period = CONFIG.rsiPeriod) {
  if (prices.length < period + 1) return null;
  let gains = 0,
    losses = 0;
  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// ATR-Berechnung (Average True Range, Standardperiode 14)
function calculateATR(candles, period = 14) {
  if (candles.length < period + 1) return null;
  let trs = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trs.push(tr);
  }
  return calculateSMA(trs, period);
}

// Beispiel: Dynamische SL/TP-Berechnung mit ATR
function calculateDynamicSLTP(entryRaw, atr, isBuy) {
  const slDistance = atr * CONFIG.atrMultiplierSL;
  const tpDistance = atr * CONFIG.atrMultiplierTP;
  if (isBuy) {
    return { sl: entryRaw - slDistance, tp: entryRaw + tpDistance };
  } else {
    return { sl: entryRaw + slDistance, tp: entryRaw - tpDistance };
  }
}

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
function normalizePrice(symbol, rawPrice) {
  // Für JPY-Paare durch 1000, sonst durch 100000
  const factor = symbol.includes("JPY") ? 1000 : 100000;
  return parseFloat((rawPrice / factor).toFixed(5));
}

function getPipMultiplier(symbol) {
  return symbol.includes("JPY") ? 0.01 : 0.0001;
}

function calculatePositionSize(accountBalance, riskPerTrade, stopLossPips, symbol) {
  // Hier wird das Risiko in Rohpunkten berechnet – Beachte, dass für Nicht-JPY der Faktor 100000 gilt
  const pipMultiplier = getPipMultiplier(symbol);
  const factor = symbol.includes("JPY") ? 1000 : 100000;
  const riskAmount = accountBalance * riskPerTrade;
  return riskAmount / (stopLossPips * (pipMultiplier * factor));
}

// --- Signal-Generierung --- //
// Prüft das Handelssignal basierend auf EMA, MACD und RSI
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

  // Nutze die letzten 50 Kerzen für stabilere Indikatorwerte
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

// Multi-Timeframe-Analyse: Prüft die Signale in M1, M15 und H1
const checkMultiTimeframeSignal = async (symbol) => {
  const signalM1 = await checkSignalForSymbol(symbol, CONFIG.timeframe.M1, CONFIG.fastMA, CONFIG.slowMA);
  const signalM15 = await checkSignalForSymbol(symbol, CONFIG.timeframe.M15, CONFIG.fastMA, CONFIG.slowMA);
  const signalH1 = await checkSignalForSymbol(symbol, CONFIG.timeframe.H1, CONFIG.fastMA, CONFIG.slowMA);

  if (!signalM1 || !signalM15 || !signalH1) {
    console.error(`Not enough data for ${symbol}`);
    return null;
  }
  if (signalM1.signal === signalM15.signal && signalM15.signal === signalH1.signal) {
    return { signal: signalM1.signal, rawPrice: signalM1.rawPrice };
  }
  return null;
};

// --- Orderausführung --- //
// Orderausführung: Nutzt den normalisierten Preis, um Entry, SL und TP zu berechnen.
async function executeTradeForSymbol(symbol, direction, rawPrice, lotSize) {
  const factor = symbol.includes("JPY") ? 1000 : 100000;
  const pipMultiplier = getPipMultiplier(symbol);
  const spreadRaw = 0.0002 * factor;
  const rawEntry = direction === "BUY" ? rawPrice + spreadRaw : rawPrice;
  const entry = normalizePrice(symbol, rawEntry);

  // ATR-Berechnung: Hole die letzten 14 Candles (oder passe die Periode an)
  const candles = await getHistoricalData(symbol, CONFIG.timeframe.M1);
  const atr = calculateATR(candles.slice(-15)); // let’s assume 15 Candles for ATR calculation

  let sl, tp;
  if (atr) {
    const dynamicSLTP = calculateDynamicSLTP(rawEntry, atr, direction === "BUY");
    sl = normalizePrice(symbol, dynamicSLTP.sl);
    tp = normalizePrice(symbol, dynamicSLTP.tp);
  } else {
    // Fallback: Feste SL/TP-Berechnung
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
  console.log("entry:", entry, "stop loss:", sl, "take profit:", tp);

  try {
    const order = await x.Socket.send
      .tradeTransaction({
        cmd: direction === "BUY" ? 0 : 1, // 0 = BUY, 1 = SELL
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
}

// Offene Positionen (als Promise verpackt) //
async function getOpenPositionsForSymbol(symbol) {
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
}

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

  const openPositionsForSymbol = await getOpenPositionsForSymbol(symbol);
  if (openPositionsForSymbol >= 1) {
    console.log(`Trade for ${symbol} is already open. Skipping new trade.`);
    return;
  }

  const openPositions = await getOpenPositionsCount();
  if (openPositions >= 5) {
    console.log(`Max open positions reached (${openPositions}). No new trade for ${symbol}.`);
    return;
  }

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

// --- Backtesting-Funktion ---
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
  let equity = 1000; // Startkapital
  const initialCapital = equity;

  const factor = symbol.includes("JPY") ? 1000 : 100000;
  const pipMultiplier = getPipMultiplier(symbol);
  const riskDistance = CONFIG.stopLossPips * (pipMultiplier * factor);
  const rewardDistance = CONFIG.takeProfitPips * (pipMultiplier * factor);
  const expectedRR = rewardDistance / riskDistance;

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

const test = async () => {
  const startTimestamp = Math.floor(new Date("2025-01-14T00:00:00Z").getTime() / 1000);
  const endTimestamp = Math.floor(new Date("2025-02-14T00:00:00Z").getTime() / 1000);
  const backtestResult = await backtestStrategy(CONFIG.symbols.GBPUSD, CONFIG.timeframe.M5, startTimestamp, endTimestamp);
  // Hier kannst du das Backtesting-Ergebnis weiter analysieren
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

    // Listener registrieren
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
        // console.log("trades:", data);
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
