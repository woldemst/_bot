from threading import Event
import time
from ibapi.wrapper import EWrapper
from ibapi.client import EClient
# from ibapi.common import TickerId
# from typing import Any
# Removed unused import AccountSummaryTags
import threading

from config import logger
from data_handler import DataHandler
from strategy import TradingStrategy
from order_manager import OrderManager

class IBConnection(EWrapper, EClient):
    def __init__(self):
        EClient.__init__(self, self)
        self.done = Event()  # use threading.Event to signal between threads
        self.connection_ready = Event()  # to signal the connection has been established
        self.accountValue = (None, None, None)  # Initialize accountValue
        self.nextOrderId = None
        
        # Initialize modules
        self.data_handler = DataHandler()
        self.strategy = TradingStrategy(self.data_handler)
        self.order_manager = OrderManager(self)
    
    def error(self, reqId, errorCode, errorString, advancedOrderRejectJson=None, errorTime=None):
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
        """Handle incoming historical data"""
        self.data_handler.process_historical_data(reqId, bar)
    
    def historicalDataEnd(self, reqId, start, end):
        """Handle end of historical data stream"""
        from config import SYMBOLS
        try:
            sym = SYMBOLS[reqId]
            logger.info(f"Historical data received for {sym}")
        except Exception as e:
            logger.error(f"Error in historicalDataEnd: {str(e)}")
    
    def accountSummaryValue(self, key, val, cur, accountName):
        """Store account summary value"""
        self.accountValue = (key, val, cur)
    
    def accountSummary(self, reqId, account, tag, value, currency):
        """Handle account summary information"""
        logger.info(f"AccountSummary. ReqId: {reqId}, Account: {account}, Tag: {tag}, Value: {value}, Currency: {currency}")
    
    def accountSummaryEnd(self, reqId: int):
        """Handle end of account summary information"""
        logger.info(f"AccountSummaryEnd. ReqId: {reqId}")
        self.done.set()
    
    def nextValidId(self, orderId: int):
        """Handle next valid order ID"""
        logger.info(f"Connection ready, next valid order ID: {orderId}")
        self.nextOrderId = orderId
        self.connection_ready.set()  # signal that the connection is ready
        threading.Thread(target=self.run_strategy, daemon=True).start()
    
    def orderStatus(self, orderId, status, filled, remaining, avgFillPrice, permId, parentId, lastFillPrice, clientId, whyHeld, mktCapPrice):
        """Handle order status updates"""
        logger.info(f"Order {orderId} status: {status}, filled: {filled}, remaining: {remaining}, avgFillPrice: {avgFillPrice}")
        self.order_manager.update_order_status(orderId, status, parentId)
    
    def execDetails(self, reqId, contract, execution):
        """Handle execution details"""
        logger.info(f"Execution: {execution.orderId}, {execution.side}, {execution.shares} @ {execution.price}")
    
    def run_strategy(self):
        """Run the trading strategy"""
# Import moved to where it's actually used
        logger.info("Starting trading strategy")
        
        while True:
            try:
                # 1. Request historical data
                self._request_historical_data()
                
                # 2. Calculate signals & place orders
                signals = self.strategy.calculate_signals(self.order_manager.open_orders)
                
                # 3. Execute signals
                for signal in signals:
                    self.order_manager.place_order(
                        signal["symbol"], 
                        signal["direction"], 
                        signal["price"]
                    )
                
                logger.info("Completed strategy iteration, waiting for next cycle")
                time.sleep(60)  # 1-minute cycle
                
            except Exception as e:
                logger.error(f"Error in strategy execution: {str(e)}")
                time.sleep(30)  # Wait before retrying
    
    def _request_historical_data(self):
        """Request historical data for all symbols"""
        from config import SYMBOLS
        from ibapi.contract import Contract

        
        for i, sym in enumerate(SYMBOLS):
            contract = Contract()
            contract.symbol = sym[:3]
            contract.secType = "CASH"
            contract.currency = sym[3:]
            contract.exchange = "IDEALPRO"
            self.reqHistoricalData(
                i, contract, "", "100 D", "1 min", "MIDPOINT", 1, 1, False, []
            )
        
        logger.info("Requested historical data for all symbols")
        time.sleep(5)  # Wait for data to arrive
    
    def request_market_data(self):
        from ibapi.contract import Contract

        contract = Contract()
        contract.currency = "USD"
        self.reqMktData(1, contract, "", False, False, [])
        

def run_loop(app):
    """Run the event loop"""
    app.run()