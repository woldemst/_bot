// trading.js
const { x, connect } = require("./api");
const { CONFIG, pipValue } = require("./config");
const { calculateSMA, calculateEMA, normalizePrice, getPipMultiplier } = require("./indicators");
const { getHistoricalData, getCurrentPrice } = require("./data");

// Variable, in der der aktuelle Kontostand gespeichert wird (wird über einen Stream aktualisiert)
let currentBalance = null;

// Listener für den Kontostand
function registerBalanceListener() {
  x.Stream.listen.getBalance((data) => {
    if (data && data.balance !== undefined) {
      currentBalance = data.balance;
      console.log("Balance updated:", currentBalance);
    } else {
      console.error("Ungültige Balance-Daten:", data);
    }
  });
}

// Gibt den aktuellen Kontostand zurück (sofern verfügbar)
async function getAccountBalance() {
  if (currentBalance !== null) {
    return currentBalance;
  } else {
    console.error("Balance noch nicht verfügbar!");
    return null;
  }
}

// Berechnet die Lot-Größe basierend auf Kontostand, Risiko, StopLoss und Symbol
function calculatePositionSize(accountBalance, riskPerTrade, stopLossPips, symbol) {
  const pipMultiplier = getPipMultiplier(symbol);
  const riskAmount = accountBalance * riskPerTrade;
  return riskAmount / (stopLossPips * pipMultiplier);
}

// Prüft das Handelssignal für ein Symbol (basierend auf EMA)
async function checkSignalForSymbol(symbol, timeframe, fastPeriod, slowPeriod) {
  const candles = await getHistoricalData(symbol, timeframe);
  if (candles.length === 0) {
    console.error(`No data for ${symbol}`);
    return null;
  }
  const closes = candles.map((candle) => candle.close);
  const emaFast = calculateEMA(closes, fastPeriod);
  const emaSlow = calculateEMA(closes, slowPeriod);
  const lastPrice = closes[closes.length - 1];
  console.log(
    `[${symbol} - TF ${timeframe}] emaFast=${emaFast}, emaSlow=${emaSlow}, rawLastPrice=${lastPrice}`
  );
  return emaFast > emaSlow
    ? { signal: "BUY", rawPrice: lastPrice }
    : { signal: "SELL", rawPrice: lastPrice };
}

// Prüft, ob auf mehreren Timeframes dasselbe Signal vorliegt
async function checkMultiTimeframeSignal(symbol) {
  const signalM1 = await checkSignalForSymbol(
    symbol,
    CONFIG.timeframe.M1,
    CONFIG.fastMA,
    CONFIG.slowMA
  );
  const signalM15 = await checkSignalForSymbol(
    symbol,
    CONFIG.timeframe.M15,
    CONFIG.fastMA,
    CONFIG.slowMA
  );
  const signalH1 = await checkSignalForSymbol(
    symbol,
    CONFIG.timeframe.H1,
    CONFIG.fastMA,
    CONFIG.slowMA
  );
  if (!signalM1 || !signalM15 || !signalH1) {
    console.error(`Not enough data for ${symbol}`);
    return null;
  }
  if (signalM1.signal === signalM15.signal && signalM15.signal === signalH1.signal) {
    return { signal: signalM1.signal, rawPrice: signalM1.rawPrice };
  }
  return null;
}

// Führt den Handel für ein einzelnes Symbol aus
async function checkAndTradeForSymbol(symbol) {
  const signalData = await checkMultiTimeframeSignal(symbol);
  if (!signalData) {
    console.log(`No consistent multi-timeframe signal for ${symbol}`);
    return;
  }
  console.log(`Signal for ${symbol}: ${signalData.signal} at raw price ${signalData.rawPrice}`);

  const openPositions = await getOpenPositionsCount();
  if (openPositions >= 5) {
    console.log(`Max open positions reached (${openPositions}). No new trade for ${symbol}.`);
    return;
  }

  const balance = await getAccountBalance();
  if (!balance) {
    console.error("Couldn't check balance!");
    return;
  }

  const positionSize = calculatePositionSize(
    balance,
    CONFIG.riskPerTrade,
    CONFIG.stopLossPips,
    symbol
  );
  console.log(`Placing ${signalData.signal} trade for ${symbol} with lot size: ${positionSize}`);
  await executeTradeForSymbol(symbol, signalData.signal, signalData.rawPrice, positionSize);
}

// Führt einen Trade aus, indem der Entry, SL und TP normalisiert werden
async function executeTradeForSymbol(symbol, direction, rawPrice, lotSize) {
  const pipMultiplier = getPipMultiplier(symbol);
  const factor = symbol.includes("JPY") ? 1000 : 100000;
  const spreadRaw = 0.0002 * factor;
  const rawEntry = direction === "BUY" ? rawPrice + spreadRaw : rawPrice; // Für SELL: keine Spread-Anpassung
  const entry = normalizePrice(symbol, rawEntry);
  const slRaw =
    direction === "BUY"
      ? rawEntry - CONFIG.stopLossPips * (pipValue * factor)
      : rawEntry + CONFIG.stopLossPips * (pipValue * factor);
  const tpRaw =
    direction === "BUY"
      ? rawEntry + CONFIG.takeProfitPips * (pipValue * factor)
      : rawEntry - CONFIG.takeProfitPips * (pipValue * factor);
  const sl = normalizePrice(symbol, slRaw);
  const tp = normalizePrice(symbol, tpRaw);

  console.log(`Executing ${direction} trade for ${symbol}: entry=${entry}, SL=${sl}, TP=${tp}`);

  try {
    const order = await x.Socket.send.tradeTransaction({
      cmd: direction === "BUY" ? 0 : 1, // 0 = BUY, 1 = SELL
      customComment: `Scalping Bot Order for ${symbol}`,
      expiration: Date.now() + 3600000, // 1 Stunde Gültigkeit
      offset: 0,
      order: 0,
      price: entry,
      sl: sl,
      tp: tp,
      symbol: symbol,
      type: 0,
      volume: lotSize,
    });
    console.log(`${direction} order executed for ${symbol} at ${entry}, order:`, order);
  } catch (error) {
    console.error(`Failed to execute ${direction} trade for ${symbol}:`, error);
  }
}

// Öffentliche Positionen abrufen (als Promise)
async function getOpenPositionsCount() {
  return new Promise((resolve) => {
    x.Stream.listen.getTrades((data) => {
      console.log("Open positions update:", data);
      resolve(Array.isArray(data) ? data.length : 0);
    });
  }).catch((err) => {
    console.error("Error fetching open positions:", err);
    return 0;
  });
}

async function checkAllPairsAndTrade() {
  for (let symbol of Object.values(CONFIG.symbols)) {
    await checkAndTradeForSymbol(symbol);
  }
}

module.exports = {
  checkAllPairsAndTrade,
  getOpenPositionsCount,
  getAccountBalance,
  checkMultiTimeframeSignal,
  executeTradeForSymbol,
  getHistoricalData,
  getCurrentPrice,
  checkSignalForSymbol,
  calculatePositionSize,
  connect,
  registerBalanceListener,
};


// // index.js
// require("dotenv").config();
// const { connect, x } = require("./api");
// const { registerBalanceListener } = require("./trading");
// const { checkAllPairsAndTrade } = require("./trading");
// const { getHistoricalData } = require("./data");
// const { CONFIG } = require("./config");

// // Optional: Registriere weitere Listener, z. B. für Tick-Preise
// x.Stream.subscribe
//   .getTickPrices("EURUSD")
//   .catch(() => console.error("subscribe for EURUSD failed"));

// x.Stream.subscribe
//   .getTrades()
//   .then(() => console.log("Trades-Stream abonniert"))
//   .catch((err) => console.error("Fehler beim Abonnieren des Trades-Streams:", err));

// // Starte den Bot
// const startBot = async () => {
//   try {
//     await connect();
//     registerBalanceListener();
//     console.log("Bot läuft...");

//     // Alle 60 Sekunden alle Symbole prüfen und ggf. handeln
//     setInterval(async () => {
//       await checkAllPairsAndTrade();
//     }, 60000);

//     // Lade historische Daten (optional, z.B. zum Testen)
//     const historicalData = await getHistoricalData(CONFIG.symbols.EURUSD, CONFIG.timeframe.M1);
//     if (historicalData.length === 0) {
//       console.error("No historical data downloaded!");
//       return;
//     }
//     console.log("Historical data loaded:", historicalData.length, "candles");
//   } catch (error) {
//     console.error("Error:", error);
//     throw error;
//   }
// };

// startBot();




async function modifyTradeStopLoss(tradeId, newSL) {
  try {
    const result = await x.Socket.send.tradeTransaction({
      cmd: 2, // Modify command
      tradeTransInfo: { tradeId, sl: newSL },
    });
    console.log("Trade modified:", result);
  } catch (err) {
    console.error("Failed to modify trade:", err);
  }
}

// Trailing Stop Logik: Überwacht den Preis und passt den Stop Loss an, wenn sich der Markt zugunsten des Trades bewegt.
function applyTrailingStop(tradeId, symbol, direction, entry) {
  const pipMultiplier = getPipMultiplier(symbol);
  const trailingPips = 10; // Beispiel: 10 Pips trailing
  const trailingDistance = trailingPips * pipMultiplier;
  const checkInterval = 5000; // Prüfe alle 5 Sekunden

  const intervalId = setInterval(async () => {
    try {
      const currentPrice = await getCurrentPrice(symbol);
      if (currentPrice == null) return;
      if (direction === "BUY") {
        if (currentPrice > entry + trailingDistance) {
          const newSL = currentPrice - trailingDistance;
          console.log(`Trailing stop update for trade ${tradeId}: new SL = ${newSL}`);
          await modifyTradeStopLoss(tradeId, newSL);
        }
      } else {
        if (currentPrice < entry - trailingDistance) {
          const newSL = currentPrice + trailingDistance;
          console.log(`Trailing stop update for trade ${tradeId}: new SL = ${newSL}`);
          await modifyTradeStopLoss(tradeId, newSL);
        }
      }
    } catch (err) {
      console.error("Error in trailing stop check:", err);
    }
  }, checkInterval);
  return intervalId;
}
