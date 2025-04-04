require("dotenv").config();
const { calculateEMA, calculateMACD, calculateRSI } = require("./indicators");

const XAPI = require("xapi-node").default;
const { CONFIG } = require("./config");

//Authentifizierung mit XAPI
const x = new XAPI({
  accountId: process.env.DEMO_ACCOUNT_ID,
  password: process.env.DEMO_PASSWORD,
  type: "demo",
});

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





// Verbindung herstellen
const connect = async () => {
  try {
    await x.connect();
    console.log("Connection established");
  } catch (error) {
    console.error("Error:", error);
    throw error;
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

    const historicalData = await getHistoricalData(CONFIG.symbols.EURUSD, CONFIG.timeframe.M1);
    if (historicalData.length === 0) {
      console.error("No historical data downloaded!");
      return;
    }
    const closes = historicalData.map((candle) => candle.close);
    console.log("Historical data loaded:", closes.length, "candles");

    console.log("Bot läuft...");
  } catch (error) {
    console.error("Error:", error);
    throw error;
  }
};

startBot();
