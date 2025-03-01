// backtesting.js
const { calculateSMA, calculateEMA, calculateMACD, calculateRSI, calculateATR, normalizePrice, getPipMultiplier } = require('./indicators');

const CONFIG = require('./config');

async function backtestStrategy(xapi, symbol, timeframe, startTimestamp, endTimestamp) {
  console.log(`Backtesting ${symbol} from ${new Date(startTimestamp * 1000)} to ${new Date(endTimestamp * 1000)}`);
  let allData;
  try {
    allData = await xapi.getPriceHistory({ symbol, period: timeframe, start: startTimestamp, end: endTimestamp });
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

  // Simuliere Trades ab Candle 50 (um genügend Indikator-Daten zu haben)
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

    // Hier wird der Pullback-Filter eingebaut:
    const distancePct = Math.abs(entryRaw - fastEMA) / fastEMA;
    // Nur einsteigen, wenn der Preis innerhalb eines kleinen Prozentsatzes (maxDistancePct) vom schnellen EMA liegt
    if (distancePct > CONFIG.maxDistancePct) continue;

    let signal = null;
    if (fastEMA > slowEMA && macdData.histogram > 0 && rsiValue < CONFIG.rsiBuyThreshold) {
      signal = "BUY";
    } else if (fastEMA < slowEMA && macdData.histogram < 0 && rsiValue > CONFIG.rsiSellThreshold) {
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
  console.log("Equity Curve:", equityCurve);

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

// module.exports = { backtestStrategy };
