// backtesting.js
const { x, connectXAPI } = require("./xapi");
const { calculateEMA, calculateMACD, calculateRSI, calculateATR, calculateBollingerBands } = require("./indicators");
const { CONFIG } = require("./config");

const normalizePrice = (symbol, rawPrice) => {
  const factor = symbol.includes("JPY") ? 1000 : 100000;
  return parseFloat((rawPrice / factor).toFixed(5));
};

const getPipMultiplier = (symbol) => {
  return symbol.includes("JPY") ? 0.01 : 0.0001;
};

const generateSignal = (candles, symbol) => {
  if (candles.length < 50) return null;
  candles.forEach((candle) => {
    const date = new Date(candle.timestamp);
    // console.log(date.toISOString());
  });

  // console.log("candles", candles);
  const closes = candles.map((c) => c.close);

  // EMA
  const fastEMA = calculateEMA(closes, CONFIG.fastEMA);
  const slowEMA = calculateEMA(closes, CONFIG.slowEMA);

  // Trend identification
  const macd = calculateMACD(closes);

  const entryRaw = closes[closes.length - 1];
  const prevClose = closes[closes.length - 2];

  if (fastEMA > slowEMA && macd.histogram > 0) {
    return { signal: "BUY", entryRaw };
  }
  // SELL Signal: EMA cross + MACD + RSI + Bollinger Bands (overbought)
  else if (fastEMA < slowEMA && macd.histogram < 0) {
    return { signal: "SELL", entryRaw };
  }

  return null;
};

const backtestStrategy = async (symbol, candles) => {
  // console.log("backtestStrategy", historicalData);

  // console.log(`Backtesting: ${candles.length} candles loaded.`);

  candles.forEach((candle) => {
    candle.close = normalizePrice(symbol, candle.close);
    candle.high = normalizePrice(symbol, candle.high);
    candle.low = normalizePrice(symbol, candle.low);
  });

  // Use defined starting capital
  let equity = CONFIG.initialCapital;
  const initialCapital = equity;
  const pipMultiplier = getPipMultiplier(symbol);
  const maxDrawdownPctLimit = CONFIG.maxDrawdownPctLimit || 20;
  const maxDuration = CONFIG.maxTradeDurationCandles || 20; // Increased maximum duration
  const trailingStopPips = CONFIG.trailingStopPips || 10;

  let trades = [];
  let equityCurve = [];
  let consecutiveLosses = 0;

  // Trade filter based on market conditions
  const isVolatilityOK = (candles, i) => {
    if (i < 14) return false;
    const atr = calculateATR(candles.slice(i - 14, i + 1));
    return atr > 0.0002; // Minimum volatility for scalping
  };

  // Time filter: Main trading hours (simplified)
  const isGoodTradingHour = (timestamp) => {
    const date = new Date(timestamp);
    const hour = date.getUTCHours();
    // London (8-16 UTC) and NY (13-21 UTC) overlap for liquidity
    return (hour >= 8 && hour < 16) || (hour >= 13 && hour < 21);
  };

  for (let i = 50; i < candles.length - 1; i++) {
    // Max Drawdown Check
    // if (((initialCapital - equity) / initialCapital) * 100 >= maxDrawdownPctLimit) {
    //   console.log("Maximum drawdown reached - stopping backtest.");
    //   break;
    // }
    // Additional filters
    // if (!isVolatilityOK(candles, i)) continue;
    // if (!isGoodTradingHour(candles[i].ctm)) continue;

    const slice = candles.slice(0, i + 1);
    const signalData = generateSignal(slice, symbol);
    if (!signalData) continue;
    const entryRaw = signalData.entryRaw;

    // Dynamic SL/TP based on ATR
    const atr = calculateATR(slice);
    const atrMultiplierSL = CONFIG.atrMultiplierSL;
    const atrMultiplierTP = CONFIG.atrMultiplierTP;

    // Dynamic risk/reward based on ATR
    const slDistance = atr * atrMultiplierSL;
    const tpDistance = atr * atrMultiplierTP;

    // Min RR Check
    const expectedRR = tpDistance / slDistance;
    if (expectedRR < CONFIG.minRR || expectedRR < 1.5) continue;

    let exitRaw = null;
    let exitReason = null;
    let durationCandles = 0;
    let highestPrice = signalData.signal === "BUY" ? entryRaw : null;
    let lowestPrice = signalData.signal === "SELL" ? entryRaw : null;

    // Initial SL & TP
    let currentSL = signalData.signal === "BUY" ? entryRaw - slDistance : entryRaw + slDistance;
    let currentTP = signalData.signal === "BUY" ? entryRaw + tpDistance : entryRaw - tpDistance;

    // Trailing Stop Logic
    let trailingStopActivated = false;
    let trailingStopLevel = currentSL;

    for (let j = i + 1; j < Math.min(i + 1 + maxDuration, candles.length); j++) {
      durationCandles = j - i;
      const candle = candles[j];
      const normLow = candle.low;
      const normHigh = candle.high;

      // Update highest/lowest price for Trailing Stop
      if (signalData.signal === "BUY") {
        if (normHigh > highestPrice) {
          highestPrice = normHigh;

          // Activate Trailing Stop when profit > 50% of TP
          if (highestPrice > entryRaw + tpDistance * 0.5) {
            trailingStopActivated = true;
            // New Trail Stop: Highest price minus X pips
            const newTrailingStop = highestPrice - trailingStopPips * pipMultiplier;
            // Only adjust if higher than current stop
            if (newTrailingStop > trailingStopLevel) {
              trailingStopLevel = newTrailingStop;
            }
          }
        }

        // SL Check - either initial or trailing
        const effectiveSL = trailingStopActivated ? trailingStopLevel : currentSL;

        if (normLow <= effectiveSL) {
          exitRaw = effectiveSL;
          exitReason = trailingStopActivated ? "TrailingSL" : "SL";
          break;
        }

        // TP Check
        if (normHigh >= currentTP) {
          exitRaw = currentTP;
          exitReason = "TP";
          break;
        }
      } else if (signalData.signal === "SELL") {
        if (normLow < lowestPrice || lowestPrice === null) {
          lowestPrice = normLow;

          // Activate Trailing Stop when profit > 50% of TP
          if (lowestPrice < entryRaw - tpDistance * 0.5) {
            trailingStopActivated = true;
            // New Trail Stop: Lowest price plus X pips
            const newTrailingStop = lowestPrice + trailingStopPips * pipMultiplier;
            // Only adjust if lower than current stop
            if (trailingStopLevel === null || newTrailingStop < trailingStopLevel) {
              trailingStopLevel = newTrailingStop;
            }
          }
        }

        // SL Check - either initial or trailing
        const effectiveSL = trailingStopActivated ? trailingStopLevel : currentSL;

        if (normHigh >= effectiveSL) {
          exitRaw = effectiveSL;
          exitReason = trailingStopActivated ? "TrailingSL" : "SL";
          break;
        }

        // TP Check
        if (normLow <= currentTP) {
          exitRaw = currentTP;
          exitReason = "TP";
          break;
        }
      }
    }

    // No rule hit - close at end of period
    if (exitRaw === null) {
      exitRaw = candles[Math.min(i + maxDuration, candles.length - 1)].close;
      exitReason = "EndOfPeriod";
      durationCandles = Math.min(maxDuration, candles.length - i - 1);
    }

    const profitRaw = signalData.signal === "BUY" ? exitRaw - entryRaw : entryRaw - exitRaw;

    // NaN Check
    if (isNaN(profitRaw)) continue;

    const profitPct = (profitRaw / entryRaw) * 100;

    // Risk Management: Set consecutiveLosses
    if (profitRaw <= 0) {
      consecutiveLosses++;
    } else {
      consecutiveLosses = 0;
    }

    trades.push({
      timestamp: new Date(candles[i].ctm).toLocaleString(),
      symbol,
      signal: signalData.signal,
      entry: parseFloat(entryRaw.toFixed(5)),
      exit: parseFloat(exitRaw.toFixed(5)),
      sl: parseFloat(currentSL.toFixed(5)),
      tp: parseFloat(currentTP.toFixed(5)),
      profit: parseFloat(profitRaw.toFixed(5)),
      profitPct: parseFloat(profitPct.toFixed(2)),
      duration: durationCandles,
      exitReason,
      rrRatio: expectedRR.toFixed(2),
      usedTrailing: trailingStopActivated,
    });

    // Position sizing (fixed size for simplicity)
    const riskAmount = initialCapital * (CONFIG.riskPerTrade || 0.02);
    const pipsRisked = slDistance / pipMultiplier;
    const positionSize = riskAmount / pipsRisked;

    // Apply profit to account
    equity += profitRaw * (positionSize * 100000); // Scale profit
    equityCurve.push(parseFloat(equity.toFixed(2)));

    // After each trade: Check for large drawdowns and volume
    // Wait at least X candles after each trade
    i += CONFIG.waitCandlesAfterTrade || 5;
  }

  // Calculate metrics
  const totalTrades = trades.length;
  const wins = trades.filter((t) => t.profit > 0).length;
  const losses = totalTrades - wins;
  const winRate = totalTrades ? (wins / totalTrades) * 100 : 0;
  const totalProfit = equity - initialCapital;
  const totalProfitPct = (totalProfit / initialCapital) * 100;
  const avgProfit = totalTrades ? totalProfit / totalTrades : 0;
  const avgProfitPct = totalTrades ? totalProfitPct / totalTrades : 0;

  // Breakdown by exit reason
  const exitsByReason = {};
  trades.forEach((trade) => {
    exitsByReason[trade.exitReason] = (exitsByReason[trade.exitReason] || 0) + 1;
  });

  // Calculate drawdown and additional metrics
  let maxDrawdown = 0;
  let peak = initialCapital;
  let currentDrawdown = 0;
  let maxConsecutiveLosses = 0;
  let currentConsecutiveLosses = 0;

  // Calculate profit factor
  const grossProfit = trades.filter((t) => t.profit > 0).reduce((sum, t) => sum + t.profit, 0);
  const grossLoss = Math.abs(trades.filter((t) => t.profit < 0).reduce((sum, t) => sum + t.profit, 0));
  const profitFactor = grossLoss === 0 ? "Infinite" : (grossProfit / grossLoss).toFixed(2);

  // Sort trades by date
  trades.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  // Calculate extended metrics
  for (let i = 0; i < trades.length; i++) {
    const trade = trades[i];

    // Consecutive Losses
    if (trade.profit < 0) {
      currentConsecutiveLosses++;
      if (currentConsecutiveLosses > maxConsecutiveLosses) {
        maxConsecutiveLosses = currentConsecutiveLosses;
      }
    } else {
      currentConsecutiveLosses = 0;
    }
  }

  // Calculate drawdown from equity curve
  for (let i = 0; i < equityCurve.length; i++) {
    if (equityCurve[i] > peak) {
      peak = equityCurve[i];
      currentDrawdown = 0;
    } else {
      currentDrawdown = peak - equityCurve[i];
      if (currentDrawdown > maxDrawdown) {
        maxDrawdown = currentDrawdown;
      }
    }
  }

  const maxDrawdownPct = (maxDrawdown / initialCapital) * 100;
  const avgDuration = totalTrades ? trades.reduce((sum, t) => sum + t.duration, 0) / totalTrades : 0;
  const avgRR = totalTrades ? trades.reduce((sum, t) => sum + parseFloat(t.rrRatio), 0) / totalTrades : 0;

  // Calculate Sharpe Ratio (annualized with assumed standard deviation)
  const returns = [];
  let prevEquity = initialCapital;
  for (let i = 0; i < equityCurve.length; i++) {
    const returnPct = (equityCurve[i] - prevEquity) / prevEquity;
    returns.push(returnPct);
    prevEquity = equityCurve[i];
  }

  const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const stdDeviation = Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length);
  const sharpeRatio = stdDeviation ? (avgReturn / stdDeviation) * Math.sqrt(252) : 0; // Annualized with 252 trading days

  // Output detailed results
  console.log(`\nBacktesting Results for ${symbol}:`);
  console.log(`Total Trades: ${totalTrades}`);
  console.log(`Winning Trades: ${wins} (${winRate.toFixed(2)}%)`);
  console.log(`Losing Trades: ${losses} (${(100 - winRate).toFixed(2)}%)`);
  console.log(`Total Profit: ${totalProfit.toFixed(2)}€ (${totalProfitPct.toFixed(2)}%)`);
  console.log(`Average Profit per Trade: ${avgProfit.toFixed(2)}€ (${avgProfitPct.toFixed(2)}%)`);
  console.log(`Maximum Drawdown: ${maxDrawdown.toFixed(2)}€ (${maxDrawdownPct.toFixed(2)}%)`);
  console.log(`Average Trade Duration (Candles): ${avgDuration.toFixed(2)}`);
  console.log(`Average Risk-Reward Ratio: ${avgRR.toFixed(2)}`);
  console.log(`Profit Factor: ${profitFactor}`);
  console.log(`Sharpe Ratio (annualized): ${sharpeRatio.toFixed(2)}`);
  console.log(`Maximum Consecutive Losses: ${maxConsecutiveLosses}`);
  console.log(`Exit Reasons:`, exitsByReason);

  // Output trade sample
  console.log("\nSample of first 5 trades:");
  console.log(trades.slice(0, 5));

  console.log("\nSample of last 5 trades:");
  console.log(trades.slice(-5));

  console.log("\nEquity Curve (Start, Middle, End):");
  console.log("Start:", equityCurve.slice(0, 3));
  console.log("Middle:", equityCurve.slice(Math.floor(equityCurve.length / 2) - 1, Math.floor(equityCurve.length / 2) + 2));
  console.log("End:", equityCurve.slice(-3));

  // Analyze trading intervals
  let tradesByHour = {};
  let tradesByDay = {};

  trades.forEach((trade) => {
    const date = new Date(trade.timestamp);
    const hour = date.getHours();
    const day = date.getDay();

    // Hour
    tradesByHour[hour] = tradesByHour[hour] || { total: 0, wins: 0 };
    tradesByHour[hour].total++;
    if (trade.profit > 0) tradesByHour[hour].wins++;

    // Day
    tradesByDay[day] = tradesByDay[day] || { total: 0, wins: 0 };
    tradesByDay[day].total++;
    if (trade.profit > 0) tradesByDay[day].wins++;
  });

  console.log("\nTrade Distribution by Hour:");
  Object.keys(tradesByHour).forEach((hour) => {
    const data = tradesByHour[hour];
    console.log(`${hour}:00 - ${data.total} Trades, ${((data.wins / data.total) * 100).toFixed(2)}% Win Rate`);
  });

  console.log("\nTrade Distribution by Weekday:");
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  Object.keys(tradesByDay).forEach((day) => {
    const data = tradesByDay[day];
    console.log(`${dayNames[day]} - ${data.total} Trades, ${((data.wins / data.total) * 100).toFixed(2)}% Win Rate`);
  });

  return {
    totalTrades,
    wins,
    losses,
    winRate,
    totalProfit,
    totalProfitPct,
    avgProfit,
    avgProfitPct,
    maxDrawdown,
    maxDrawdownPct,
    avgDuration,
    avgRR,
    profitFactor,
    sharpeRatio,
    maxConsecutiveLosses,
    exitsByReason,
    trades,
    equityCurve,
    tradesByHour,
    tradesByDay,
  };
};

module.exports = { backtestStrategy };
