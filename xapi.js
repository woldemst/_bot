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
  host: "xapi.xtb.com",  // Use the correct XTB demo server
});

const connectXAPI = async () => {
  try {
    await x.connect();
    console.log("Connection established");

    // Add connection verification
    const loginCheck = await x.Socket.send.ping();
    if (!loginCheck || !loginCheck.status) {
      throw new Error("Failed to verify connection");
    }
    console.log("Connection verified");

    return true;
  } catch (error) {
    console.error("Error connecting to XAPI:", error.message);
    if (error.error?.errorCode === "BE005") {
      console.error("Invalid login credentials. Please check your demo account ID and password");
    }
    process.exit(1); // Exit cleanly instead of throwing
  }
};

// Hole die Socket-ID, nachdem die Verbindung hergestellt wurde
const getSocketId = () => x.Socket.getSocketId();

// const streamId = socketId && x.Socket.connections[socketId].streamId;

module.exports = { x, connectXAPI, getSocketId };
