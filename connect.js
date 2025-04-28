// import dotenv from "dotenv";
// import { XMLHttpRequest } from 'xmlhttprequest';
// import * as FXConnectLite from "@gehtsoft/forex-connect-lite";

// // Initialize dotenv first
// dotenv.config();

// // Set XMLHttpRequest globally BEFORE importing FXConnectLite
// (global as any).XMLHttpRequest = XMLHttpRequest;
// (global as any).XMLHttpRequestLocal = XMLHttpRequest;

// // FXCM connection configuration
// const config = {
//   username: process.env.LOGIN,
//   password: process.env.PASSWORD,
//   server: "Demo", // or "Real" for live trading
//   url: "www.fxcorporate.com/Hosts.jsp",
// };

// // Connect and verify connection to FXCM
// export const connectAPI = async () => {
//   try {
//     const session = await FXConnectLite.default.createSession(config);
//     console.log("FXCM connection established");

//     // Subscribe to price updates
//     const priceSubscription = await session.subscribe("EUR/USD");

//     // Set up price update handler
//     priceSubscription.onUpdate((update: { instrument: string; bid: number; ask: number; timestamp: Date }) => {
//       console.log("Price Update:", {
//         symbol: update.instrument,
//         bid: update.bid,
//         ask: update.ask,
//         timestamp: update.timestamp
//       });
//     });

//     return session;
//   } catch (error: any) {
//     console.error("Error connecting to FXCM API:", error.message);
//     throw error;
//   }
// };

// // Execute the connection immediately
// connectAPI().catch(console.error);


const {
    FXConnectLiteSessionFactory,
    IConnectionStatusChangeListener,
    ILoginCallback,
    LoginError
  } = require("@gehtsoft/forex-connect-lite-node");
require("dotenv").config();

let session = FXConnectLiteSessionFactory.create("LoginSample");
// console.log(session);

class ConnectionStatusChangeListener extends IConnectionStatusChangeListener {
    onConnectionStatusChange(status) {
      console.log("Connection status changed. ", status);
    }
  }
  
  session.subscribeConnectionStatusChange(new ConnectionStatusChangeListener());

  // Configure connection parameters
const config = {
    username: process.env.LOGIN,
    password: process.env.PASSWORD,
    server: "Demo", // or "Real" for live trading
    url: "www.fxcorporate.com/Hosts.jsp",
  };