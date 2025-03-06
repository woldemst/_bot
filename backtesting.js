  // backtesting.js
  const { x, getSocketId } = require("./xapi");
  const { calculateEMA, calculateBollingerBands, calculateATR } = require("./indicators");
  // config.js
  const CONFIG = {
    // Indikatorparameter
    fastEMA: 8, // Schneller EMA (Einstieg/Pullback)
    slowEMA: 21, // Langsamer EMA (Trendfilter)

    atrMultiplierSL: 1.5,
    atrMultiplierTP: 2.0,
    // Bollinger-Band-Parameter (für erweiterte Strategie)
    bbPeriod: 20,
    bbMultiplier: 2,
    // Backtesting-Parameter
    maxTradeDurationCandles: 10,
    maxDrawdownPctLimit: 20,
    minRR: 2.0,
  };

  // Normalisierungsfunktion: Wandelt Rohpreise in den tatsächlichen Kurs um
  const normalizePrice = (symbol, rawPrice) => {
    const factor = symbol.includes("JPY") ? 1000 : 100000;
    return parseFloat((rawPrice / factor).toFixed(5));
  };

  const getPipMultiplier = (symbol) => {
    return symbol.includes("JPY") ? 0.01 : 0.0001;
  };

  // Signalgenerierung (Beispiel: Bollinger‑Bands + EMA-Filter)
  const generateSignal = (closes) => {
    // Berechne die beiden EMAs
    const fastEMA = calculateEMA(closes, CONFIG.fastEMA);
    const slowEMA = calculateEMA(closes, CONFIG.slowEMA);
    // Berechne Bollinger‑Bänder (über CONFIG.bbPeriod, bbMultiplier)
    const bb = calculateBollingerBands(closes, CONFIG.bbPeriod, CONFIG.bbMultiplier);
    const entryRaw = closes[closes.length - 1];

    // Logik: Long (BUY), wenn Trend (fastEMA > slowEMA) und der Preis am oder unter dem unteren Band liegt.
    // Short (SELL) analog.
    if (fastEMA > slowEMA && entryRaw <= bb.lowerBand) {
      return { signal: "BUY", entryRaw };
    } else if (fastEMA < slowEMA && entryRaw >= bb.upperBand) {
      return { signal: "SELL", entryRaw };
    }
    return null;
  };

  // Backtesting-Funktion
  const backtestStrategy = async (symbol, timeframe, startTimestamp, endTimestamp) => {
    console.log(`Backtesting ${symbol} von ${new Date(startTimestamp * 1000)} bis ${new Date(endTimestamp * 1000)}`);

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
    const maxDrawdownPctLimit = CONFIG.maxDrawdownPctLimit;
    const maxDuration = CONFIG.maxTradeDurationCandles;

    // Iteriere über den Zeitraum, ab Index 50 (um genügend Daten zu haben)
    for (let i = 50; i < candles.length - 1; i++) {
      // Drawdown prüfen
      if (((initialCapital - equity) / initialCapital) * 100 >= maxDrawdownPctLimit) {
        console.log("Maximaler Drawdown erreicht – keine weiteren Trades simuliert.");
        break;
      }

      const slice = candles.slice(0, i + 1);
      const closes = slice.map((c) => c.close);
      const signalData = generateSignal(closes);
      if (!signalData) continue;

      const entryRaw = signalData.entryRaw;

      // ATR-basierte dynamische SL/TP-Berechnung (nutze die letzten 15 Candles)
      const atr = calculateATR(slice.slice(-15));
      if (!atr) continue;
      const riskDistance = atr * CONFIG.atrMultiplierSL;
      const rewardDistance = atr * CONFIG.atrMultiplierTP;
      const expectedRR = rewardDistance / riskDistance;
      if (expectedRR < CONFIG.minRR) continue;

      // Exit-Logik: Suche in den nächsten maxDuration Candles
      let exitRaw = null;
      let exitReason = null;
      let durationCandles = 0;
      for (let j = i + 1; j < Math.min(i + 1 + maxDuration, candles.length); j++) {
        durationCandles = j - i;
        const candle = candles[j];
        if (signalData.signal === "BUY") {
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
        } else if (signalData.signal === "SELL") {
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
      // Falls kein Exit-Event eintritt, benutze den Schlusskurs der letzten Candle des Betrachtungszeitraums
      if (exitRaw === null) {
        exitRaw = candles[Math.min(i + maxDuration, candles.length - 1)].close;
        exitReason = "EndOfPeriod";
        durationCandles = Math.min(maxDuration, candles.length - i - 1);
      }

      const profitRaw = signalData.signal === "BUY" ? exitRaw - entryRaw : entryRaw - exitRaw;
      const profitPips = profitRaw / (pipMultiplier * factor);
      const entryNorm = normalizePrice(symbol, entryRaw);
      const exitNorm = normalizePrice(symbol, exitRaw);
      const profitPct = ((exitNorm - entryNorm) / entryNorm) * 100;

      trades.push({
        signal: signalData.signal,
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
  };

  module.exports = { backtestStrategy };
