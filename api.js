// api.js
require("dotenv").config();
const XAPI = require("xapi-node").default;

const x = new XAPI({
  accountId: process.env.DEMO_ACCOUNT_ID,
  password: process.env.DEMO_PASSWORD,
  type: "demo",
});

const connect = async () => {
  try {
    await x.connect();
    console.log("Connection established");
  } catch (error) {
    console.error("Error connecting:", error);
    throw error;
  }
};

module.exports = { x, connect };
