// data.js
const { x } = require("./api");

async function getHistoricalData(symbol, timeframe) {
  try {
    const result = await x.getPriceHistory({ symbol, period: timeframe });
    return result && result.candles ? result.candles : [];
  } catch (err) {
    console.error("Error in getHistoricalData:", err);
    return [];
  }
}

async function getCurrentPrice(symbol, timeframe = 1) {
  // Nutzt die M1-Daten, sofern kein anderer Timeframe angegeben ist
  const candles = await getHistoricalData(symbol, timeframe);
  if (candles.length === 0) return null;
  const closes = candles.map((c) => c.close);
  return closes[closes.length - 1];
}

module.exports = { getHistoricalData, getCurrentPrice };
