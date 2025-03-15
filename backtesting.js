// backtesting.js
const { x, getSocketId } = require("./xapi");
const { calculateEMA, calculateMACD, calculateATR } = require("./indicators");
const { CONFIG } = require("./config");

const normalizePrice = (symbol, rawPrice) => {
  const factor = symbol.includes("JPY") ? 1000 : 100000;
  return parseFloat((rawPrice / factor).toFixed(5));
};

const getPipMultiplier = (symbol) => {
  return symbol.includes("JPY") ? 0.01 : 0.0001;
};
const calculateDynamicSLTP = (entry, atr, isBuy) => {
  return {
    sl: isBuy ? entry - atr * CONFIG.atrMultiplierSL : entry + atr * CONFIG.atrMultiplierSL,
    tp: isBuy ? entry + atr * CONFIG.atrMultiplierTP : entry - atr * CONFIG.atrMultiplierTP,
  };
};
const calculatePositionSize = (equity, entry, sl, symbol) => {
  const riskAmount = equity * CONFIG.riskPerTrade;
  const riskPerUnit = Math.abs(entry - sl);
  return riskPerUnit > 0 ? (riskAmount / riskPerUnit).toFixed(2) : 0;
};

const generateSignal = (closes, candles, currentIndex, symbol) => {
  if (currentIndex < 50) return null;

  const fastEMA = calculateEMA(closes, CONFIG.fastEMA);
  const slowEMA = calculateEMA(closes, CONFIG.slowEMA);
  const macd = calculateMACD(closes);
  
  // M15 Trend-EMA50
  const m15Candles = candles.filter((_, idx) => idx <= currentIndex && idx % 15 === 0);
  const m15Closes = m15Candles.slice(-50).map(c => c.close);
  const m15EMA50 = calculateEMA(m15Closes, 50);

  if (!fastEMA || !slowEMA || !m15EMA50) return null;

  const price = closes[closes.length - 1];
  const m15Trend = price > m15EMA50 ? 'BULL' : 'BEAR';

  if (fastEMA > slowEMA && macd.histogram > 0 && m15Trend === 'BULL') {
    return { signal: "BUY", entryRaw: price };
  }
  if (fastEMA < slowEMA && macd.histogram < 0 && m15Trend === 'BEAR') {
    return { signal: "SELL", entryRaw: price };
  }
  return null;
};

const backtestStrategy = async (symbol, timeframe, startTimestamp, endTimestamp) => {
  console.log(`\n=== Backtesting ${symbol} ===`);

  const historicalData = await x.getPriceHistory({
    symbol,
    period: timeframe,
    start: startTimestamp,
    end: endTimestamp,
    socketId: getSocketId(),
  });

  if (!historicalData?.candles?.length) {
    console.error("No historical data found");
    return;
  }

  // Preprocess candles
  const candles = historicalData.candles.map(c => ({
    ...c,
    close: normalizePrice(symbol, c.close),
    high: normalizePrice(symbol, c.high),
    low: normalizePrice(symbol, c.low)
  }));

  let trades = [];
  let equity = CONFIG.initialCapital;
  let equityCurve = [equity];
  let maxDrawdown = 0;
  let peak = equity;

  for (let i = 50; i < candles.length - 1; i++) {
    const closes = candles.slice(0, i + 1).map(c => c.close);
    const signalData = generateSignal(closes, candles, i, symbol);
    if (!signalData) continue;

    // Risk management
    const atr = calculateATR(candles.slice(i - 14, i + 1));
    const { sl, tp } = calculateDynamicSLTP(signalData.entryRaw, atr, signalData.signal === 'BUY');
    const spread = symbol.includes("JPY") ? 0.02 : 0.0002;
    const entryPrice = signalData.signal === 'BUY' 
      ? signalData.entryRaw + spread 
      : signalData.entryRaw - spread;

    // Position sizing
    const riskAmount = equity * CONFIG.riskPerTrade;
    const riskPerUnit = Math.abs(entryPrice - sl);
    const positionSize = riskPerUnit > 0 ? riskAmount / riskPerUnit : 0;

    // Trade execution
    let exitPrice = null;
    let exitReason = 'EndOfPeriod';
    let duration = 0;
    
    for (let j = i + 1; j < Math.min(i + CONFIG.maxTradeDurationCandles + 1, candles.length); j++) {
      duration = j - i;
      const currentCandle = candles[j];

      const hitSL = signalData.signal === 'BUY' 
        ? currentCandle.low <= sl 
        : currentCandle.high >= sl;
      
      const hitTP = signalData.signal === 'BUY' 
        ? currentCandle.high >= tp 
        : currentCandle.low <= tp;

      if (hitSL || hitTP) {
        exitPrice = hitSL ? sl : tp;
        exitReason = hitSL ? 'SL' : 'TP';
        break;
      }
    }

    if (!exitPrice) {
      exitPrice = candles[Math.min(i + CONFIG.maxTradeDurationCandles, candles.length - 1)].close;
      duration = CONFIG.maxTradeDurationCandles;
    }

    // Profit calculation
    const profit = signalData.signal === 'BUY' 
      ? (exitPrice - entryPrice) * positionSize 
      : (entryPrice - exitPrice) * positionSize;

    equity += profit;
    equityCurve.push(equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
    if (equity > peak) peak = equity;

    trades.push({
      symbol,
      signal: signalData.signal,
      entry: entryPrice.toFixed(5),
      exit: exitPrice.toFixed(5),
      sl: sl.toFixed(5),
      tp: tp.toFixed(5),
      profit: profit.toFixed(2),
      duration,
      exitReason
    });
  }

  // Statistics calculation
  const totalTrades = trades.length;
  const wins = trades.filter(t => t.profit > 0).length;
  const losses = totalTrades - wins;
  const avgProfit = totalTrades > 0 
    ? trades.reduce((sum, t) => sum + parseFloat(t.profit), 0) / totalTrades 
    : 0;
  const avgRR = totalTrades > 0
    ? trades.reduce((sum, t) => {
        const risk = Math.abs(t.entry - t.sl);
        const reward = Math.abs(t.exit - t.entry);
        return sum + (reward / risk);
      }, 0) / totalTrades
    : 0;

  console.log(`
=== Ergebnisse ===
Symbol: ${symbol}
Trades: ${totalTrades}
Gewinne: ${wins} (${((wins/totalTrades)*100 || 0).toFixed(1)}%)
Verluste: ${losses}
Gesamtprofit: ${(equity - CONFIG.initialCapital).toFixed(2)}€
Durchschn. Profit/Trade: ${avgProfit.toFixed(2)}€
Max Drawdown: ${maxDrawdown.toFixed(2)}€ (${((maxDrawdown/CONFIG.initialCapital)*100).toFixed(1)}%)
Durchschn. Trade-Dauer: ${(trades.reduce((sum, t) => sum + t.duration, 0)/totalTrades || 0).toFixed(1)} Kerzen
Durchschn. R/R: ${avgRR.toFixed(2)}:1

Letzte 10 Trades:
${JSON.stringify(trades.slice(-10), null, 2)}

Equity Curve (letzte 10 Werte):
${equityCurve.slice(-10).map(v => v.toFixed(2)).join(', ')}
`);

  return {
    trades,
    equityCurve,
    statistics: {
      totalTrades,
      wins,
      losses,
      avgProfit,
      maxDrawdown,
      avgRR
    }
  };
};

module.exports = { backtestStrategy };
