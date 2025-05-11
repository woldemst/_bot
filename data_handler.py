import pandas as pd
from config import logger, SYMBOLS

class DataHandler:
    def __init__(self):
        self.data = {sym: pd.DataFrame() for sym in SYMBOLS}
    
    def process_historical_data(self, reqId, bar):
        """Process incoming historical data bars"""
        try:
            sym = SYMBOLS[reqId]
            df = self.data[sym]
            df.loc[pd.to_datetime(bar.date)] = {
                "open": bar.open,
                "high": bar.high,
                "low": bar.low,
                "close": bar.close,
            }
            self.data[sym] = df.tail(100)
        except Exception as e:
            logger.error(f"Error processing historical data: {str(e)}")
    
    def get_data(self, symbol):
        """Get data for a specific symbol"""
        return self.data.get(symbol, pd.DataFrame())
    
    def get_all_data(self):
        """Get all data"""
        return self.data