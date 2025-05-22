from ibapi.ticktype import TickTypeEnum
from ibapi.contract import Contract
from config import logger

class RealTimeDataManager:
    def __init__(self, connection, data_handler):
        self.connection = connection
        self.data_handler = data_handler
        self.active_subscriptions = {}

    def subscribe_to_pair(self, symbol, timeframe='M1'):
        """Subscribe to real-time data for a forex pair"""
        contract = self._create_forex_contract(symbol)
        req_id = self._generate_subscription_id(symbol, timeframe)
        
        self.connection.reqMktData(
            reqId=req_id,
            contract=contract,
            genericTickList="",
            snapshot=False,
            regulatorySnapshot=False,
            mktDataOptions=[]
        )
        
        self.active_subscriptions[req_id] = {
            'symbol': symbol,
            'timeframe': timeframe,
            'last_update': None
        }
        logger.info(f"Subscribed to real-time data for {symbol}")

    def process_tick(self, req_id, tick_type, value):
        """Process incoming tick data"""
        if req_id not in self.active_subscriptions:
            return

        sub_info = self.active_subscriptions[req_id]
        symbol = sub_info['symbol']
        timeframe = sub_info['timeframe']
        
        if tick_type == TickTypeEnum.LAST:
            self.data_handler.update_realtime_price(symbol, timeframe, value)

    def _create_forex_contract(self, symbol):
        contract = Contract()
        contract.symbol = symbol[:3]
        contract.secType = "CASH"
        contract.currency = symbol[3:]
        contract.exchange = "IDEALPRO"
        return contract

    def _generate_subscription_id(self, symbol, timeframe):
        return hash(f"{symbol}_{timeframe}") % 1000000