from datetime import datetime, timedelta
import pandas as pd
from ibapi.contract import Contract
from config import logger

class HistoricalDataManager:
    def __init__(self, connection, data_handler):
        self.connection = connection
        self.data_handler = data_handler
        
    def request_historical_data(self, symbol, timeframe, duration="1 M", bar_size="1 min"):
        """
        Request historical data for a forex pair
        Args:
            symbol (str): Currency pair (e.g., 'EURUSD')
            timeframe (str): One of TIMEFRAMES keys from config
            duration (str): IBKR duration string (e.g., '1 M', '100 D')
            bar_size (str): Bar size (e.g., '1 min', '1 hour')
        """
        contract = self._create_forex_contract(symbol)
        req_id = self._generate_request_id(symbol, timeframe)
        
        self.connection.reqHistoricalData(
            reqId=req_id,
            contract=contract,
            endDateTime="",
            durationStr=duration,
            barSizeSetting=bar_size,
            whatToShow="MIDPOINT",
            useRTH=1,
            formatDate=1,
            keepUpToDate=False,
            chartOptions=[]
        )
        logger.info(f"Requested historical data for {symbol} ({timeframe})")

    def _create_forex_contract(self, symbol):
        contract = Contract()
        contract.symbol = symbol[:3]
        contract.secType = "CASH"
        contract.currency = symbol[3:]
        contract.exchange = "IDEALPRO"
        return contract

    def _generate_request_id(self, symbol, timeframe):
        symbol_index = list(self.data_handler.data.keys()).index(symbol)
        timeframe_index = list(self.data_handler.data[symbol].keys()).index(timeframe)
        return symbol_index * 100 + timeframe_index