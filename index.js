require("dotenv").config();
const { calculateEMA, calculateMACD, calculateRSI } = require("./indicators");
const { backtestStrategy } = require("./backtesting");

const XAPI = require("xapi-node").default;
const { CONFIG } = require("./config");

const { x, connectXAPI } = require("./xapi");

let currentBalance = null;

// Kontostand (wird über den Balance‑Stream aktualisiert)
const getAccountBalance = async () => {
  if (currentBalance !== null) {
    console.log("Using cached balance:", currentBalance);
    return currentBalance;
  } else {
    x.Stream.listen.getBalance((data) => {
      if (data && data.balance !== undefined) {
        currentBalance = data.balance;
        console.log("Balance updated:", currentBalance);
      } else {
        console.error("Ungültige Balance-Daten:", data);
      }
    });
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
  const signalM15 = await checkSignalForSymbol(symbol, CONFIG.timeframe.M15, CONFIG.fastMA, CONFIG.slowMA);
  const signalH1 = await checkSignalForSymbol(symbol, CONFIG.timeframe.H1, CONFIG.fastMA, CONFIG.slowMA);
  if (!signalM1 || !signalM15 || !signalH1) {
    console.error(`Not enough data for ${symbol}`);
    return null;
  }
  if (signalM1.signal === signalM15.signal && signalM15.signal === signalH1.signal) {
    return { signal: signalM1.signal, rawPrice: signalM1.rawPrice };
  }
  return null;
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
      type: 0,
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
  const openPositions = await getOpenPositionsCount();
  if (openPositions >= 5) {
    console.log(`Max open positions reached (${openPositions}). No new trade for ${symbol}.`);
    return;
  }

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

// --- Backtesting für alle Paare ---
const test = async () => {
  if (!x.Socket) {
    console.log("Establishing connection for backtesting...");
    await connect(); // Make sure connection is established
  }
  const startTimestamp = Math.floor(new Date("2025-01-14T00:00:00Z").getTime() / 1000);
  const endTimestamp = Math.floor(new Date("2025-02-14T00:00:00Z").getTime() / 1000);
  console.log("Starting backtest with connected socket...");
  await backtestStrategy(CONFIG.symbols.AUDUSD, CONFIG.timeframe.M1, startTimestamp, endTimestamp);
};
// Main function
const startBot = async () => {
  try {
    await connectXAPI();

    // Streams abonnieren
    try {
      await x.Stream.subscribe.getBalance();
      console.log("Balance-Stream abonniert");
    } catch (err) {
      console.error("Fehler beim Abonnieren des Balance-Streams:", err);
    }
    try {
      await x.Stream.subscribe.getTickPrices("EURUSD");
    } catch (err) {
      console.error("subscribe for EURUSD failed:", err);
    }

    try {
      await x.Stream.subscribe.getTrades();
      console.log("Trades-Stream abonniert");
    } catch (err) {
      console.error("Fehler beim Abonnieren des Trades-Streams:", err);
    }
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

    console.log("Waiting for balance data...");
    setTimeout(async () => {
      await getAccountBalance();

      // setTimeout(async () => {
      //   await test();
      // }, 3000);

      // setInterval(async () => {
      //   if (isMarketOpen()) {
      //     await checkAllPairsAndTrade();
      //   } else {
      //     console.log("Markt geschlossen. Handel wird nicht ausgeführt.");
      //   }
      // }, 60000);

      console.log("Bot läuft...");
    }, 3000);
  } catch (error) {
    console.error("Error:", error); 
    throw error;
  }
};

const isMarketOpen = () => {
  const now = new Date();
  const day = now.getUTCDay();
  const hour = now.getUTCHours();

  // Forex Marktzeiten (UTC):
  // Sydney: 22:00-06:00
  // Tokyo: 00:00-09:00
  // London: 08:00-17:00
  // New York: 13:00-22:00
  return (
    day >= 1 &&
    day <= 5 &&
    (hour >= 22 ||
      hour < 6 || // Sydney
      (hour >= 0 && hour < 9) || // Tokyo
      (hour >= 8 && hour < 17) || // London
      (hour >= 13 && hour < 22)) // New York
  );
};

startBot();
