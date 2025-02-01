require("dotenv").config();

const XAPI = require("xapi-node").default;
const { Command, Type } = XAPI;

// 1. configiguration
const CONFIG = {
  symbols: {
    // trading instrument
    EURUSD: "EURUSD",
    GBPUSD: "GBPUSD",
    USDJPY: "USDJPY",
    AUDUSD: "AUDUSD",
    EURGBP: "EURGBP",
  },
  timeframe: {
    // timeframes in minutes
    M1: 1,
    M5: 5,
    H1: 60,
    H4: 240,
    D1: 1440,
  },
  fastMA: 5, // Fast Moving Average Periode for short-term signals
  slowMA: 20, // Slow Moving Average Periode for trend confirmation
  riskPerTrade: 0.01, // Risiko pro Trade (1% des Kontos)
  stopLossPips: 20, // Stop-Loss in Pips
  takeProfitPips: 40, // Take-Profit in Pips
  riskPerTrade: 0.02, // Risk per trade (2% of account)
};

// 2. authenficating with XAPI
const x = new XAPI({
  accountId: process.env.DEMO_ACCOUNT_ID,
  password: process.env.DEMO_PASSWORD,
  type: "demo",
});

const socketId = x.Socket.getSocketId();

// Beispielhafte Annahmen:
// Account Balance (diese Zahl sollte idealerweise dynamisch von der API abgefragt werden)
const accountBalance = 1000; // Beispiel: 1000€
// Pip-Wert für EURUSD: Für 0.01 Lot ca. 0.1 € pro Pip (kann variieren)
const pipValue = 0.1;

// calculate simple moving average
function calculateSMA(prices, period) {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  return slice.reduce((sum, price) => sum + price, 0) / period;
}

// calculate exponential moving average
function calculateEMA(prices, period) {
  if (prices.length < period) return null;
  const k = 2 / (period + 1);
  // Initiale EMA als SMA der ersten 'period' Werte
  let ema = calculateSMA(prices.slice(0, period), period);
  // Fortlaufende Berechnung für die restlichen Preise
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

// connect to XAPI
const connect = async () => {
  try {
    await x.connect();
    console.log("Connection established");

    // x.Socket.listen.getAllSymbols((err, data) => {
    //   if (err) {
    //     console.error("Error fetching symbols:", err);
    //   } else {
    //     console.log("Available symbols:", data);
    //   }
    // });

    // await x.disconnect();
    // console.log("Disconnected");
  } catch (error) {
    console.error("Error:", error);
    throw error;
  }
};

// Funktion, um historische Daten (Candles) abzurufen
const getHistoricalData = async (symbol, timeframe) => {
  try {
    const result = await x.getPriceHistory({
      symbol: symbol,
      period: timeframe, // z. B. 1 für M1
      // ticks: -1, // Alle verfügbaren Candles (je nach Datenverfügbarkeit)
    });
    // result enthält typischerweise { candles, digits }
    if (result && result.candles) {
      return result.candles;
    }
    return [];
  } catch (err) {
    console.error("Promise-Fehler in getHistoricalData:", err);
    return []; // Rückgabe eines leeren Arrays, um Abstürze zu vermeiden
  }
};

// Funktion, um das Handelssignal für ein bestimmtes Symbol zu prüfen
// Hier nutzen wir EMA als Signalgeber (du kannst auch SMA oder Kombination nutzen)
const checkSignalForSymbol = async (
  symbol,
  timeframe,
  fastPeriod,
  slowPeriod
) => {
  const candles = await getHistoricalData(symbol, timeframe);
  if (candles.length === 0) {
    console.error(`Keine Daten für ${symbol}`);
    return null;
  }
  // Extrahiere Schlusskurse
  const closes = candles.map((candle) => candle.close);
  const emaFast = calculateEMA(closes, fastPeriod);
  const emaSlow = calculateEMA(closes, slowPeriod);
  const lastPrice = closes[closes.length - 1];

  // Signal: Wenn fast EMA > slow EMA, dann BUY; sonst SELL
  if (emaFast > emaSlow) {
    return { signal: "BUY", price: lastPrice };
  } else if (emaFast < emaSlow) {
    return { signal: "SELL", price: lastPrice };
  }
  return null;
};

// Funktion zur Berechnung der Lot-Größe basierend auf Risiko, Stop-Loss-Pips und Pip-Wert
function calculatePositionSize(
  accountBalance,
  riskPerTrade,
  stopLossPips,
  pipValue
) {
  const riskAmount = accountBalance * riskPerTrade; // z. B. 2% von 1000€ = 20€
  // Lot-Größe (in micro lots): riskAmount / (stopLossPips * pipValue)
  return riskAmount / (stopLossPips * pipValue);
}

// Funktion, um einen Trade für ein bestimmtes Symbol auszuführen
async function executeTradeForSymbol(symbol, direction, price, lotSize) {
  // Spread berücksichtigen
  const spread = 0.0002; // Beispielwert; in der Praxis sollte dieser dynamisch ermittelt werden
  const entry = direction === "BUY" ? price + spread : price - spread;
  const sl =
    direction === "BUY"
      ? entry - CONFIG.stopLossPips * 0.0001
      : entry + CONFIG.stopLossPips * 0.0001;
  const tp =
    direction === "BUY"
      ? entry + CONFIG.takeProfitPips * 0.0001
      : entry - CONFIG.takeProfitPips * 0.0001;
  try {
    const order = await x.Socket.send.tradeTransaction({
      cmd: direction === "BUY" ? Command.BUY : Command.SELL,
      customComment: `Scalping Bot Order for ${symbol}`,
      expiration: Date.now() + 3600000, // 1 Stunde Gültigkeit
      offset: 0,
      order: 0,
      price: entry,
      sl: sl,
      tp: tp,
      symbol: symbol,
      type: Type.OPEN,
      volume: lotSize,
    });
    console.log(
      `${direction} order executed for ${symbol} at ${entry}, order:`,
      order
    );
  } catch (error) {
    console.error(`Failed to execute ${direction} trade for ${symbol}:`, error);
  }
}

// Funktion, die alle definierten Symbole prüft und bei ausreichend Konfluenz (z. B. mindestens 3 von 5) einen Trade auslöst
async function checkAllPairsAndTrade() {
  const signals = [];
  for (let sym of Object.values(CONFIG.symbols)) {
    const result = await checkSignalForSymbol(
      sym,
      CONFIG.timeframe.M1,
      CONFIG.fastMA,
      CONFIG.slowMA
    );
    if (result) {
      signals.push({ symbol: sym, signal: result.signal, price: result.price });
    }
  }
  // Beispiel: Wenn mindestens 3 Paare dasselbe Signal geben, dann wird gehandelt
  const buyCount = signals.filter((s) => s.signal === "BUY").length;
  const sellCount = signals.filter((s) => s.signal === "SELL").length;
  let overallSignal = null;
  if (buyCount >= 3) overallSignal = "BUY";
  else if (sellCount >= 3) overallSignal = "SELL";

  if (overallSignal) {
    // Berechne Lot-Größe für einen Trade: Bei 1000€ Konto mit 2% Risiko pro Trade
    const positionSize = calculatePositionSize(
      accountBalance,
      0.02,
      CONFIG.stopLossPips,
      pipValue
    );
    console.log(
      `Overall signal: ${overallSignal}. Executing trades for all matching pairs with lot size: ${positionSize}`
    );
    for (let sig of signals) {
      if (sig.signal === overallSignal) {
        await executeTradeForSymbol(
          sig.symbol,
          overallSignal,
          sig.price,
          positionSize
        );
      }
    }
  } else {
    console.log("Not enough consistent signals among pairs.");
  }
}

// main function
const startBot = async () => {
  try {
    await connect();

    if (!x.Stream || !x.Stream.subscribe) {
      throw new Error("x.Stream ist nicht verfügbar. Verbindung überprüfen!");
    }
    x.Stream.subscribe.getTickPrices([CONFIG.symbols.EURUSD]);
    // Überprüfe alle 60 Sekunden die Signale und führe Trades aus
    setInterval(async () => {
      await checkAllPairsAndTrade();
    }, 60000);

    const historicalData = await getHistoricalData(
      CONFIG.symbols.EURUSD,
      CONFIG.timeframe.M5
    );
    // console.log(historicalData);
    if (historicalData.length === 0) {
      console.error("No historical data downloaded!");
      return;
    }

    // Extrahiere die Schlusskurse aus den Candles
    // (Annahme: Jede Kerze hat eine Eigenschaft 'close'; passe das an, falls anders strukturiert)
    const closes = historicalData.map((candle) => candle.close);

    // calulate SMA und EMA für eine Periode, z. B. 20 Perioden (slowMA)
    const smaSlow = calculateSMA(closes, CONFIG.slowMA);
    const emaSlow = calculateEMA(closes, CONFIG.slowMA);

    // calulate fast Moving Average (z. B. 5 Perioden)
    const smaFast = calculateSMA(closes, CONFIG.fastMA);
    const emaFast = calculateEMA(closes, CONFIG.fastMA);

    console.log(
      `SMA (slow, ${CONFIG.slowMA}): ${smaSlow}, EMA (slow, ${CONFIG.slowMA}): ${emaSlow}`
    );
    console.log(
      `SMA (fast, ${CONFIG.fastMA}): ${smaFast}, EMA (fast, ${CONFIG.fastMA}): ${emaFast}`
    );

    // Hier kannst du weitere Logik hinzufügen, um anhand der Durchschnittswerte Handelsentscheidungen zu treffen

    console.log("Bot läuft...");
  } catch (error) {
    console.error("Error:", error);
    throw error;
  } finally {
    await x.disconnect();
    console.log("Disconnected");
  }
};

startBot();

// Starte Echtzeit-Updates
// x.Socket.subscribeCandles(CONFIG.symbol, CONFIG.timeframe, (candle) => {
//   historicalData.push(candle); // Füge neuen Candle hinzu
//   if (historicalData.length > 1000) historicalData.shift(); // Begrenze auf 1000 Candles
//   checkStrategy(historicalData); // Überprüfe Strategie
// });
