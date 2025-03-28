// // index.js
// require("dotenv").config();
// const { x, connectXAPI, getSocketId } = require("./xapi.js");
// const { calculateEMA, calculateMACD, calculateATR } = require("./indicators");
// const { CONFIG } = require("./config");

// let currentBalance = null;

// // const calculateDynamicSLTP = (entryRaw, atr, isBuy) => {
// //   const slDistance = atr * CONFIG.atrMultiplierSL;
// //   const tpDistance = atr * CONFIG.atrMultiplierTP;

// //   let sl = isBuy ? entryRaw - slDistance : entryRaw + slDistance;
// //   let tp = isBuy ? entryRaw + tpDistance : entryRaw - tpDistance;

// //   return {
// //     sl: parseFloat(sl.toFixed(5)),
// //     tp: parseFloat(tp.toFixed(5)),
// //   };
// // };

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
//       socketId: getSocketId(),
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
// // checkSignalForSymbol
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
//     return { signal: "BUY", lastPrice };
//   } else if (fastEMA < slowEMA && macd.histogram < 0) {
//     return { signal: "SELL", lastPrice };
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
//   const signalM1 = await generateSignal(symbol, CONFIG.timeframe.M1);
//   if (!signalM1) {
//     console.error(`Not enough data or no valid signal for ${symbol} on M1`);
//     return null;
//   }
//   return { signal: signalM1.signal, lastPrice: signalM1.lastPrice };
// };
// // Berechnung der Lot-Größe (nur 1 Trade pro Währungspaar, max. 5 insgesamt)
// // function calculatePositionSize(accountBalance, riskPerTrade, stopLossPips, symbol) {
// //   const pipMultiplier = getPipMultiplier(symbol);
// //   const factor = symbol.includes("JPY") ? 1000 : 100000;
// //   const riskAmount = accountBalance * riskPerTrade;
// //   return riskAmount / (stopLossPips * (pipMultiplier * factor));
// // }
// const calculatePositionSize = (accountBalance, riskPerTrade, stopLossPips, symbol) => {
//   const riskAmount = accountBalance * riskPerTrade;
//   // For non-JPY pairs, each pip is typically worth $10 per lot.
//   const pipValuePerLot = 10;
//   return riskAmount / (stopLossPips * pipValuePerLot);
// };

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
// // Für jedes Symbol prüfen und ggf. einen Trade auslösen (max. 1 Trade pro Symbol)
// async function checkAndTradeForSymbol(symbol) {
//   const signalData = await checkMultiTimeframeSignal(symbol);
//   // console.log("signal data", signalData);

//   if (!signalData) {
//     console.log(`No consistent multi-timeframe signal for ${symbol}`);
//     return;
//   }
//   console.log(`Signal for ${symbol}: ${signalData.signal} at raw price ${signalData.lastPrice}`);

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

// // Orderausführung: Nutzt den aktuellen Marktpreis als Basis und normalisiert die Preise korrekt
// async function executeTradeForSymbol(symbol, direction, rawPrice, lotSize) {
//   // Use fixed spread in normalized units (e.g. 0.0002 for EURUSD)
//   const spread = 0.0002;
//   const entry = direction === "BUY" ? rawPrice + spread : rawPrice;

//   // Calculate SL and TP directly in normalized units
//   const sl =
//     direction === "BUY"
//       ? parseFloat((entry - CONFIG.stopLossPips * 0.0001).toFixed(5))
//       : parseFloat((entry + CONFIG.stopLossPips * 0.0001).toFixed(5));
//   const tp =
//     direction === "BUY"
//       ? parseFloat((entry + CONFIG.takeProfitPips * 0.0001).toFixed(5))
//       : parseFloat((entry - CONFIG.takeProfitPips * 0.0001).toFixed(5));

//   console.log(`Executing ${direction} trade for ${symbol}: entry=${entry}, SL=${sl}, TP=${tp}, Lot Size=${lotSize}`);

//   try {
//     const order = await x.Socket.send.tradeTransaction({
//       cmd: direction === "BUY" ? 0 : 1,
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

// const startBot = async () => {
//   try {
//     await connectXAPI();
//     // Abonniere Streams
//     await Promise.all([
//       // x.Stream.subscribe.getTickPrices("EURUSD").catch(() => console.error("subscribe for EURUSD failed")),
//       x.Stream.subscribe
//         .getTrades()
//         .then(() => console.log("Trades-Stream subscribed"))
//         .catch((err) => console.error("Error subscribing trades:", err)),
//       x.Stream.subscribe
//         .getBalance()
//         .then(() => console.log("Balance-Stream subscribed"))
//         .catch((err) => console.error("Error subscribing balance:", err)),
//     ]);
//     // Listener registrieren
//     x.Stream.listen.getTrades((data) => {
//       if (data) {
//         // Optional: hier können Trade-Daten geloggt werden
//       } else {
//         console.error("no trades data:", data);
//       }
//     });
//     x.Stream.listen.getBalance((data) => {
//       if (data && data.balance !== undefined) {
//         currentBalance = data.balance;
//         console.log("Balance updated:", currentBalance);
//       } else {
//         console.error("Invalid balance data:", data);
//       }
//     });

//     // Hier kannst du den Live-Trading-Loop starten (z. B. alle 60 Sekunden)

//     // --- Backtesting für alle Paare ---
//     // await backtestStrategy(
//     //   CONFIG.symbols.EURUSD,
//     //   CONFIG.timeframe.M1,
//     //   Math.floor(new Date("2025-01-14T00:00:00Z").getTime() / 1000),
//     //   Math.floor(new Date("2025-02-14T00:00:00Z").getTime() / 1000)
//     // );

//     setInterval(async () => {
//       if (isMarketOpen()) {
//         await checkAllPairsAndTrade();
//       } else {
//         console.log("Markt geschlossen. Handel wird nicht ausgeführt.");
//       }
//     }, 10000);

//     console.log("Bot is live...");
//   } catch (error) {
//     console.error("Error:", error);
//   }
// };

// const isMarketOpen = () => {
//   const now = new Date();
//   const day = now.getUTCDay();
//   const hour = now.getUTCHours();

//   // Forex Marktzeiten (UTC):
//   // Sydney: 22:00-06:00
//   // Tokyo: 00:00-09:00
//   // London: 08:00-17:00
//   // New York: 13:00-22:00
//   return (
//     day >= 1 &&
//     day <= 5 &&
//     (hour >= 22 ||
//       hour < 6 || // Sydney
//       (hour >= 0 && hour < 9) || // Tokyo
//       (hour >= 8 && hour < 17) || // London
//       (hour >= 13 && hour < 22)) // New York
//   );
// };

// startBot();

require("dotenv").config();
const { x, connectXAPI, getSocketId } = require("./xapi.js");
const { calculateEMA, calculateMACD, calculateATR } = require("./indicators");
const { CONFIG } = require("./config");


let currentBalance = null;

// Kontostand (wird über den Balance‑Stream aktualisiert)
const getAccountBalance = async () => {
  if (currentBalance !== null) {
    return currentBalance;
  } else {
    console.error("Balance noch nicht verfügbar!");
    return null;
  }
};



// Historische Daten abrufen (Candles)
const getHistoricalData = async (symbol, timeframe) => {
  try {
    const result = await x.getPriceHistory({ symbol, period: timeframe });
    return result && result.candles ? result.candles : [];
  } catch (err) {
    console.error("Error in getHistoricalData:", err);
    return [];
  }
};

// Aktuellen Marktpreis (letzte Kerze im M1) abrufen
const getCurrentPrice = async (symbol) => {
  const candles = await getHistoricalData(symbol, CONFIG.timeframe.M1);
  if (candles.length === 0) return null;
  const closes = candles.map((c) => c.close);
  return closes[closes.length - 1];
};

// Normalisierungsfunktion: Wandelt Rohpreise in den tatsächlichen Kurs um
function normalizePrice(symbol, rawPrice) {
  const factor = symbol.includes("JPY") ? 1000 : 100000;
  return parseFloat((rawPrice / factor).toFixed(5));
}

// Liefert den Pip-Multiplikator
function getPipMultiplier(symbol) {
  return symbol.includes("JPY") ? 0.01 : 0.0001;
}

// Handelssignal prüfen – hier werden EMA, MACD und RSI als Filter genutzt
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

  // Berechne MACD und RSI (nutze die letzten 50 Candles für bessere Stabilität)
  const recentCloses = closes.slice(-50);
  const macdData = calculateMACD(recentCloses);
  const rsiValue = calculateRSI(recentCloses);

  console.log(
    `[${symbol} - TF ${timeframe}] emaFast=${emaFast}, emaSlow=${emaSlow}, rawLastPrice=${lastPrice}, MACD hist=${macdData.histogram}, RSI=${rsiValue}`
  );
  // Signalbestimmung:
  // BUY, wenn EMA-Bedingung, MACD-Histogramm > 0 und RSI < 70
  // SELL, wenn EMA-Bedingung, MACD-Histogramm < 0 und RSI > 30
  if (emaFast > emaSlow && macdData.histogram > 0 && rsiValue < 70) {
    return { signal: "BUY", rawPrice: lastPrice };
  } else if (emaFast < emaSlow && macdData.histogram < 0 && rsiValue > 30) {
    return { signal: "SELL", rawPrice: lastPrice };
  } else {
    return null;
  }
};

// Multi-Timeframe-Analyse: Prüfe Signale für M1, M15 und H1
const checkMultiTimeframeSignal = async (symbol) => {
  const signalM1 = await checkSignalForSymbol(symbol, CONFIG.timeframe.M1, CONFIG.fastMA, CONFIG.slowMA);
  // const signalM15 = await checkSignalForSymbol(symbol, CONFIG.timeframe.M15, CONFIG.fastMA, CONFIG.slowMA);
  // const signalH1 = await checkSignalForSymbol(symbol, CONFIG.timeframe.H1, CONFIG.fastMA, CONFIG.slowMA);
  if (!signalM1) {
    console.error(`Not enough data for ${symbol}`);
    return null;
  }

  return { signal: signalM1.signal, rawPrice: signalM1.rawPrice };
};

// Berechnung der Lot-Größe (nur 1 Trade pro Währungspaar, max. 5 insgesamt)
function calculatePositionSize(accountBalance, riskPerTrade, stopLossPips, symbol) {
  const pipMultiplier = getPipMultiplier(symbol);
  const factor = symbol.includes("JPY") ? 1000 : 100000;
  const riskAmount = accountBalance * riskPerTrade;
  return riskAmount / (stopLossPips * (pipMultiplier * factor));
}

// Orderausführung: Nutzt den aktuellen Marktpreis als Basis und normalisiert die Preise korrekt
async function executeTradeForSymbol(symbol, direction, rawPrice, lotSize) {
  const factor = symbol.includes("JPY") ? 1000 : 100000;
  const pipMultiplier = getPipMultiplier(symbol);
  const spreadRaw = 0.0002 * factor;
  const rawEntry = direction === "BUY" ? rawPrice + spreadRaw : rawPrice;
  const entry = normalizePrice(symbol, rawEntry);
  const rawSL =
    direction === "BUY"
      ? rawEntry - CONFIG.stopLossPips * (pipMultiplier * factor)
      : rawEntry + CONFIG.stopLossPips * (pipMultiplier * factor);
  const rawTP =
    direction === "BUY"
      ? rawEntry + CONFIG.takeProfitPips * (pipMultiplier * factor)
      : rawEntry - CONFIG.takeProfitPips * (pipMultiplier * factor);
  const sl = normalizePrice(symbol, rawSL);
  const tp = normalizePrice(symbol, rawTP);

  console.log(`Executing ${direction} trade for ${symbol}: entry=${entry}, SL=${sl}, TP=${tp}`);
  console.log("entry:", entry, "stop loss:", sl, "take profit:", tp);

  try {
    console.log(entry, sl, tp);
    
    const order = await x.Socket.send.tradeTransaction({
      cmd: direction === "BUY" ? 0 : 1,
      customComment: `Scalping Bot Order for ${symbol}`,
      expiration: Date.now() + 3600000,
      offset: 0,
      order: 0,
      price: entry,
      sl: sl,
      tp: tp,
      symbol: symbol,
      type: 0, // OPEN = 0, PENDING = 1, CLOSE = 2, MODIFY = 3, DELETE = 4,
      volume: lotSize,
    });
    console.log(`${direction} order executed for ${symbol} at ${entry}, order:`, order);
  } catch (error) {
    console.error(`Failed to execute ${direction} trade for ${symbol}:`, error);
  }
}

// Offene Positionen abrufen (als Promise verpackt)
async function getOpenPositionsCount() {
  return new Promise((resolve) => {
    x.Stream.listen.getTrades((data) => {
      // Wir gehen davon aus, dass data entweder ein Array oder ein einzelnes Objekt ist
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

// Für jedes Symbol prüfen und ggf. einen Trade auslösen (max. 1 Trade pro Symbol)
async function checkAndTradeForSymbol(symbol) {
  const signalData = await checkMultiTimeframeSignal(symbol);
  if (!signalData) {
    console.log(`No consistent multi-timeframe signal for ${symbol}`);
    return;
  }
  console.log(`Signal for ${symbol}: ${signalData.signal} at raw price ${signalData.rawPrice}`);

  // Prüfe, ob bereits ein Trade für dieses Symbol offen ist
  // const openPositions = await getOpenPositionsCount();
  // if (openPositions >= 5) {
  //   console.log(`Max open positions reached (${openPositions}). No new trade for ${symbol}.`);
  //   return;
  // }

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

// Iteriere über alle definierten Symbole und prüfe einzeln
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

const placeOrder = async () => {
  const orderData = {
    cmd: 0, // 0 for BUY
    symbol: "EURUSD",
    price: 1.08557, // already normalized value
    sl: 1.07940,
    tp: 1.08657,
    volume: 1, // lot size as a normalized number (for non-JPY, you usually use lots directly)
    expiration: Date.now() + 3600000, // 1 hour from now
    offset: 0,
    order: 0,
    customComment: "Scalping Bot Order for EURUSD",
  };

  await x.Socket.send
    .tradeTransaction(orderData)
    .then((result) => {
      console.log("Order executed:", result);
    })
    .catch((err) => {
      console.error("Order failed:", err);
    });
};

// Main function
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
        console.log("trades:", data);
      } else {
        console.error("no trades data:", data);
      }
    });

    // Starte Überprüfung der Handelssignale alle 60 Sekunden
    setInterval(async () => {
      await checkAllPairsAndTrade();
    }, 10000);
    // await placeOrder();

    console.log("Bot läuft...");
  } catch (error) {
    console.error("Error:", error);
    throw error;
  }
};

startBot();
