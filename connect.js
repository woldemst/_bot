// connect.js
require("dotenv").config();
const axios = require('axios');

// FXCM API configuration
const API_TOKEN = process.env.FXCM_API_TOKEN;
const BASE_URL = 'https://api-demo.fxcm.com:443';
const headers = {
  'Authorization': `Bearer ${API_TOKEN}`,
  'Content-Type': 'application/json'
};

// Check for required environment variables
if (!process.env.FXCM_API_TOKEN || !process.env.FXCM_ACCOUNT_ID) {
  throw new Error("Missing required environment variables. Please check your .env file");
}

// Connect and verify connection to FXCM
const connectAPI = async () => {
  try {
    // Test connection by getting trading session status
    const response = await axios.get(`${BASE_URL}/trading/get_model?models=TradingSessionStatus`, { headers });
    
    if (response.data && response.data.response) {
      console.log("FXCM connection established");
      return true;
    }
    
    throw new Error("Failed to establish connection with FXCM");
  } catch (error) {
    console.error("Error connecting to FXCM API:", error.message);
    throw error;
  }
};

// Helper function to format instrument for FXCM
const formatInstrument = (symbol) => {
  // FXCM uses standard forex pair notation
  const mapping = {
    EURUSD: "EUR/USD",
    GBPUSD: "GBP/USD",
    AUDUSD: "AUD/USD",
    EURGBP: "EUR/GBP",
    USDJPY: "USD/JPY",
    USDCAD: "USD/CAD",
    NZDUSD: "NZD/USD",
    USDCHF: "USD/CHF"
  };

  return mapping[symbol] || symbol;
};

// Helper function to convert timeframe to FXCM format
const convertTimeframe = (minutes) => {
  // FXCM timeframe format mapping
  const timeframeMap = {
    1: "m1",
    5: "m5",
    15: "m15",
    30: "m30",
    60: "H1",
    240: "H4",
    1440: "D1",
    10080: "W1",
    43200: "M1"
  };

  return timeframeMap[minutes] || "m1";
};

// FXCM order types and directions
const Direction = {
  BUY: 1,
  SELL: -1
};

const OrderType = {
  MARKET: "AtMarket",
  LIMIT: "Entry",
  STOP: "Entry"
};

const TimeInForce = {
  GTC: "GTC",
  IOC: "IOC",
  FOK: "FOK",
  DAY: "DAY"
};

module.exports = {
  connectAPI,
  formatInstrument,
  convertTimeframe,
  Direction,
  OrderType,
  TimeInForce,
  headers,
  BASE_URL
};
