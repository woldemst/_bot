// xapi.js
require("dotenv").config();
const XAPI = require("xapi-node").default;

const x = new XAPI({
  accountId: process.env.DEMO_ACCOUNT_ID,
  password: process.env.DEMO_PASSWORD,
  type: "demo",
});

const connectXAPI = async () => {
  try {
    await x.connect();
    console.log("Connection established");
  } catch (error) {
    console.error("Error connecting to XAPI:", error);
    throw error;
  }
};

// Hole die Socket-ID, nachdem die Verbindung hergestellt wurde
const getSocketId = () => x.Socket.getSocketId();
const socketId = getSocketId();
// const streamId = socketId && x.Socket.connections[socketId].streamId;

module.exports = { x, connectXAPI, getSocketId, socketId };
