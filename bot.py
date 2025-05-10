

from threading import Thread, Event
import time
import threading
import sys  # Add this for sys.exit
from typing import Any
from ibapi.wrapper import EWrapper
from ibapi.client import EClient
from ibapi.common import *
from ibapi.contract import Contract  # Add this import
from ibapi.order import Order  # Add this import
from ibapi.account_summary_tags import AccountSummaryTags
import pandas as pd

# At the top of your file, add:
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()
IB_ACCOUNT = os.getenv("IB_ACCOUNT")
IB_PASSWORD = os.getenv("IB_PASSWORD")
IB_HOST = os.getenv("IB_HOST")
PORT = 4002


SYMBOLS    = ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "EURGBP"]
MAX_OPEN   = 5
RISK_PER_TRADE = 0.01  # 1% per Trade
FAST_EMA   = 5
SLOW_EMA   = 20

# Then modify your connection line:
# app.connect(IB_HOST, PORT, clientId=0)

import logging

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler("trading_bot.log"),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

class ibapp(EClient, EWrapper):
    def __init__(self):
        EClient.__init__(self, self)
        self.data = {sym: pd.DataFrame() for sym in SYMBOLS}
        self.open_orders = 0
        self.done = Event()  # use threading.Event to signal between threads
        self.connection_ready = Event()  # to signal the connection has been established
        self.accountValue = (None, None, None)  # Initialize accountValue
        
    def error(self, reqId: TickerId, errorCode: int, errorString: str, contract: Any = None):
        logger.info(f"Error: {reqId}, Code: {errorCode}, Message: {errorString}")
        
        # Critical errors that should stop the bot
        critical_errors = [502, 504, 1100, 1300]
        if errorCode in critical_errors:
            logger.error("Critical error detected. Stopping bot...")
            self.done.set()
        
        # Connection-related warnings
        connection_warnings = [2104, 2107, 2108, 2158]
        if errorCode in connection_warnings:
            logger.info(f"Connection notice: {errorString}")

    def historicalData(self, reqId, bar):
        try:
            sym = SYMBOLS[reqId]
            df = self.data[sym]
            df.loc[pd.to_datetime(bar.date)] = {
                "open":  bar.open,
                "high":  bar.high,
                "low":   bar.low,
                "close": bar.close
            }
            self.data[sym] = df.tail(100)
        except Exception as e:
            logger.error(f"Error processing historical data: {str(e)}")
            
    def historicalDataEnd(self, reqId, start, end):
        try:
            sym = SYMBOLS[reqId]
            logger.info(f"Historical data received for {sym}")
        except Exception as e:
            logger.error(f"Error in historicalDataEnd: {str(e)}")

        # Strategy main loop
    def run_strategy(self):
        logger.info("Starting trading strategy")
        while True:
            try:
                # 1. Request historical data (100 M1-bars)
                for i, sym in enumerate(SYMBOLS):
                    contract = Contract()
                    contract.symbol = sym[:3]
                    contract.secType = "CASH"
                    contract.currency = sym[3:]
                    contract.exchange = "IDEALPRO"
                    self.reqHistoricalData(i, contract, "", "100 D", "1 min", "MIDPOINT", 1, 1, False, [])
                
                logger.info("Requested historical data for all symbols")
                time.sleep(5)  # Wait longer for data to arrive
                
                # 2. Calculate signals & place orders
                for sym, df in self.data.items():
                    if len(df) < SLOW_EMA:
                        logger.warning(f"Not enough data for {sym}, skipping")
                        continue
                        
                    closes = df["close"].astype(float)
                    fast = closes.ewm(span=FAST_EMA).mean().iloc[-1]
                    slow = closes.ewm(span=SLOW_EMA).mean().iloc[-1]
                    
                    # MACD calculation
                    macd_line = closes.ewm(span=12).mean() - closes.ewm(span=26).mean()
                    signal_line = macd_line.ewm(span=9).mean()
                    hist = (macd_line - signal_line).iloc[-1]
                    
                    price = closes.iloc[-1]
                    
                    # Check if we've reached maximum open positions
                    if self.open_orders >= MAX_OPEN:
                        logger.info(f"Maximum open positions ({MAX_OPEN}) reached, skipping new orders")
                        continue
                    
                    # Enhanced entry conditions
                    if fast > slow and hist > 0 and fast > fast.shift(1).iloc[-1]:
                        logger.info(f"BUY signal for {sym}: Fast EMA > Slow EMA, MACD histogram positive and increasing")
                        self.place_order(sym, "BUY", price)
                    elif fast < slow and hist < 0 and fast < fast.shift(1).iloc[-1]:
                        logger.info(f"SELL signal for {sym}: Fast EMA < Slow EMA, MACD histogram negative and decreasing")
                        self.place_order(sym, "SELL", price)
                
                logger.info("Completed strategy iteration, waiting for next cycle")
                time.sleep(60)  # 1-minute cycle
                
            except Exception as e:
                logger.error(f"Error in strategy execution: {str(e)}")
                time.sleep(30)  # Wait before retrying

    def place_order(self, sym, direction, price):
        try:
            # Position sizing: Risk 1% of account / SL distance in pips
            sl_pips = 10  # Increased from 5 for more breathing room
            tp_pips = 20  # 2:1 reward-to-risk ratio
            
            # Calculate stop loss distance based on currency pair
            is_jpy_pair = "JPY" in sym
            sl_dist = sl_pips * 1e-2 if is_jpy_pair else sl_pips * 1e-4
            tp_dist = tp_pips * 1e-2 if is_jpy_pair else tp_pips * 1e-4
            
            # Get account value for position sizing
            if self.accountValue[0] is None or self.accountValue[1] is None:
                logger.warning("Account value not available, using default position size")
                risk_amount = 1000  # Default risk amount
            else:
                risk_amount = float(self.accountValue[1]) * RISK_PER_TRADE
            
            # Calculate position size
            symbol_multiplier = 1000 if is_jpy_pair else 100000
            qty = max(1, int(risk_amount / (sl_dist * symbol_multiplier)))
            
            # Create contract
            contract = Contract()
            contract.symbol = sym[:3]
            contract.secType = "CASH"
            contract.currency = sym[3:]
            contract.exchange = "IDEALPRO"
            
            # Create main order
            main_order = Order()
            main_order.orderType = "MKT"
            main_order.totalQuantity = qty
            main_order.action = direction
            main_order.transmit = False  # Don't transmit until we've attached SL/TP
            main_order.orderId = self.nextOrderId
            parent_id = self.nextOrderId
            self.nextOrderId += 1
            
            # Calculate SL and TP prices
            sl_price = price - sl_dist if direction == "BUY" else price + sl_dist
            tp_price = price + tp_dist if direction == "BUY" else price - tp_dist
            
            # Create stop loss order
            sl_order = Order()
            sl_order.orderType = "STP"
            sl_order.totalQuantity = qty
            sl_order.action = "SELL" if direction == "BUY" else "BUY"
            sl_order.auxPrice = round(sl_price, 5)
            sl_order.parentId = parent_id
            sl_order.transmit = False
            sl_order.orderId = self.nextOrderId
            self.nextOrderId += 1
            
            # Create take profit order
            tp_order = Order()
            tp_order.orderType = "LMT"
            tp_order.totalQuantity = qty
            tp_order.action = "SELL" if direction == "BUY" else "BUY"
            tp_order.lmtPrice = round(tp_price, 5)
            tp_order.parentId = parent_id
            tp_order.transmit = True  # This will transmit all orders
            tp_order.orderId = self.nextOrderId
            self.nextOrderId += 1
            
            # Place orders
            self.placeOrder(parent_id, contract, main_order)
            self.placeOrder(sl_order.orderId, contract, sl_order)
            self.placeOrder(tp_order.orderId, contract, tp_order)
            
            logger.info(f"{direction} {sym} QTY={qty} @ {price:.5f}, SL={sl_price:.5f}, TP={tp_price:.5f}")
            self.open_orders += 1
            
        except Exception as e:
            logger.error(f"Error placing order: {str(e)}")

    # Rename this method to avoid conflict with the instance variable
    def accountSummaryValue(self, key, val, cur, accountName):
        self.accountValue = (key, val, cur)

    # override Ewrapper.error
    def error(
        self, reqId: TickerId, errorCode: int, errorString: str, contract: Any = None
    ):
        print("Error: ", reqId, " ", errorCode, " ", errorString)
        if errorCode == 502:  # not connected
            # set self.done (a threading.Event) to True
            self.done.set()

    # override Ewrapper.accountSummary - method for receiving account summary
    def accountSummary(
        self, reqId: int, account: str, tag: str, value: str, currency: str
    ):
        # just print the account information to screen
        print(
            "AccountSummary. ReqId:",
            reqId,
            "Account:",
            account,
            "Tag: ",
            tag,
            "Value:",
            value,
            "Currency:",
            currency,
        )

    # override Ewrapper.accountSummaryEnd - notifies when account summary information has been received
    def accountSummaryEnd(self, reqId: int):
        # print to screen
        print("AccountSummaryEnd. ReqId:", reqId)
        # set self.done (a threading.Event) to True
        self.done.set()

    # override Ewrapper.nextValidID - used to signal that the connection between application and TWS is complete
    # returns the next valid orderID (for any future transactions)
    # if we send messages before the connection has been established, they can be lost
    # so wait for this method to be called
    # Keep only this nextValidId method
    def nextValidId(self, orderId: int):
        logger.info(f"Connection ready, next valid order ID: {orderId}")
        self.nextOrderId = orderId
        self.connection_ready.set()  # signal that the connection is ready
        threading.Thread(target=self.run_strategy, daemon=True).start()

    def orderStatus(self, orderId, status, filled, remaining, avgFillPrice, permId, parentId, lastFillPrice, clientId, whyHeld, mktCapPrice):
        logger.info(f"Order {orderId} status: {status}, filled: {filled}, remaining: {remaining}, avgFillPrice: {avgFillPrice}")
        
        # If order is filled or cancelled, update open orders count
        if status in ["Filled", "Cancelled"]:
            if parentId == 0:  # This is a parent order
                self.open_orders -= 1
                logger.info(f"Order {orderId} {status}. Open orders: {self.open_orders}")
    
    def execDetails(self, reqId, contract, execution):
        logger.info(f"Execution: {execution.orderId}, {execution.side}, {execution.shares} @ {execution.price}")

# define our event loop - this will run in its own thread
def run_loop(app):
    app.run()

def main():
    # instantiate an ibapp
    app = ibapp()
    
    try:
        # connect using environment variables
        host = IB_HOST if IB_HOST else "127.0.0.1"
        port = int(PORT) if PORT else 4002
        
        logger.info(f"Connecting to {host}:{port}")
        app.connect(host, port, clientId=0)  # clientID identifies our application
        
        # start the application's event loop in a thread
        api_thread = Thread(target=run_loop, args=(app,), daemon=True)
        api_thread.start()
        
        # wait until the Ewrapper.nextValidId callback is triggered, indicating a successful connection
        if not app.connection_ready.wait(30):  # Wait up to 30 seconds for connection
            logger.error("Connection timeout. Could not connect to TWS/IB Gateway.")
            return
        
        # request account summary
        logger.info("Requesting account summary")
        app.reqAccountSummary(0, "All", AccountSummaryTags.AllTags)
        
        # Keep the main thread running
        try:
            while True:
                if app.done.is_set():
                    break
                time.sleep(1)
        except KeyboardInterrupt:
            logger.info("Keyboard interrupt detected. Shutting down...")
        
        # disconnect
        app.disconnect()
        logger.info("Bot shutdown complete")
        
    except Exception as e:
        logger.error(f"Error in main function: {str(e)}")
        if app:
            app.disconnect()

if __name__ == "__main__":
    main()