// backtesting.js

const { x, getSocketId } = require("./xapi");
const { calculateEMA, calculateATR } = require("./indicators");
const { CONFIG } = require("./config");

// Normalisierungsfunktion: Wandelt Rohpreise in den tatsächlichen Kurs um
const normalizePrice = (symbol, rawPrice) => {
  const factor = symbol.includes("JPY") ? 1000 : 100000;
  return parseFloat((rawPrice / factor).toFixed(5));
};

// Liefert den Pip‑Multiplier (z.B. 0.0001 für die meisten Paare, 0.01 für JPY-Paare)
const getPipMultiplier = (symbol) => {
  return symbol.includes("JPY") ? 0.01 : 0.0001;
};

/**
 * generateSignal – Generiert ein Handelssignal basierend auf dem EMA‑Filter.
 * Hier: Long (BUY), wenn der schnelle EMA über dem langsamen EMA liegt,
 * ansonsten Short (SELL) – rein mathematisch. (Dies ist eine Vereinfachung.)
 *
 * @param {number[]} closes - Array der Rohschlusskurse
 * @param {string} symbol - z.B. "EURUSD"
 * @returns {object|null} - { signal: "BUY"|"SELL", entryRaw } oder null
 */
const generateSignal = (closes, symbol) => {
  // Normalisiere die Schlusskurse
  const normalizedCloses = closes.map(price => normalizePrice(symbol, price));
  const fastEMA = calculateEMA(normalizedCloses, CONFIG.fastEMA);
  const slowEMA = calculateEMA(normalizedCloses, CONFIG.slowEMA);
  const entryRaw = normalizedCloses[normalizedCloses.length - 1];

  // Debug-Ausgabe (optional)
  console.log("normalized fastEMA:", fastEMA, "normalized slowEMA:", slowEMA);

  if (fastEMA === null || slowEMA === null) {
    return null;
  }
  
  // Vereinfachte Logik: wenn fastEMA > slowEMA → BUY, sonst SELL
  if (fastEMA > slowEMA) {
    return { signal: "BUY", entryRaw };
  } else if (fastEMA < slowEMA) {
    return { signal: "SELL", entryRaw };
  }
  return null;
};

/**
 * backtestStrategy – Führt ein Backtesting der Handelsstrategie für das angegebene Symbol über den angegebenen Zeitraum aus.
 *
 * @param {string} symbol - z.B. "EURUSD"
 * @param {number} timeframe - z.B. 1 (M1)
 * @param {number} startTimestamp - Unix-Timestamp Start
 * @param {number} endTimestamp - Unix-Timestamp Ende
 * @returns {object} - Ergebnisobjekt mit Kennzahlen und Trade-Daten
 */
const backtestStrategy = async (symbol, timeframe, startTimestamp, endTimestamp) => {
  console.log(
    `\nBacktesting ${symbol} von ${new Date(startTimestamp * 1000).toLocaleString()} bis ${new Date(endTimestamp * 1000).toLocaleString()}`
  );

  let allData;
  try {
    allData = await x.getPriceHistory({
      symbol,
      period: timeframe,
      start: startTimestamp,
      end: endTimestamp,
      socketId: getSocketId(),
    });
  } catch (err) {
    console.error("Error during getPriceHistory:", err);
    return;
  }

  if (!allData || !allData.candles || allData.candles.length === 0) {
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
  const maxDrawdownPctLimit = CONFIG.maxDrawdownPctLimit;
  const maxDuration = CONFIG.maxTradeDurationCandles;

  // Starte ab einem Index, der genügend Daten für die Indikatoren liefert (hier ab Index 50)
  for (let i = 50; i < candles.length - 1; i++) {
    // Prüfe, ob der maximale Drawdown erreicht wurde
    if (((initialCapital - equity) / initialCapital) * 100 >= maxDrawdownPctLimit) {
      console.log("Maximaler Drawdown erreicht – Backtesting wird gestoppt.");
      break;
    }

    // Betrachte die bisherigen Candles bis Index i
    const slice = candles.slice(0, i + 1);
    const rawCloses = slice.map(c => c.close);

    // Generiere Signal basierend auf den normalisierten Schlusskursen
    const signalData = generateSignal(rawCloses, symbol);
    // console.log("Signal:", signalData);
    if (!signalData) continue;
    const entryRaw = signalData.entryRaw;

    const atr = calculateATR(slice.slice(-15));
    if (!atr) continue;
    const riskDistance = atr * CONFIG.atrMultiplierSL;
    const rewardDistance = atr * CONFIG.atrMultiplierTP;
    const expectedRR = rewardDistance / riskDistance;
    if (expectedRR < CONFIG.minRR) continue;

    // Suche nach einem Exit-Signal in den nächsten maxDuration Candles
    let exitRaw = null;
    let exitReason = null;
    let durationCandles = 0;
    for (let j = i + 1; j < Math.min(i + 1 + maxDuration, candles.length); j++) {
      durationCandles = j - i;
      const candle = candles[j];
      // Normalisiere die relevanten Werte des Candles
      const normLow = normalizePrice(symbol, candle.low);
      const normHigh = normalizePrice(symbol, candle.high);
      
      if (signalData.signal === "BUY") {
        if (normLow <= entryRaw - riskDistance) {
          exitRaw = entryRaw - riskDistance;
          exitReason = "SL";
          break;
        }
        if (normHigh >= entryRaw + rewardDistance) {
          exitRaw = entryRaw + rewardDistance;
          exitReason = "TP";
          break;
        }
      } else if (signalData.signal === "SELL") {
        if (normHigh >= entryRaw + riskDistance) {
          exitRaw = entryRaw + riskDistance;
          exitReason = "SL";
          break;
        }
        if (normLow <= entryRaw - rewardDistance) {
          exitRaw = entryRaw - rewardDistance;
          exitReason = "TP";
          break;
        }
      }
    }
    // Falls kein Exit-Signal gefunden wurde, verwende den Schlusskurs der letzten Candle im betrachteten Zeitraum
    if (exitRaw === null) {
      exitRaw = normalizePrice(symbol, candles[Math.min(i + maxDuration, candles.length - 1)].close);
      exitReason = "EndOfPeriod";
      durationCandles = Math.min(maxDuration, candles.length - i - 1);
    }

    const profitRaw = signalData.signal === "BUY" ? exitRaw - entryRaw : entryRaw - exitRaw;
    const profitPips = profitRaw / (pipMultiplier * factor);
    const profitPct = ((exitRaw - entryRaw) / entryRaw) * 100;

    trades.push({
      signal: signalData.signal,
      entry: entryRaw,
      exit: exitRaw,
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

  // Berechne Kennzahlen
  const totalTrades = trades.length;
  const wins = trades.filter(t => t.profit > 0).length;
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

  console.log(`\nBacktesting Ergebnisse für ${symbol}:`);
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
};

module.exports = { backtestStrategy };
