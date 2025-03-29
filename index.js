require("dotenv").config();
const { x, connectXAPI, getSocketId } = require("./xapi.js");
const { calculateEMA, calculateMACD, calculateATR } = require("./indicators");
const { CONFIG } = require("./config");

let currentBalance = null;

const calculateDynamicSLTP = (entryRaw, atr, isBuy) => {
  const slDistance = atr * CONFIG.atrMultiplierSL;
  const tpDistance = atr * CONFIG.atrMultiplierTP;

  let sl = isBuy ? entryRaw - slDistance : entryRaw + slDistance;
  let tp = isBuy ? entryRaw + tpDistance : entryRaw - tpDistance;

  return {
    sl: parseFloat(sl.toFixed(5)),
    tp: parseFloat(tp.toFixed(5)),
  };
};

// Kontostand (wird über den Balance‑Stream aktualisiert)
const getAccountBalance = async () => {
  if (currentBalance !== null) {
    return currentBalance;
  } else {
    console.error("Balance noch nicht verfügbar!");
    return null;
  }
};

// async function getAccountBalance() {
//   if (currentBalance !== null) return currentBalance;
//   return new Promise((resolve) => {
//     const interval = setInterval(() => {
//       if (currentBalance !== null) {
//         clearInterval(interval);
//         resolve(currentBalance);
//       }
//     }, 500);
//   });
// }

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

// Signal-Generierung (wie im Backtesting – EMA und MACD)
const generateSignal = async (symbol, timeframe) => {
  const candles = await getHistoricalData(symbol, timeframe);
  if (candles.length < 50) return null; // Mindestanzahl an Kerzen
  const closes = candles.map((c) => c.close);
  const fastEMA = calculateEMA(closes, CONFIG.fastEMA);
  const slowEMA = calculateEMA(closes, CONFIG.slowEMA);
  const macd = calculateMACD(closes);
  const lastPrice = closes[closes.length - 1];

  console.log(
    `Signal for ${symbol}: fastEMA=${fastEMA.toFixed(5)}, slowEMA=${slowEMA.toFixed(5)}, MACD Histogram=${macd.histogram.toFixed(5)}`
  );

  if (fastEMA > slowEMA && macd.histogram > 0) {
    return { signal: 0, lastPrice };
  } else if (fastEMA < slowEMA && macd.histogram < 0) {
    return { signal: 1, lastPrice };
  }
  return null;
};

// Multi-Timeframe-Analyse: Prüfe Signale für M1, M15 und H1
const checkMultiTimeframeSignal = async (symbol) => {
  // Check if there is already an open trade for this symbol
  // const openPositionsForSymbol = await getOpenPositionsForSymbol(symbol);
  // if (openPositionsForSymbol >= 1) {
  //   console.log(`Trade for ${symbol} is already open. Skipping new trade.`);
  //   return;
  // }
  // const openPositions = await getOpenPositionsCount();
  // if (openPositions >= 5) {
  //   console.log(`Max open positions reached (${openPositions}). No new trade for ${symbol}.`);
  //   return;
  // const signalM15 = await generateSignal(symbol, CONFIG.timeframe.M15);
  // const signalH1 = await generateSignal(symbol, CONFIG.timeframe.H1);
  const signalM1 = await generateSignal(symbol, CONFIG.timeframe.M1);
  if (!signalM1) {
    console.error(`Not enough data or no valid signal for ${symbol} on M1`);
    return null;
  }
  return { signal: signalM1.signal, lastPrice: signalM1.lastPrice };
};

// Berechnung der Lot-Größe (nur 1 Trade pro Währungspaar, max. 5 insgesamt)
function calculatePositionSize(accountBalance, riskPerTrade, stopLossPips, symbol) {
  const pipMultiplier = getPipMultiplier(symbol);
  const factor = symbol.includes("JPY") ? 1000 : 100000;
  const riskAmount = accountBalance * riskPerTrade;
  return riskAmount / (stopLossPips * (pipMultiplier * factor));
}
// const calculatePositionSize = (accountBalance, riskPerTrade, stopLossPips, symbol) => {
//   const riskAmount = accountBalance * riskPerTrade;
//   // For non-JPY pairs, each pip is typically worth $10 per lot.
//   const pipValuePerLot = 10;
//   return riskAmount / (stopLossPips * pipValuePerLot);
// };

// Neue Funktion: Gibt die Anzahl offener Trades für ein bestimmtes Symbol zurück
const getOpenPositionsForSymbol = async (symbol) => {
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
};

// Orderausführung: Nutzt den aktuellen Marktpreis als Basis und normalisiert die Preise korrekt
async function executeTradeForSymbol(symbol, direction, rawPrice, lotSize) {
  const factor = symbol.includes("JPY") ? 1000 : 100000;
  const pipMultiplier = getPipMultiplier(symbol);
  const spreadRaw = 0.0002 * factor;
  const rawEntry = direction === 0 ? rawPrice + spreadRaw : rawPrice;
  const entry = normalizePrice(symbol, rawEntry);
  const rawSL =
    direction === 0 ? rawEntry - CONFIG.stopLossPips * (pipMultiplier * factor) : rawEntry + CONFIG.stopLossPips * (pipMultiplier * factor);
  const rawTP =
    direction === 0
      ? rawEntry + CONFIG.takeProfitPips * (pipMultiplier * factor)
      : rawEntry - CONFIG.takeProfitPips * (pipMultiplier * factor);
  const sl = normalizePrice(symbol, rawSL);
  const tp = normalizePrice(symbol, rawTP);

  console.log(`Executing ${direction} trade for ${symbol}: entry=${entry}, SL=${sl}, TP=${tp}`);
  console.log("entry:", entry, "stop loss:", sl, "take profit:", tp);

  try {
    console.log(entry, sl, tp);

    const order = await x.Socket.send.tradeTransaction({
      cmd: direction, // 0 for BUY, 1 for SELL
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

const checkTradeStatus = async (orderId) => {
  try {
    const tradeStatus = await x.Socket.send.tradeTransactionStatus({
      order: orderId,
    });
    console.log("Trade status:", tradeStatus);
    return tradeStatus;
  } catch (err) {
    console.error("Failed to check trade status:", err);
    return null;
  }
};

const placeOrder = async () => {
  const symbol = "EURUSD";
  const currentRawPrice = await getCurrentPrice(symbol);
  if (!currentRawPrice) {
    console.error("Failed to retrieve current price.");
    return;
  }

  // Calculate proper values with factor adjustment
  const factor = symbol.includes("JPY") ? 1000 : 100000;
  const pipMultiplier = getPipMultiplier(symbol);

  // Convert raw price to actual price format
  const entry = normalizePrice(symbol, currentRawPrice);

  // Calculate SL/TP in actual price format (not pips)
  const slDistance = CONFIG.stopLossPips * (pipMultiplier * factor);
  const tpDistance = CONFIG.takeProfitPips * (pipMultiplier * factor);

  const sl = normalizePrice(symbol, currentRawPrice - slDistance);
  const tp = normalizePrice(symbol, currentRawPrice + tpDistance);

  // Use fixed volume for testing
  const volume = 0.01; // Minimum lot size for most brokers

  const orderData = {
    cmd: 0, // BUY
    symbol: symbol,
    price: entry,
    sl: sl,
    tp: tp,
    volume: volume,
    type: 0,
    order: 0,
  };

  try {
    console.log("Attempting to place order with data:", orderData);
    const result = await x.Socket.send.tradeTransaction(orderData);
    console.log("Order response:", result);

    // Fix the success check condition
    if (result && result.data && result.data.returnData && result.data.returnData.order) {
      const orderId = result.data.returnData.order;
      console.log("Order successfully placed with ID:", orderId);

      // Check trade status after a short delay
      setTimeout(async () => {
        await checkTradeStatus(orderId);
      }, 1000);
    } else {
      console.error("Order not accepted - no order ID in response");
    }
  } catch (err) {
    console.error("Order failed:", err);
  }
};

// Main function
const startBot = async () => {
  try {
    await connectXAPI();

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
      // await checkAllPairsAndTrade();
      await placeOrder();
    }, 10000);

    console.log("Bot läuft...");
  } catch (error) {
    console.error("Error:", error);
    throw error;
  }
};

startBot();
