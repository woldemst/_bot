// import { connectAPI } from "./connect.js";
// // import { calculateEMA, calculateMACD, calculateRSI } from './indicators.js';
// import { CONFIG } from "./config.js";

// // // Get account balance
// // const getAccountBalance = async () => {
// //   if (!session) return null;

// //   try {
// //     const accounts = await session.getAccounts();
// //     const account = accounts[0]; // Using first account
// //     currentBalance = account.balance;
// //     console.log("Balance:", currentBalance);
// //     return currentBalance;
// //   } catch (error) {
// //     console.error("Error fetching balance:", error);
// //     return null;
// //   }
// // };

// // // Get historical candles
// // const getHistoricalData = async (symbol, timeframe) => {
// //   if (!session) return [];

// //   try {
// //     const candles = await session.getCandles(symbol, timeframe, 100);
// //     return candles.map(candle => ({
// //       close: candle.close,
// //       open: candle.open,
// //       high: candle.high,
// //       low: candle.low,
// //       timestamp: candle.timestamp
// //     }));
// //   } catch (error) {
// //     console.error("Error fetching historical data:", error);
// //     return [];
// //   }
// // };

// // // Get current price
// // const getCurrentPrice = async (symbol) => {
// //   if (!session) return null;

// //   try {
// //     const price = await session.getPrice(symbol);
// //     return (price.bid + price.ask) / 2;
// //   } catch (error) {
// //     console.error("Error getting current price:", error);
// //     return null;
// //   }
// // };

// // // Generate trading signals
// // const generateSignal = async (symbol, timeframe) => {
// //   const candles = await getHistoricalData(symbol, timeframe);
// //   if (candles.length < 50) return null;

// //   const closes = candles.map(c => c.close);
// //   const fastEMA = calculateEMA(closes, CONFIG.fastEMA);
// //   const slowEMA = calculateEMA(closes, CONFIG.slowEMA);
// //   const macd = calculateMACD(closes);
// //   const rsi = calculateRSI(closes);
// //   const lastPrice = closes[closes.length - 1];

// //   console.log(
// //     `Signal for ${symbol}: fastEMA=${fastEMA.toFixed(5)}, slowEMA=${slowEMA.toFixed(5)}, MACD=${macd.histogram.toFixed(5)}, RSI=${rsi?.toFixed(2)}`
// //   );

// //   // Buy conditions
// //   if (fastEMA > slowEMA && macd.histogram > 0 && rsi < CONFIG.rsiBuyThreshold) {
// //     return { signal: "BUY", lastPrice };
// //   }
// //   // Sell conditions
// //   else if (fastEMA < slowEMA && macd.histogram < 0 && rsi > CONFIG.rsiSellThreshold) {
// //     return { signal: "SELL", lastPrice };
// //   }

// //   return null;
// // };

// // // Calculate position size
// // const calculatePositionSize = (balance, riskPerTrade, stopLossPips, symbol) => {
// //   const pipValue = symbol.includes("JPY") ? 0.01 : 0.0001;
// //   const riskAmount = balance * riskPerTrade;
// //   return Math.floor(riskAmount / (stopLossPips * pipValue));
// // };

// // // Execute trade
// // const executeTrade = async (symbol, direction, price, lotSize) => {
// //   if (!session) return null;

// //   try {
// //     const pipValue = symbol.includes("JPY") ? 0.01 : 0.0001;
// //     const stopLoss = direction === "BUY"
// //       ? price - (CONFIG.stopLossPips * pipValue)
// //       : price + (CONFIG.stopLossPips * pipValue);
// //     const takeProfit = direction === "BUY"
// //       ? price + (CONFIG.takeProfitPips * pipValue)
// //       : price - (CONFIG.takeProfitPips * pipValue);

// //     const order = {
// //       symbol,
// //       isBuy: direction === "BUY",
// //       amount: lotSize,
// //       stopLoss,
// //       takeProfit
// //     };

// //     const trade = await session.createOrder(order);
// //     console.log(`${direction} order executed for ${symbol} at ${price}`);
// //     return trade;
// //   } catch (error) {
// //     console.error("Error executing trade:", error);
// //     return null;
// //   }
// // };

// // // Main trading loop
// // const startTrading = async () => {
// //   if (!session) {
// //     console.error("No active session");
// //     return;
// //   }

// //   const balance = await getAccountBalance();
// //   if (!balance) {
// //     console.error("Could not get account balance");
// //     return;
// //   }

// //   // Monitor each symbol
// //   for (const symbol of Object.values(CONFIG.symbols)) {
// //     const signal = await generateSignal(symbol, CONFIG.timeframe.M15);
// //     if (!signal) continue;

// //     const currentPrice = await getCurrentPrice(symbol);
// //     if (!currentPrice) continue;

// //     const lotSize = calculatePositionSize(
// //       balance,
// //       CONFIG.riskPerTrade,
// //       CONFIG.stopLossPips,
// //       symbol
// //     );

// //     await executeTrade(symbol, signal.signal, currentPrice, lotSize);
// //   }
// // };

// // Initialize and start trading
// async function init() {
//   try {
//     await connectAPI();
//   } catch (error) {
//     console.error("Failed to initialize:", error);
//   }
// }

// init();
