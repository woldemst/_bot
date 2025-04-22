// connect.js
require("dotenv").config();
global.XMLHttpRequest = require('xmlhttprequest').XMLHttpRequest;
const { FXConnectLite } = require("@gehtsoft/forex-connect-lite");

// FXCM connection configuration
const config = {
  username: process.env.LOGIN,
  password: process.env.PASSWORD,
  server: "Demo", // or "Real" for live trading
  url: "www.fxcorporate.com/Hosts.jsp"
};

// Connect and verify connection to FXCM
const connectAPI = async () => {
  try {
    const session = await FXConnectLite.createSession(config);
    console.log("FXCM connection established");
    return session;
  } catch (error) {
    console.error("Error connecting to FXCM API:", error.message);
    throw error;
  }
};

module.exports = {
  connectAPI,
};
