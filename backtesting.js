// backtesting.js
const { x, getSocketId } = require("./xapi");
const { calculateEMA, calculateMACD } = require("./indicators");
const { CONFIG } = require("./config");

const normalizePrice = (symbol, rawPrice) => {
  const factor = symbol.includes("JPY") ? 1000 : 100000;
  return parseFloat((rawPrice / factor).toFixed(5));
};

const getPipMultiplier = (symbol) => {
  return symbol.includes("JPY") ? 0.01 : 0.0001;
};

const generateSignal = (closes, symbol) => {
  const normalizedCloses = closes.map((price) => price);
  // console.log('normalizedCloses:', normalizedCloses);

  const fastEMA = calculateEMA(normalizedCloses, CONFIG.fastEMA);
  const slowEMA = calculateEMA(normalizedCloses, CONFIG.slowEMA);
  const macd = calculateMACD(normalizedCloses);
  const entryRaw = normalizedCloses[normalizedCloses.length - 1];
  // console.log("entryRaw:", entryRaw);

  // console.log("normalized fastEMA:", fastEMA, "normalized slowEMA:", slowEMA);

  if (fastEMA === null || slowEMA === null) return null;
  
  if (fastEMA > slowEMA && macd.histogram > 0) {
    return { signal: "BUY", entryRaw };
  } else if (fastEMA < slowEMA && macd.histogram < 0) {
    return { signal: "SELL", entryRaw };
  }
  return null;
};

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

  // Normalisiere die relevanten Kerzendaten (close, high, low)
  candles.forEach((candle) => {
    candle.close = normalizePrice(symbol, candle.close);
    candle.high = normalizePrice(symbol, candle.high);
    candle.low = normalizePrice(symbol, candle.low);
  });

  let trades = [];
  let equityCurve = [];
  let equity = 500; // Startkapital
  const initialCapital = equity;
  const factor = symbol.includes("JPY") ? 1000 : 100000;
  const pipMultiplier = getPipMultiplier(symbol);
  const maxDrawdownPctLimit = CONFIG.maxDrawdownPctLimit;
  const maxDuration = CONFIG.maxTradeDurationCandles; // Feste Trade-Dauer in Candles

  // Starte ab einem Index, an dem genügend Daten vorhanden sind (hier ab Index 50)
  for (let i = 50; i < candles.length - 1; i++) {
    if (((initialCapital - equity) / initialCapital) * 100 >= maxDrawdownPctLimit) {
      console.log("Maximaler Drawdown erreicht – Backtesting wird gestoppt.");
      break;
    }

    const slice = candles.slice(0, i + 1);
    const rawCloses = slice.map((c) => c.close);

    // Signal generieren
    const signalData = generateSignal(rawCloses, symbol);
    if (!signalData) continue;
    const entryRaw = signalData.entryRaw; 
    // console.log("Signal:", signalData);

    // Feste SL/TP-Abstände (in Pips)
    const riskDistance = CONFIG.stopLossPips * pipMultiplier;
    const rewardDistance = CONFIG.takeProfitPips * pipMultiplier;
    // console.log(`Risk Distance: ${riskDistance}, Reward Distance: ${rewardDistance}`);

    const expectedRR = rewardDistance / riskDistance;
    if (expectedRR < CONFIG.minRR) {
      return;
    }

    // Exit‑Logik: Suche in den nächsten maxDuration Candles nach einem Exit‑Event
    let exitRaw = null;
    let exitReason = null;
    let durationCandles = 0;
    for (let j = i + 1; j < Math.min(i + 1 + maxDuration, candles.length); j++) {
      durationCandles = j - i;
      const candle = candles[j];
      // Nutze die normalisierten Werte (High/Low)
      const normLow = candle.low;
      const normHigh = candle.high;
      // console.log('normal', normLow, normHigh);

      if (signalData.signal === "BUY") {
        if (normLow <= entryRaw - riskDistance) {
          exitRaw = entryRaw - riskDistance;
          exitReason = "SL";
          break;
        }
        if (normHigh >= entryRaw + rewardDistance) {
          exitRaw = entryRaw + rewardDistance;
          exitReason = "TP";
          // console.log("exit raw", exitRaw, entryRaw, riskDistance);
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
    // Falls kein Exit innerhalb von maxDuration Candles gefunden wurde:
    if (exitRaw === null) {
      exitRaw = candles[Math.min(i + maxDuration, candles.length - 1)].close;
      exitReason = "EndOfPeriod";
      durationCandles = Math.min(maxDuration, candles.length - i - 1);
    }

    const profitRaw = signalData.signal === "BUY" ? exitRaw - entryRaw : entryRaw - exitRaw;
    const profitPips = profitRaw / pipMultiplier;
    const profitPct = ((exitRaw - entryRaw) / entryRaw) * 100;

    trades.push({
      signal: signalData.signal,
      entry: entryRaw,
      exit: exitRaw,
      profit: parseFloat(profitRaw.toFixed(5)),
      profitPct: parseFloat(profitPct.toFixed(2)),
      profitPips: parseFloat(profitPips.toFixed(5)),
      durationCandles,
      exitReason,
      rrRatio: expectedRR.toFixed(2),
    });
    equity += profitRaw;
    equityCurve.push(parseFloat(equity.toFixed(2)));

  }

  // Kennzahlen berechnen
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
