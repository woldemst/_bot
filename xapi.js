// xapi.js
require("dotenv").config();
const XAPI = require("xapi-node").default;

// Add error checking for environment variables
if (!process.env.DEMO_ACCOUNT_ID || !process.env.DEMO_PASSWORD) {
  throw new Error("Missing required environment variables. Please check your .env file");
}

const x = new XAPI({
  accountId: process.env.DEMO_ACCOUNT_ID,
  password: process.env.DEMO_PASSWORD,
  type: "demo",
  host: "xapi.xtb.com", // Explicitly set the correct host for XTB
});

const connectXAPI = async () => {
  try {
    console.log("Attempting to connect to XTB API...");
    // Add await here - this was missing
    await x.connect();
    console.log("Connection established");

    return true;
  } catch (error) {
    console.error("Error connecting to XAPI:", error.message);
    
    // More detailed error handling
    if (error.error) {
      console.error("Error code:", error.error.errorCode);
      console.error("Error description:", error.error.errorDescr || "No description available");
      
      if (error.error.errorCode === "BE004") {
        console.error("Connection error - check your internet connection or XTB server status");
      } else if (error.error.errorCode === "BE005") {
        console.error("Authentication failed - check your credentials");
      }
    }
    
    return false;
  }
};

// const connectXAPI = async () => {
//   try {
//     x.connect();
//     console.log("Connection established");
//   } catch (error) {
//     console.error("Error connecting to XAPI:", error);
//     throw error;
//   }
// };
// const getSocketId = x.Socket.getSocketId();

// const streamId = socketId && x.Socket.connections[socketId].streamId;

module.exports = { x, connectXAPI };
