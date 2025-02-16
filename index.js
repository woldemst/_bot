require("dotenv").config();

const XAPI = require("xapi-node").default;
const { TYPE_FIELD, CMD_FIELD } = XAPI;

// 1. Konfiguration
const CONFIG = {
  symbols: {
    EURUSD: "EURUSD",
    GBPUSD: "GBPUSD",
    USDJPY: "USDJPY",
    AUDUSD: "AUDUSD",
    EURGBP: "EURGBP",
  },
  timeframe: {
    M1: 1,
    M5: 5,
    M15: 15,
    H1: 60,
    H4: 240,
    D1: 1440,
  },
  fastMA: 5,      // EMA-Schnellperiode
  slowMA: 20,     // EMA-Langperiode
  stopLossPips: 20,   // Stop-Loss in Pips
  takeProfitPips: 40, // Take-Profit in Pips
  riskPerTrade: 0.02, // 2% Risiko pro Trade
};

// Für Nicht-JPY (z.B. EURUSD) gehen wir von 5 Dezimalstellen aus
const pipValue = 0.1;

// 2. Authentifizierung mit XAPI
const x = new XAPI({
  accountId: process.env.DEMO_ACCOUNT_ID,
  password: process.env.DEMO_PASSWORD,
  type: "demo",
});
const socketId = x.Socket.getSocketId();
let currentBalance = null;
let currentTrades = [];

// Kontostand – wird über den Balance-Stream aktualisiert
const getAccountBalance = async () => {
  if (currentBalance !== null) {
    return currentBalance;
  } else {
    console.error("Balance noch nicht verfügbar!");
    return null;
  }
};

// --- Indikator-Funktionen ---

function calculateSMA(prices, period) {
  if (prices.length < period) return null;
  return prices.slice(-period).reduce((sum, price) => sum + price, 0) / period;
}

function calculateEMA(prices, period) {
  if (prices.length < period) return null;
  const k = 2 / (period + 1);
  let ema = calculateSMA(prices.slice(0, period), period);
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

function calculateMACD(prices, shortPeriod = 12, longPeriod = 26, signalPeriod = 9) {
  let macdValues = [];
  for (let i = longPeriod - 1; i < prices.length; i++) {
    const shortSlice = prices.slice(i - shortPeriod + 1, i + 1);
    const longSlice = prices.slice(i - longPeriod + 1, i + 1);
    const emaShort = calculateEMA(shortSlice, shortPeriod);
    const emaLong = calculateEMA(longSlice, longPeriod);
    macdValues.push(emaShort - emaLong);
  }
  const signalLine = calculateEMA(macdValues, signalPeriod);
  const histogram = macdValues[macdValues.length - 1] - signalLine;
  return { macdLine: macdValues[macdValues.length - 1], signalLine, histogram };
}

function calculateRSI(prices, period = 14) {
  if (prices.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// --- Verbindung & Datenabruf ---

const connect = async () => {
  try {
    await x.connect();
    console.log("Connection established");
  } catch (error) {
    console.error("Error:", error);
    throw error;
  }
};

const getHistoricalData = async (symbol, timeframe) => {
  try {
    const result = await x.getPriceHistory({ symbol, period: timeframe });
    return result && result.candles ? result.candles : [];
  } catch (err) {
    console.error("Error in getHistoricalData:", err);
    return [];
  }
};

const getCurrentPrice = async (symbol) => {
  const candles = await getHistoricalData(symbol, CONFIG.timeframe.M1);
  if (candles.length === 0) return null;
  const closes = candles.map(c => c.close);
  return closes[closes.length - 1];
};

function normalizePrice(symbol, rawPrice) {
  const factor = symbol.includes("JPY") ? 1000 : 100000;
  return parseFloat((rawPrice / factor).toFixed(5));
}

function getPipMultiplier(symbol) {
  return symbol.includes("JPY") ? 0.01 : 0.0001;
}

function calculatePositionSize(accountBalance, riskPerTrade, stopLossPips, symbol) {
  const pipMultiplier = getPipMultiplier(symbol);
  const factor = symbol.includes("JPY") ? 1000 : 100000;
  const riskAmount = accountBalance * riskPerTrade;
  return riskAmount / (stopLossPips * (pipMultiplier * factor));
}

// --- Signal-Generierung ---

const checkSignalForSymbol = async (symbol, timeframe, fastPeriod, slowPeriod) => {
  const candles = await getHistoricalData(symbol, timeframe);
  if (candles.length === 0) {
    console.error(`No data for ${symbol}`);
    return null;
  }
  const closes = candles.map(c => c.close);
  const emaFast = calculateEMA(closes, fastPeriod);
  const emaSlow = calculateEMA(closes, slowPeriod);
  const lastPrice = closes[closes.length - 1];
  
  // Für stabilere Werte: verwende die letzten 50 Kerzen für MACD und RSI
  const recentCloses = closes.slice(-50);
  const macdData = calculateMACD(recentCloses);
  const rsiValue = calculateRSI(recentCloses);

  console.log(
    `[${symbol} - TF ${timeframe}] emaFast=${emaFast}, emaSlow=${emaSlow}, rawLastPrice=${lastPrice}, MACD hist=${macdData.histogram}, RSI=${rsiValue}`
  );

  if (emaFast > emaSlow && macdData.histogram > 0 && rsiValue < 70) {
    return { signal: "BUY", rawPrice: lastPrice };
  } else if (emaFast < emaSlow && macdData.histogram < 0 && rsiValue > 30) {
    return { signal: "SELL", rawPrice: lastPrice };
  } else {
    return null;
  }
};

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

// --- Orderausführung ---

// Hier wird der Orderpreis normalisiert, sodass er 5 Dezimalstellen hat (z.B. 1.03616 für EURUSD)
async function executeTradeForSymbol(symbol, direction, rawPrice, lotSize) {
  const factor = symbol.includes("JPY") ? 1000 : 100000;
  const pipMultiplier = getPipMultiplier(symbol);
  const spreadRaw = 0.0002 * factor;
  // Für BUY addiere den Spread, für SELL nutze den Rohpreis
  const rawEntry = direction === "BUY" ? rawPrice + spreadRaw : rawPrice;
  const entry = normalizePrice(symbol, rawEntry);
  const rawSL = direction === "BUY"
    ? rawEntry - CONFIG.stopLossPips * (pipMultiplier * factor)
    : rawEntry + CONFIG.stopLossPips * (pipMultiplier * factor);
  const rawTP = direction === "BUY"
    ? rawEntry + CONFIG.takeProfitPips * (pipMultiplier * factor)
    : rawEntry - CONFIG.takeProfitPips * (pipMultiplier * factor);
  const sl = normalizePrice(symbol, rawSL);
  const tp = normalizePrice(symbol, rawTP);

  console.log(`Executing ${direction} trade for ${symbol}: entry=${entry}, SL=${sl}, TP=${tp}`);
  console.log("entry:", entry, "stop loss:", sl, "take profit:", tp);

  try {
    const order = await x.Socket.send.tradeTransaction({
      cmd: direction === "BUY" ? 0 : 1, // 0 = BUY, 1 = SELL
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

// --- Backtesting-Funktion ---
// Diese Funktion lädt historische Daten für einen definierten Zeitraum (z.B. nach der Coronakrise)
// und simuliert Trades anhand der Strategie (Schließung im nächsten Candle, falls vorhanden).
async function backtestStrategy(symbol, timeframe, startTimestamp, endTimestamp) {
  console.log(`Backtesting ${symbol} from ${new Date(startTimestamp * 1000)} to ${new Date(endTimestamp * 1000)}`);
  const allCandlesData = await x.getPriceHistory({ symbol, period: timeframe, start: startTimestamp, end: endTimestamp });
  if (!allCandlesData || !allCandlesData.candles) {
    console.error("Keine historischen Daten gefunden.");
    return;
  }
  const candles = allCandlesData.candles;
  console.log(`Backtesting: ${candles.length} Candles geladen.`);
  
  let trades = [];
  // Iteriere bis zum vorletzten Candle, damit ein "nächster" Candle existiert
  for (let i = 50; i < candles.length - 1; i++) {
    const slice = candles.slice(0, i + 1);
    const closes = slice.map(c => c.close);
    const emaFast = calculateEMA(closes, CONFIG.fastMA);
    const emaSlow = calculateEMA(closes, CONFIG.slowMA);
    const recentCloses = closes.slice(-50);
    const macdData = calculateMACD(recentCloses);
    const rsiValue = calculateRSI(recentCloses);
    const currentPrice = closes[closes.length - 1];
    
    let signal = null;
    if (emaFast > emaSlow && macdData.histogram > 0 && rsiValue < 70) {
      signal = "BUY";
    } else if (emaFast < emaSlow && macdData.histogram < 0 && rsiValue > 30) {
      signal = "SELL";
    }
    if (signal && i + 1 < candles.length) {
      const nextCandle = candles[i + 1];
      let outcome = 0;
      if (signal === "BUY") {
        outcome = nextCandle.close - currentPrice;
      } else {
        outcome = currentPrice - nextCandle.close;
      }
      trades.push({ signal, entry: currentPrice, exit: nextCandle.close, profit: outcome });
    }
  }
  
  const totalTrades = trades.length;
  const wins = trades.filter(t => t.profit > 0).length;
  const losses = totalTrades - wins;
  const totalProfit = trades.reduce((sum, t) => sum + t.profit, 0);
  console.log(`Backtesting Ergebnisse für ${symbol}:`);
  console.log(`Trades: ${totalTrades}, Wins: ${wins}, Losses: ${losses}, Total Profit: ${totalProfit}`);
  return { totalTrades, wins, losses, totalProfit, trades };
}

// --- Handelslogik & Risiko-Kontrolle ---

// Pro Währungspaar nur ein Trade gleichzeitig und insgesamt maximal 5 offene Trades.
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

// Offene Positionen abrufen (als Promise)
async function getOpenPositionsCount() {
  return new Promise((resolve) => {
    x.Stream.listen.getTrades((data) => {
      const trades = Array.isArray(data) ? data : [data];
      const openTrades = trades.filter(t => t && !t.closed);
      console.log("Open positions update:", openTrades);
      resolve(openTrades.length);
    });
  }).catch((err) => {
    console.error("Error fetching open positions:", err);
    return 0;
  });
}

// --- Main function ---
const startBot = async () => {
  try {
    await connect();

    // Streams abonnieren
    x.Stream.subscribe.getBalance()
      .then(() => console.log("Balance-Stream abonniert"))
      .catch((err) => console.error("Fehler beim Abonnieren des Balance-Streams:", err));
    x.Stream.subscribe.getTickPrices("EURUSD")
      .catch(() => console.error("subscribe for EURUSD failed"));
    x.Stream.subscribe.getTrades()
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

    // Backtesting starten (Beispiel: Daten ab 1. Juli 2020 bis heute, M1)
    const startTimestamp = Math.floor(new Date("2020-07-01T00:00:00Z").getTime() / 1000);
    const endTimestamp = Math.floor(Date.now() / 1000);
    await backtestStrategy("EURUSD", CONFIG.timeframe.M1, startTimestamp, endTimestamp);

    // Alle 60 Sekunden Signale prüfen und ggf. Trades auslösen
    setInterval(async () => {
      await checkAllPairsAndTrade();
    }, 60000);

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
  } finally {
    // Hier ggf. später x.disconnect() einfügen
  }
};

startBot();


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
