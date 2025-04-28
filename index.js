// install with: npm install @gehtsoft/forex-connect-lite

import dotenv from "dotenv";
import { ForexConnectLite } from '@gehtsoft/forex-connect-lite';

async function main() {
  // 1) Instantiate client with your FXCM credentials & server
  const client = new ForexConnectLite({
    user:     process.env.FXCM_USER,        // your FXCM username
    password: process.env.FXCM_PASSWORD,    // your FXCM password
    server:   'Demo',                       // or 'Real'
    url:      'https://www.fxcorporate.com' // the FXCM Hosts URL
  });

  // 2) Connect and wait for login
  await client.connect();
  console.log('✅ Connected to FXCM via FCLite');

  // 3) Get and log your account balance
  const accounts = await client.getAccounts();
  console.log('Balance:', accounts[0].balance);

  // 4) Subscribe to live ticks for EUR/USD
  client.onPrice('EUR/USD', tick => {
    console.log('Tick:', tick.bid, tick.ask, new Date(tick.timestamp));
  });

  // 5) Place a simple market order
  const order = await client.placeOrder({
    symbol:     'EUR/USD',                // instrument
    direction:  'BUY',                    // or 'SELL'
    volume:     10000,                    // units
    orderType:  'MARKET',                 // market execution
    stopLoss:   1.0850,                   // SL price
    takeProfit: 1.0950                    // TP price
  });
  console.log('Order placed:', order);

  // 6) Later you can check open positions
  const positions = await client.getOpenPositions();
  console.log('Open positions:', positions);
}

main().catch(console.error);
