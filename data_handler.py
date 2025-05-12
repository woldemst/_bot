import pandas as pd
import numpy as np
from config import logger, SYMBOLS, TIMEFRAMES, RSI_PERIOD, BB_PERIOD, BB_STD_DEV

class DataHandler:
    def __init__(self):
        # Initialize data structure for each symbol and timeframe
        self.data = {
            sym: {tf: pd.DataFrame() for tf in TIMEFRAMES} 
            for sym in SYMBOLS
        }
    
    def process_historical_data(self, reqId, bar, timeframe_key=None):
        """Process incoming historical data bars"""
        try:
            # Extract symbol and timeframe from reqId
            # Format: reqId = symbol_index * 100 + timeframe_index
            symbol_index = reqId // 100
            timeframe_index = reqId % 100
            
            if symbol_index >= len(SYMBOLS):
                logger.error(f"Invalid symbol index: {symbol_index}")
                return
                
            sym = SYMBOLS[symbol_index]
            
            # Map timeframe index to key
            tf_keys = list(TIMEFRAMES.keys())
            if timeframe_index >= len(tf_keys):
                logger.error(f"Invalid timeframe index: {timeframe_index}")
                return
                
            tf = tf_keys[timeframe_index]
            
            # Get dataframe for this symbol and timeframe
            df = self.data[sym][tf]
            
            # Add new data
            df.loc[pd.to_datetime(bar.date)] = {
                "open": bar.open,
                "high": bar.high,
                "low": bar.low,
                "close": bar.close,
                "volume": bar.volume if hasattr(bar, 'volume') else 0
            }
            
            # Keep only the last 300 bars to manage memory
            self.data[sym][tf] = df.tail(300)
            
            # Calculate indicators when we have enough data
            self._calculate_indicators(sym, tf)
            
        except Exception as e:
            logger.error(f"Error processing historical data: {str(e)}")
    
    def _calculate_indicators(self, symbol, timeframe):
        """Calculate technical indicators for a specific symbol and timeframe"""
        try:
            df = self.data[symbol][timeframe]
            if len(df) < max(RSI_PERIOD, BB_PERIOD, 26):  # Need enough data for all indicators
                return
                
            # Calculate EMAs
            df['ema_fast'] = df['close'].ewm(span=5).mean()
            df['ema_slow'] = df['close'].ewm(span=20).mean()
            
            # Calculate MACD
            df['ema12'] = df['close'].ewm(span=12).mean()
            df['ema26'] = df['close'].ewm(span=26).mean()
            df['macd'] = df['ema12'] - df['ema26']
            df['signal'] = df['macd'].ewm(span=9).mean()
            df['histogram'] = df['macd'] - df['signal']
            
            # Calculate RSI
            delta = df['close'].diff()
            gain = delta.where(delta > 0, 0)
            loss = -delta.where(delta < 0, 0)
            avg_gain = gain.rolling(window=RSI_PERIOD).mean()
            avg_loss = loss.rolling(window=RSI_PERIOD).mean()
            rs = avg_gain / avg_loss
            df['rsi'] = 100 - (100 / (1 + rs))
            
            # Calculate Bollinger Bands
            df['bb_middle'] = df['close'].rolling(window=BB_PERIOD).mean()
            df['bb_std'] = df['close'].rolling(window=BB_PERIOD).std()
            df['bb_upper'] = df['bb_middle'] + (df['bb_std'] * BB_STD_DEV)
            df['bb_lower'] = df['bb_middle'] - (df['bb_std'] * BB_STD_DEV)
            
            # Update the dataframe
            self.data[symbol][timeframe] = df
            
        except Exception as e:
            logger.error(f"Error calculating indicators for {symbol} {timeframe}: {str(e)}")
    
    def get_data(self, symbol, timeframe):
        """Get data for a specific symbol and timeframe"""
        return self.data.get(symbol, {}).get(timeframe, pd.DataFrame())
    
    def get_all_data(self):
        """Get all data"""
        return self.data