// ig.js
require("dotenv").config();
const { IGApi, APIClient, Deal, Direction, OrderType, TimeInForce } = require("ig-trading-api");

// Check for required environment variables
if (!process.env.IG_API_KEY || !process.env.IG_USERNAME || !process.env.IG_PASSWORD) {
  throw new Error("Missing required environment variables. Please check your .env file");
}

// Create API client
const igClient = new IGApi({
  apiKey: process.env.IG_API_KEY,
  isDemo: process.env.IG_IS_DEMO === "true", // Set to true for demo account
  username: process.env.IG_USERNAME,
  password: process.env.IG_PASSWORD,
});

// Connect and verify connection
const connectIG = async () => {
  try {
    // Login to the IG API
    await igClient.login();
    console.log("IG connection established");

    // Get account info to verify connection
    const accountInfo = await igClient.getAccountInfo();
    console.log("Account connected:", accountInfo.accountId);

    return true;
  } catch (error) {
    console.error("Error connecting to IG API:", error.message);
    throw error;
  }
};

// Helper function to format instrument for IG
// IG uses different format than Oanda or XTB
const formatInstrument = (symbol) => {
  // For IG, we need to check their specific instrument codes
  // This is a basic mapping, you might need to adjust based on IG's actual instrument codes
  const mapping = {
    EURUSD: "CS.D.EURUSD.MINI.IP",
    GBPUSD: "CS.D.GBPUSD.MINI.IP",
    AUDUSD: "CS.D.AUDUSD.MINI.IP",
    EURGBP: "CS.D.EURGBP.MINI.IP",
  };

  return mapping[symbol] || symbol;
};

// Helper function to convert timeframe to IG format
const convertTimeframe = (minutes) => {
  switch (minutes) {
    case 1:
      return "MINUTE";
    case 5:
      return "MINUTE_5";
    case 15:
      return "MINUTE_15";
    case 30:
      return "MINUTE_30";
    case 60:
      return "HOUR";
    case 240:
      return "HOUR_4";
    case 1440:
      return "DAY";
    default:
      return "MINUTE";
  }
};

module.exports = {
  igClient,
  connectIG,
  formatInstrument,
  convertTimeframe,
  Direction, // Export IG's Direction enum for use in orders
  OrderType, // Export IG's OrderType enum
  TimeInForce, // Export IG's TimeInForce enum
};
