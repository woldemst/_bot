// oanda.js
require("dotenv").config();
const v20 = require('@oanda/v20');

// Check for required environment variables
if (!process.env.OANDA_API_KEY || !process.env.OANDA_ACCOUNT_ID) {
  throw new Error("Missing required environment variables. Please check your .env file");
}

// Create context object
const context = new v20.Context(
  process.env.OANDA_API_URL || 'https://api-fxpractice.oanda.com', // Use practice API by default
  {
    'Authorization': `Bearer ${process.env.OANDA_API_KEY}`,
    'Accept-Datetime-Format': 'RFC3339'
  }
);

const accountId = process.env.OANDA_ACCOUNT_ID;

// Connect and verify connection
const connectOanda = async () => {
  try {
    // Test connection by getting account summary
    const response = await context.account.summary(accountId);
    console.log("Oanda connection established");
    return true;
  } catch (error) {
    console.error("Error connecting to Oanda API:", error.message);
    throw error;
  }
};

module.exports = { context, accountId, connectOanda };