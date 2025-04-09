require("dotenv").config();
const v20 = require('@oanda/v20');
const { calculateEMA, calculateMACD, calculateRSI } = require("./indicators");
const { backtestStrategy } = require("./backtesting");
const { CONFIG } = require("./config");
const { x, connectXAPI } = require("./oanda");

let currentBalance = null;

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
        console.error("Invalid balance data:", data);
      }
    });
  }
};

// get historical data (Candles)
const getHistoricalData = async (symbol, timeframe) => {
  try {
    const result = await x.getPriceHistory({ symbol, period: timeframe });
    return result && result.candles ? result.candles : [];
  } catch (err) {
    console.error("Error in getHistoricalData:", err);
    return [];
  }
};

// actual price of last candle (M1)
const getCurrentPrice = async (symbol) => {
  const candles = await getHistoricalData(symbol, CONFIG.timeframe.M1);
  if (candles.length === 0) return null;
  const closes = candles.map((c) => c.close);
  return closes[closes.length - 1];
};

// Converts raw prices into actual exchange rates
function normalizePrice(symbol, rawPrice) {
  const factor = symbol.includes("JPY") ? 1000 : 100000;
  return parseFloat((rawPrice / factor).toFixed(5));
}

// Returns the pip multiplier
function getPipMultiplier(symbol) {
  return symbol.includes("JPY") ? 0.01 : 0.0001;
}

// Check trading signal - using EMA, MACD and RSI as filters
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
  // const signalH1 = await generateSignal(symbol, CONFIG.timeframe.H1);
  const signalM15 = await generateSignal(symbol, CONFIG.timeframe.M15);
  const signalM1 = await generateSignal(symbol, CONFIG.timeframe.M1);
  if (!signalM1 || !signalM15) {
    console.error(`Not enough data for ${symbol}`);
    return null;
  }
  if (signalM1.signal === signalM15.signal) {
    return { signal: signalM1.signal, rawPrice: signalM1.rawPrice };
  }
  return { signal: signalM1.signal, lastPrice: signalM1.lastPrice };
};

// Calculate lot size (only 1 trade per currency pair, max 5 total)
function calculatePositionSize(accountBalance, riskPerTrade, stopLossPips, symbol) {
  const pipMultiplier = getPipMultiplier(symbol);
  const factor = symbol.includes("JPY") ? 1000 : 100000;
  const riskAmount = accountBalance * riskPerTrade;
  return riskAmount / (stopLossPips * (pipMultiplier * factor));
}

// Order execution: Uses current market price as basis and normalizes prices correctly
// Update the executeTradeForSymbol function to handle numeric signal values
async function executeTradeForSymbol(symbol, direction, rawPrice, lotSize) {
  const factor = symbol.includes("JPY") ? 1000 : 100000;
  const pipMultiplier = getPipMultiplier(symbol);
  const spreadRaw = 0.0002 * factor;
  
  // Convert numeric direction to string if needed
  const directionStr = typeof direction === 'number' 
    ? (direction === 0 ? "BUY" : "SELL") 
    : direction;
  
  const rawEntry = directionStr === "BUY" ? rawPrice + spreadRaw : rawPrice;
  const entry = normalizePrice(symbol, rawEntry);
  const rawSL =
    directionStr === "BUY"
      ? rawEntry - CONFIG.stopLossPips * (pipMultiplier * factor)
      : rawEntry + CONFIG.stopLossPips * (pipMultiplier * factor);
  const rawTP =
    directionStr === "BUY"
      ? rawEntry + CONFIG.takeProfitPips * (pipMultiplier * factor)
      : rawEntry - CONFIG.takeProfitPips * (pipMultiplier * factor);
  const sl = normalizePrice(symbol, rawSL);
  const tp = normalizePrice(symbol, rawTP);

  console.log(`Executing ${directionStr} trade for ${symbol}: entry=${entry}, SL=${sl}, TP=${tp}`);
  console.log("entry:", entry, "stop loss:", sl, "take profit:", tp);

  try {
    const order = await x.Socket.send.tradeTransaction({
      cmd: directionStr === "BUY" ? 0 : 1,
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
    console.log(`${directionStr} order executed for ${symbol} at ${entry}, order:`, order);
    
    // Add this to check if the order was actually placed
    if (order && order.data && order.data.returnData && order.data.returnData.order) {
      const orderId = order.data.returnData.order;
      console.log("Order successfully placed with ID:", orderId);
      
      // Check trade status after placement and log more details
      setTimeout(async () => {
        const status = await checkTradeStatus(orderId);
        console.log("Detailed trade status:", JSON.stringify(status, null, 2));
        
        // Also check if the trade appears in open positions
        const openPositions = await getOpenPositionsCount();
        console.log(`Current open positions: ${openPositions}`);
      }, 2000); // Wait 2 seconds for the order to process
      
      return orderId;
    } else {
      console.error("Order submission failed - no order ID in response");
      return null;
    }
  } catch (error) {
    console.error(`Failed to execute ${directionStr} trade for ${symbol}:`, error);
    return null;
  }
}

// Get open positions (wrapped in Promise)
async function getOpenPositionsCount() {
  return new Promise((resolve, reject) => {
    try {
      x.Stream.listen.getTrades((data) => {
        if (!data) {
          console.log("No trade data received");
          resolve(0);
          return;
        }
        
        const trades = Array.isArray(data) ? data : [data];
        const openTrades = trades.filter((t) => t && !t.closed);
        console.log("Open positions update:", openTrades);
        resolve(openTrades.length);
      });
      
      // Add a timeout in case the stream doesn't respond
      setTimeout(() => {
        console.log("Trade stream response timeout");
        resolve(0);
      }, 5000);
    } catch (err) {
      console.error("Error in trade stream listener:", err);
      resolve(0);
    }
  }).catch((err) => {
    console.error("Error fetching open positions:", err);
    return 0;
  });
}

// Check each symbol and potentially trigger a trade (max. 1 trade per symbol)
async function checkAndTradeForSymbol(symbol) {
  const signalData = await checkMultiTimeframeSignal(symbol);
  if (!signalData) {
    console.log(`No consistent multi-timeframe signal for ${symbol}`);
    return;
  }
  console.log(`Signal for ${symbol}: ${signalData.signal} at raw price ${signalData.rawPrice}`);

  // Check if a trade is already open for this symbol
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
  setTimeout(async () => {
    const historicalData = await getHistoricalData(CONFIG.symbols.AUDUSD, CONFIG.timeframe.M1);
    await backtestStrategy(CONFIG.symbols.AUDUSD, historicalData);
  }, 3000);
};

// Improve the checkTradeStatus function to provide more details
const checkTradeStatus = async (orderId) => {
  try {
    console.log(`Checking status for order ID: ${orderId}`);
    // Fix: Pass the orderId directly as a number, not as an object
    const tradeStatus = await x.Socket.send.tradeTransactionStatus({
      order: orderId // Don't wrap in another object, just pass the number
    });
    
    // Log more detailed information about the trade status
    if (tradeStatus && tradeStatus.data) {
      const status = tradeStatus.data;
      console.log(`Order ${orderId} status: ${status.requestStatus}`);
      
      if (status.requestStatus === 3) {
        console.log("Order was rejected. Reason:", status.message);
      } else if (status.requestStatus === 0) {
        console.log("Order is pending");
      } else if (status.requestStatus === 1) {
        console.log("Order was accepted");
      } else if (status.requestStatus === 2) {
        console.log("Order is being processed");
      }
    }
    
    return tradeStatus;
  } catch (err) {
    console.error("Failed to check trade status:", err);
    return null;
  }
};

const placeOrder = async () => {
  try {
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

    console.log("Attempting to place order with data:", orderData);
    const result = await x.Socket.send.tradeTransaction(orderData);
    console.log("Order response:", result);

    // Fix the success check condition
    if (result && result.data && result.data.returnData && result.data.returnData.order) {
      const orderId = result.data.returnData.order;
      console.log("Order successfully placed with ID:", orderId);

      // Check trade status after a short delay and wait for the result
      console.log("Waiting for order processing...");
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      try {
        const status = await checkTradeStatus(orderId);
        console.log("Status check completed");
      } catch (statusErr) {
        console.error("Error checking status:", statusErr);
      }
      
      // Also check if we can see the position in open trades
      console.log("Checking if trade appears in open positions...");
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      try {
        await getOpenPositionsCount();
      } catch (posErr) {
        console.error("Error checking positions:", posErr);
      }
      
      return orderId;
    } else {
      console.error("Order not accepted - no order ID in response");
      return null;
    }
  } catch (err) {
    console.error("Order failed:", err);
    return null;
  }
};

// Main function
const startBot = async () => {
  try {
    await connectXAPI();

    // Stream subscription
    try {
      await x.Stream.subscribe.getBalance();
      console.log("Balance stream subscribed");
    } catch (err) {
      console.error("Error subscribing to balance stream:", err);
    }
    try {
      await x.Stream.subscribe.getTickPrices("EURUSD");
    } catch (err) {
      console.error("subscribe for EURUSD failed:", err);
    }

    try {
      await x.Stream.subscribe.getTrades();
      console.log("Trades stream subscribed");
    } catch (err) {
      console.error("Error subscribing to trades stream:", err);
    }
    // Listener registration
    x.Stream.listen.getBalance((data) => {
      if (data && data.balance !== undefined) {
        currentBalance = data.balance;
        // console.log("Balance updated:", currentBalance);
      } else {
        console.error("Cannot update the balance", data);
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
      setInterval(async () => {
        if (isMarketOpen()) {
          // await checkAllPairsAndTrade();
          await placeOrder();
        } else {
          console.log("Market is closed. No trades will be placed.");
          return; // Exit the function if the market is closed to avoid placing trades during this time
        }
      }, 10000);

      console.log("Bot started...");
    }, 3000);

    //just for testing
    // await test();
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
