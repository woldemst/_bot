import { Session, Order } from "@gehtsoft/forex-connect-lite";
import { connectAPI } from "./connect.js";

class TradingBot {
  private session: Session | null = null;
  private symbol = "EUR/USD";
  private lotSize = 1000; // Mini lot size

  async initialize() {
    this.session = await connectAPI();
    console.log("Trading bot initialized");
  }

  async placeBuyOrder() {
    if (!this.session) {
      throw new Error("Session not initialized");
    }

    try {
      const order: Order = {
        instrument: this.symbol,
        amount: this.lotSize,
        rate: 0, // Market order
        side: "buy",
        type: "market"
      };

      const trade = await this.session.createOrder(order);
      console.log("Buy order placed:", trade);
      return trade;
    } catch (error: any) {
      console.error("Error placing buy order:", error.message);
      throw error;
    }
  }

  async placeSellOrder() {
    if (!this.session) {
      throw new Error("Session not initialized");
    }

    try {
      const order: Order = {
        instrument: this.symbol,  // Changed from 'symbol' to 'instrument'
        amount: this.lotSize,
        rate: 0, // Market order
        side: "sell",
        type: "market"
      };

      const trade = await this.session.createOrder(order);
      console.log("Sell order placed:", trade);
      return trade;
    } catch (error: any) {
      console.error("Error placing sell order:", error.message);
      throw error;
    }
  }

  async getAccountInfo() {
    if (!this.session) {
      throw new Error("Session not initialized");
    }

    try {
      const accounts = await this.session.getAccounts();
      console.log("Account information:", accounts);
      return accounts;
    } catch (error: any) {
      console.error("Error getting account info:", error.message);
      throw error;
    }
  }
}

// Create and start the trading bot
const startBot = async () => {
  const bot = new TradingBot();
  await bot.initialize();
  await bot.getAccountInfo();
};

startBot().catch(console.error);