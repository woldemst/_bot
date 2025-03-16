// backtesting.js - Verbesserte Version
const { x, getSocketId } = require("./xapi");
const { calculateEMA, calculateMACD, calculateRSI, calculateATR, calculateBollingerBands } = require("./indicators");
const { CONFIG } = require("./config");

const normalizePrice = (symbol, rawPrice) => {
  const factor = symbol.includes("JPY") ? 1000 : 100000;
  return parseFloat((rawPrice / factor).toFixed(5));
};

const getPipMultiplier = (symbol) => {
  return symbol.includes("JPY") ? 0.01 : 0.0001;
};

// Verbesserte Signal-Generierung mit mehreren Indikatoren
const generateSignal = (candles, symbol) => {
  // Brauchen mindestens 50 Kerzen für zuverlässige Berechnungen
  if (candles.length < 50) return null;
  candles.forEach((candle) => {
    const date = new Date(candle.timestamp);
    console.log(date.toISOString());
  });

  // console.log("candles", candles);
  const closes = candles.map((c) => c.close);

  // EMA-Kreuze
  const fastEMA = calculateEMA(closes, CONFIG.fastEMA);
  const slowEMA = calculateEMA(closes, CONFIG.slowEMA);

  // Trendindikatoren
  const macd = calculateMACD(closes);

  const entryRaw = closes[closes.length - 1];
  const prevClose = closes[closes.length - 2];

  if (fastEMA > slowEMA && macd.histogram > 0) {
    return { signal: "BUY", entryRaw };
  }
  // SELL Signal: EMA-Kreuz + MACD + RSI + Bollinger Bands (überkauft)
  else if (fastEMA < slowEMA && macd.histogram < 0) {
    return { signal: "SELL", entryRaw };
  }

  return null;
};

const backtestStrategy = async (symbol, timeframe, startTimestamp, endTimestamp) => {
  // console.log(`\nBacktesting ${symbol} from ${new Date(startTimestamp)} to ${new Date(endTimestamp)}`);

  let allData;
  
  try {
    allData = await x.getPriceHistory({
      symbol,
      period: timeframe,
      // start: startTimestamp,
      socketId: getSocketId(),
    });
  } catch (err) {
    console.error("Error during getPriceHistory:", err);
    return;
  }

  if (!allData || !allData.candles || allData.candles.length === 0) {
    console.error("No historical data found.");
    return;
  }

  const candles = allData.candles;
  console.log(`Backtesting: ${candles.length} candles loaded.`);

  // Normalisiere Candle-Daten
  candles.forEach((candle) => {
    candle.close = normalizePrice(symbol, candle.close);
    candle.high = normalizePrice(symbol, candle.high);
    candle.low = normalizePrice(symbol, candle.low);
  });

  // Nutze ein definiertes Startkapital
  let equity = CONFIG.initialCapital;
  const initialCapital = equity;
  const pipMultiplier = getPipMultiplier(symbol);
  const maxDrawdownPctLimit = CONFIG.maxDrawdownPctLimit || 20;
  const maxDuration = CONFIG.maxTradeDurationCandles || 20; // Erhöhte maximale Dauer
  const trailingStopPips = CONFIG.trailingStopPips || 10;

  let trades = [];
  let equityCurve = [];
  let consecutiveLosses = 0;

  // Trade-Filter basierend auf Marktbedingungen
  const isVolatilityOK = (candles, i) => {
    if (i < 14) return false;
    const atr = calculateATR(candles.slice(i - 14, i + 1));
    return atr > 0.0002; // Mindestvolatilität für Scalping
  };

  // Zeit-Filter: Haupthandelszeiten (vereinfacht)
  const isGoodTradingHour = (timestamp) => {
    const date = new Date(timestamp);
    const hour = date.getUTCHours();
    // London (8-16 UTC) und NY (13-21 UTC) Überlappung für Liquidität
    return (hour >= 8 && hour < 16) || (hour >= 13 && hour < 21);
  };

  for (let i = 50; i < candles.length - 1; i++) {
    // Max Drawdown Check
    // if (((initialCapital - equity) / initialCapital) * 100 >= maxDrawdownPctLimit) {
    //   console.log("Maximum drawdown reached - stopping backtest.");
    //   break;
    // }
    // Zusätzliche Filter
    // if (!isVolatilityOK(candles, i)) continue;
    // if (!isGoodTradingHour(candles[i].ctm)) continue;

    const slice = candles.slice(0, i + 1);
    const signalData = generateSignal(slice, symbol);
    if (!signalData) continue;
    const entryRaw = signalData.entryRaw;

    // Dynamische SL/TP basierend auf ATR
    const atr = calculateATR(slice);
    const atrMultiplierSL = CONFIG.atrMultiplierSL;
    const atrMultiplierTP = CONFIG.atrMultiplierTP;

    // Dynamische Risiko/Reward basierend auf ATR
    const slDistance = atr * atrMultiplierSL;

    const tpDistance = atr * atrMultiplierTP;

    // Min RR Check
    const expectedRR = tpDistance / slDistance;
    if (expectedRR < CONFIG.minRR || expectedRR < 1.5) continue;
    // console.log("expectedRR:", CONFIG.minRR);

    // console.log("entryRaw:", entryRaw);

    let exitRaw = null;
    let exitReason = null;
    let durationCandles = 0;
    let highestPrice = signalData.signal === "BUY" ? entryRaw : null;
    let lowestPrice = signalData.signal === "SELL" ? entryRaw : null;
    // console.log("highestPrice:", highestPrice);

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

      // Update höchster/niedrigster Preis für Trailing Stop
      if (signalData.signal === "BUY") {
        if (normHigh > highestPrice) {
          highestPrice = normHigh;

          // Trailing Stop aktivieren wenn Gewinn > 50% von TP
          if (highestPrice > entryRaw + tpDistance * 0.5) {
            trailingStopActivated = true;
            // Neuer Trail Stop: Höchstpreis minus X Pips
            const newTrailingStop = highestPrice - trailingStopPips * pipMultiplier;
            // Nur anpassen wenn höher als aktueller Stop
            if (newTrailingStop > trailingStopLevel) {
              trailingStopLevel = newTrailingStop;
            }
          }
        }

        // SL Check - entweder initial oder trailing
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

          // Trailing Stop aktivieren wenn Gewinn > 50% von TP
          if (lowestPrice < entryRaw - tpDistance * 0.5) {
            trailingStopActivated = true;
            // Neuer Trail Stop: Tiefstpreis plus X Pips
            const newTrailingStop = lowestPrice + trailingStopPips * pipMultiplier;
            // Nur anpassen wenn niedriger als aktueller Stop
            if (trailingStopLevel === null || newTrailingStop < trailingStopLevel) {
              trailingStopLevel = newTrailingStop;
            }
          }
        }

        // SL Check - entweder initial oder trailing
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

    // Keine Regel getroffen - schließen zum Ende der Periode
    if (exitRaw === null) {
      exitRaw = candles[Math.min(i + maxDuration, candles.length - 1)].close;
      exitReason = "EndOfPeriod";
      durationCandles = Math.min(maxDuration, candles.length - i - 1);
    }

    const profitRaw = signalData.signal === "BUY" ? exitRaw - entryRaw : entryRaw - exitRaw;

    // NaN-Check
    if (isNaN(profitRaw)) continue;

    const profitPct = (profitRaw / entryRaw) * 100;

    // Risikomanagement: Setze consecutiveLosses
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

    // Position sizing (einfachheitshalber feste Größe)
    const riskAmount = initialCapital * (CONFIG.riskPerTrade || 0.02);
    const pipsRisked = slDistance / pipMultiplier;
    const positionSize = riskAmount / pipsRisked;

    // Profit auf Konto anwenden
    equity += profitRaw * (positionSize * 100000); // Skalieren des Profits
    equityCurve.push(parseFloat(equity.toFixed(2)));

    // Nach jedem Trade: Prüfe auf zu große Drawdowns und Volumen
    // Warte mindestens X Kerzen nach jedem Trade
    i += CONFIG.waitCandlesAfterTrade || 5;
  }

  // Berechne Kennzahlen
  const totalTrades = trades.length;
  const wins = trades.filter((t) => t.profit > 0).length;
  const losses = totalTrades - wins;
  const winRate = totalTrades ? (wins / totalTrades) * 100 : 0;
  const totalProfit = equity - initialCapital;
  const totalProfitPct = (totalProfit / initialCapital) * 100;
  const avgProfit = totalTrades ? totalProfit / totalTrades : 0;
  const avgProfitPct = totalTrades ? totalProfitPct / totalTrades : 0;

  // Aufschlüsselung nach Exit-Grund
  const exitsByReason = {};
  trades.forEach((trade) => {
    exitsByReason[trade.exitReason] = (exitsByReason[trade.exitReason] || 0) + 1;
  });

  // Berechne Drawdown und weitere Metriken
  let maxDrawdown = 0;
  let peak = initialCapital;
  let currentDrawdown = 0;
  let maxConsecutiveLosses = 0;
  let currentConsecutiveLosses = 0;

  // Profit-Faktor berechnen
  const grossProfit = trades.filter((t) => t.profit > 0).reduce((sum, t) => sum + t.profit, 0);
  const grossLoss = Math.abs(trades.filter((t) => t.profit < 0).reduce((sum, t) => sum + t.profit, 0));
  const profitFactor = grossLoss === 0 ? "Unendlich" : (grossProfit / grossLoss).toFixed(2);

  // Sortiere Trades nach Datum
  trades.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  // Berechne erweiterte Metriken
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

  // Berechne Drawdown aus Equity-Kurve
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

  // Berechne Sharpe Ratio (annualisiert mit angenommener Standardabweichung)
  const returns = [];
  let prevEquity = initialCapital;
  for (let i = 0; i < equityCurve.length; i++) {
    const returnPct = (equityCurve[i] - prevEquity) / prevEquity;
    returns.push(returnPct);
    prevEquity = equityCurve[i];
  }

  const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const stdDeviation = Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length);
  const sharpeRatio = stdDeviation ? (avgReturn / stdDeviation) * Math.sqrt(252) : 0; // Annualisiert mit 252 Handelstagen

  // Detaillierte Ergebnisse ausgeben
  console.log(`\nBacktesting Ergebnisse für ${symbol}:`);
  console.log(`Gesamtzahl Trades: ${totalTrades}`);
  console.log(`Gewinnende Trades: ${wins} (${winRate.toFixed(2)}%)`);
  console.log(`Verlierende Trades: ${losses} (${(100 - winRate).toFixed(2)}%)`);
  console.log(`Gesamtgewinn: ${totalProfit.toFixed(2)}€ (${totalProfitPct.toFixed(2)}%)`);
  console.log(`Durchschnittlicher Gewinn pro Trade: ${avgProfit.toFixed(2)}€ (${avgProfitPct.toFixed(2)}%)`);
  console.log(`Maximaler Drawdown: ${maxDrawdown.toFixed(2)}€ (${maxDrawdownPct.toFixed(2)}%)`);
  console.log(`Durchschnittliche Trade-Dauer (Kerzen): ${avgDuration.toFixed(2)}`);
  console.log(`Durchschnittliches Risiko-Ertrags-Verhältnis: ${avgRR.toFixed(2)}`);
  console.log(`Profit-Faktor: ${profitFactor}`);
  console.log(`Sharpe Ratio (annualisiert): ${sharpeRatio.toFixed(2)}`);
  console.log(`Maximale aufeinanderfolgende Verluste: ${maxConsecutiveLosses}`);
  console.log(`Exit-Gründe:`, exitsByReason);

  // Stichprobe der Trades ausgeben
  console.log("\nStichprobe der ersten 5 Trades:");
  console.log(trades.slice(0, 5));

  console.log("\nStichprobe der letzten 5 Trades:");
  console.log(trades.slice(-5));

  console.log("\nEquity-Kurve (Start, Mitte, Ende):");
  console.log("Start:", equityCurve.slice(0, 3));
  console.log("Mitte:", equityCurve.slice(Math.floor(equityCurve.length / 2) - 1, Math.floor(equityCurve.length / 2) + 2));
  console.log("Ende:", equityCurve.slice(-3));

  // Handelsintervalle analysieren
  let tradesByHour = {};
  let tradesByDay = {};

  trades.forEach((trade) => {
    const date = new Date(trade.timestamp);
    const hour = date.getHours();
    const day = date.getDay();

    // Stunde
    tradesByHour[hour] = tradesByHour[hour] || { total: 0, wins: 0 };
    tradesByHour[hour].total++;
    if (trade.profit > 0) tradesByHour[hour].wins++;

    // Tag
    tradesByDay[day] = tradesByDay[day] || { total: 0, wins: 0 };
    tradesByDay[day].total++;
    if (trade.profit > 0) tradesByDay[day].wins++;
  });

  console.log("\nHandelsverteilung nach Stunden:");
  Object.keys(tradesByHour).forEach((hour) => {
    const data = tradesByHour[hour];
    console.log(`${hour}:00 Uhr - ${data.total} Trades, ${((data.wins / data.total) * 100).toFixed(2)}% Gewinnrate`);
  });

  console.log("\nHandelsverteilung nach Wochentagen:");
  const dayNames = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
  Object.keys(tradesByDay).forEach((day) => {
    const data = tradesByDay[day];
    console.log(`${dayNames[day]} - ${data.total} Trades, ${((data.wins / data.total) * 100).toFixed(2)}% Gewinnrate`);
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
