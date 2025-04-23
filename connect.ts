// connect.js
import dotenv from "dotenv";
// TODO: Install the package first using: npm install @gehtsoft/forex-connect-lite-node
// If types are needed, also install: npm install --save-dev @types/gehtsoft__forex-connect-lite-node
import * as FXConnectLite from "@gehtsoft/forex-connect-lite-node";

// dotenv.config();

// FXCM connection configuration
const config = {
  username: process.env.LOGIN,
  password: process.env.PASSWORD,
  server: "Demo", // or "Real" for live trading
  url: "www.fxcorporate.com/Hosts.jsp",
};

// Connect and verify connection to FXCM
export const connectAPI = async () => {
  try {
    console.log(FXConnectLite);

    // const session = await FXConnectLite.createSession(config);
    console.log("FXCM connection established");
    // return session;
  } catch (error: any) {
    console.error("Error connecting to FXCM API:", error.message);
    throw error;
  }
};
