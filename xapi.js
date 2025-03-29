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
  // host: "ws.xtb.com", // Explicitly set the host
  // host: process.env.XTB_API_URL, // Explicitly set the host
});

const connectXAPI = async () => {
  try {
    await x.connect();
    console.log("Connection established");

    // Verify connection
    const serverTime = await x.Socket.send.getServerTime();
    console.log("Server time:", new Date(serverTime.data.time));

    return true;
  } catch (error) {
    console.error("Error connecting to XAPI:", error.message);
    if (error.error && error.error.errorCode === "BE004") {
      console.error("Authentication failed. Please check your credentials.");
    }
    throw error;
  }
};

// Hole die Socket-ID, nachdem die Verbindung hergestellt wurde
const getSocketId = () => x.Socket.getSocketId();
// const streamId = socketId && x.Socket.connections[socketId].streamId;

module.exports = { x, connectXAPI, getSocketId };
