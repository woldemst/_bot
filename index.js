require("dotenv").config();
// const v20 = require('@oanda/v20');
const { calculateEMA, calculateMACD, calculateRSI } = require("./indicators");
// const { backtestStrategy } = require("./backtesting");
const { CONFIG } = require("./config");
const { igClient, connectIG, formatInstrument, convertTimeframe, Direction, OrderType, TimeInForce } = require("./connect");

let currentBalance = null;

const getAccountBalance = async () => {
  if (currentBalance !== null) {
    console.log("Using cached balance:", currentBalance);
    return currentBalance;
  } else {
    try {
      const accountInfo = await igClient.getAccountInfo();
      if (accountInfo && accountInfo.balance) {
        currentBalance = parseFloat(accountInfo.balance);
        console.log("Balance updated:", currentBalance);
        return currentBalance;
      } else {
        console.error("Invalid balance data:", accountInfo);
        return null;
      }
    } catch (err) {
      console.error("Error fetching balance:", err);
      return null;
    }
  }
};

// get historical data (Candles)
const getHistoricalData = async (symbol, timeframe) => {
  try {
    // Convert timeframe from minutes to IG format
    const resolution = convertTimeframe(timeframe);

    // Format instrument for IG
    const epic = formatInstrument(symbol);

    // Get current time
    const now = new Date();

    // Calculate start time (100 candles back)
    const startDate = new Date(now);
    startDate.setMinutes(startDate.getMinutes() - timeframe * 100);

    const response = await igClient.getPriceHistory(epic, {
      resolution: resolution,
      from: startDate.toISOString(),
      to: now.toISOString(),
    });

    if (response && response.prices) {
      // Transform IG candle format to match your existing format
      return response.prices.map((candle) => ({
        close: parseFloat(candle.closePrice.bid),
        open: parseFloat(candle.openPrice.bid),
        high: parseFloat(candle.highPrice.bid),
        low: parseFloat(candle.lowPrice.bid),
        ctm: new Date(candle.snapshotTime).getTime(),
        timestamp: new Date(candle.snapshotTime).getTime(),
      }));
    }
    return [];
  } catch (err) {
    console.error("Error in getHistoricalData:", err);
    return [];
  }
};

// Get current price
const getCurrentPrice = async (symbol) => {
  try {
    const epic = formatInstrument(symbol);
    const response = await igClient.getMarketDetails(epic);

    if (response && response.snapshot) {
      // Use mid price (average of bid and offer)
      return (parseFloat(response.snapshot.bid) + parseFloat(response.snapshot.offer)) / 2;
    }
    return null;
  } catch (err) {
    console.error("Error getting current price:", err);
    return null;
  }
};

// Helper function to format instrument for Oanda
const formatInstrument = (symbol) => {
  // Convert "EURUSD" to "EUR_USD"
  return symbol.slice(0, 3) + "_" + symbol.slice(3);
};

// IG already provides normalized prices
function normalizePrice(symbol, rawPrice) {
  return rawPrice;
}

// Returns the pip multiplier
function getPipMultiplier(symbol) {
  return symbol.includes("JPY") ? 0.01 : 0.0001;
}

// Check trading signal - using EMA, MACD and RSI as filters
const generateSignal = async (symbol, timeframe) => {
  const candles = await getHistoricalData(symbol, timeframe);
  if (candles.length < 50) return null; // Minimum number of candles
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

// Multi-Timeframe Analysis
const checkMultiTimeframeSignal = async (symbol) => {
  const signalM15 = await generateSignal(symbol, CONFIG.timeframe.M15);
  const signalM1 = await generateSignal(symbol, CONFIG.timeframe.M1);
  if (!signalM1 || !signalM15) {
    console.error(`Not enough data for ${symbol}`);
    return null;
  }
  if (signalM1.signal === signalM15.signal) {
    return { signal: signalM1.signal, lastPrice: signalM1.lastPrice };
  }
  return { signal: signalM1.signal, lastPrice: signalM1.lastPrice };
};

// Calculate lot size
function calculatePositionSize(accountBalance, riskPerTrade, stopLossPips, symbol) {
  const pipMultiplier = getPipMultiplier(symbol);
  const riskAmount = accountBalance * riskPerTrade;
  return Math.floor(riskAmount / (stopLossPips * pipMultiplier));
}

// Order execution for IG
async function executeTradeForSymbol(symbol, direction, price, lotSize) {
  const epic = formatInstrument(symbol);
  const directionStr = typeof direction === "number" ? (direction === 0 ? "BUY" : "SELL") : direction;

  // Calculate stop loss and take profit levels
  const pipMultiplier = getPipMultiplier(symbol);
  const slDistance = CONFIG.stopLossPips * pipMultiplier;
  const tpDistance = CONFIG.takeProfitPips * pipMultiplier;

  const sl = directionStr === "BUY" ? price - slDistance : price + slDistance;
  const tp = directionStr === "BUY" ? price + tpDistance : price - slDistance;

  console.log(`Executing ${directionStr} trade for ${symbol}: entry=${price}, SL=${sl.toFixed(5)}, TP=${tp.toFixed(5)}`);

  try {
    // Create order request
    const dealReference = `BOT_${symbol}_${Date.now()}`;

    const orderRequest = {
      epic: epic,
      expiry: "-",
      direction: directionStr === "BUY" ? Direction.BUY : Direction.SELL,
      size: lotSize.toString(),
      orderType: OrderType.MARKET,
      timeInForce: TimeInForce.FILL_OR_KILL,
      guaranteedStop: false,
      stopLevel: sl.toFixed(5),
      stopDistance: null,
      limitLevel: tp.toFixed(5),
      limitDistance: null,
      dealReference: dealReference,
    };

    const response = await igClient.deal(orderRequest);

    if (response && response.dealReference) {
      console.log(`${directionStr} order executed for ${symbol} at ${price}, deal reference: ${response.dealReference}`);

      // Check trade status after placement
      setTimeout(async () => {
        const status = await checkTradeStatus(response.dealReference);
        console.log("Detailed trade status:", JSON.stringify(status, null, 2));

        // Also check open positions
        const openPositions = await getOpenPositionsCount();
        console.log(`Current open positions: ${openPositions}`);
      }, 2000);

      return response.dealReference;
    } else {
      console.error("Order submission failed:", response);
      return null;
    }
  } catch (error) {
    console.error(`Failed to execute ${directionStr} trade for ${symbol}:`, error);
    return null;
  }
}

// Get open positions count
async function getOpenPositionsCount() {
  try {
    const positions = await igClient.getPositions();
    if (positions && positions.positions) {
      console.log("Open positions update:", positions.positions.length);
      return positions.positions.length;
    }
    return 0;
  } catch (err) {
    console.error("Error fetching open positions:", err);
    return 0;
  }
}

// Check trade status
const checkTradeStatus = async (dealReference) => {
  try {
    console.log(`Checking status for deal reference: ${dealReference}`);
    const response = await igClient.getDealConfirmation(dealReference);
    return response;
  } catch (err) {
    console.error("Failed to check trade status:", err);
    return null;
  }
};

// Check each symbol and potentially trigger a trade
async function checkAndTradeForSymbol(symbol) {
  const signalData = await checkMultiTimeframeSignal(symbol);
  if (!signalData) {
    console.log(`No consistent multi-timeframe signal for ${symbol}`);
    return;
  }
  console.log(`Signal for ${symbol}: ${signalData.signal} at price ${signalData.lastPrice}`);

  // Check if max positions reached
  const openPositions = await getOpenPositionsCount();
  if (openPositions >= 5) {
    console.log(`Max open positions reached (${openPositions}). No new trade for ${symbol}.`);
    return;
  }

  const currentPrice = await getCurrentPrice(symbol);
  console.log(`Current market price for ${symbol}: ${currentPrice}`);

  const balance = await getAccountBalance();
  if (!balance) {
    console.error("Couldn't check balance!");
    return;
  }

  const positionSize = calculatePositionSize(balance, CONFIG.riskPerTrade, CONFIG.stopLossPips, symbol);
  console.log(`Placing ${signalData.signal} trade for ${symbol} with lot size: ${positionSize}`);
  await executeTradeForSymbol(symbol, signalData.signal, currentPrice, positionSize);
}

// Iterate over all defined symbols and check individually
async function checkAllPairsAndTrade() {
  for (let symbol of Object.values(CONFIG.symbols)) {
    await checkAndTradeForSymbol(symbol);
  }
}

// Backtesting. Use just on weekends. Is not so impotant
const test = async () => {
  // const startTimestamp = Math.floor(new Date("2025-01-14T00:00:00Z").getTime() / 1000);
  // const endTimestamp = Math.floor(new Date("2025-02-14T00:00:00Z").getTime() / 1000);
  console.log("Waiting for testing data...");
  // setTimeout(async () => {
  //   const historicalData = await getHistoricalData(CONFIG.symbols.AUDUSD, CONFIG.timeframe.M1);
  //   await backtestStrategy(CONFIG.symbols.AUDUSD, historicalData);
  // }, 3000);
};

// Place a test order
const placeOrder = async () => {
  try {
    const symbol = "EURUSD";
    const currentPrice = await getCurrentPrice(symbol);
    if (!currentPrice) {
      console.error("Failed to retrieve current price.");
      return;
    }

    // Calculate SL/TP
    const pipMultiplier = getPipMultiplier(symbol);
    const slDistance = CONFIG.stopLossPips * pipMultiplier;
    const tpDistance = CONFIG.takeProfitPips * pipMultiplier;

    const sl = currentPrice - slDistance;
    const tp = currentPrice + tpDistance;

    // Use fixed volume for testing
    const volume = 1; // 1 unit for IG

    const epic = formatInstrument(symbol);
    const dealReference = `TEST_${symbol}_${Date.now()}`;

    const orderRequest = {
      epic: epic,
      expiry: "-",
      direction: Direction.BUY,
      size: volume.toString(),
      orderType: OrderType.MARKET,
      timeInForce: TimeInForce.FILL_OR_KILL,
      guaranteedStop: false,
      stopLevel: sl.toFixed(5),
      stopDistance: null,
      limitLevel: tp.toFixed(5),
      limitDistance: null,
      dealReference: dealReference,
    };

    console.log("Attempting to place order with data:", orderRequest);
    const response = await igClient.deal(orderRequest);
    console.log("Order response:", response);

    if (response && response.dealReference) {
      console.log("Order successfully placed with deal reference:", response.dealReference);

      // Check trade status after a short delay
      console.log("Waiting for order processing...");
      await new Promise((resolve) => setTimeout(resolve, 3000));

      try {
        const status = await checkTradeStatus(response.dealReference);
        console.log("Status check completed");
      } catch (statusErr) {
        console.error("Error checking status:", statusErr);
      }

      return response.dealReference;
    } else {
      console.error("Order not accepted:", response);
      return null;
    }
  } catch (err) {
    console.error("Order failed:", err);
    return null;
  }
};

// Check if market is open
const isMarketOpen = () => {
  const now = new Date();
  const day = now.getUTCDay();
  const hour = now.getUTCHours();

  // Forex market hours (UTC):
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

// Main function
const startBot = async () => {
  try {
    await connectIG();

    console.log("Waiting for balance data...");
    setTimeout(async () => {
      await getAccountBalance();
      setInterval(async () => {
        if (isMarketOpen()) {
          // await checkAllPairsAndTrade();
          await placeOrder();
        } else {
          console.log("Market is closed. No trades will be placed.");
        }
      }, 10000);

      console.log("Bot started...");
    }, 3000);
  } catch (error) {
    console.error("Error:", error);
    throw error;
  }
};

startBot();
