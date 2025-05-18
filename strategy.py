# import pandas as pd
# import numpy as np
from config import (
    logger, SLOW_EMA, MAX_OPEN, SYMBOLS, TIMEFRAMES,
    RSI_OVERBOUGHT, RSI_OVERSOLD, RSI_BULLISH, RSI_BEARISH
)

class TradingStrategy:
    def __init__(self, data_handler):
        self.data_handler = data_handler
        self.positions = {sym: None for sym in SYMBOLS}  # Track positions by symbol
    
    def calculate_signals(self, open_orders):
        """Calculate trading signals for all symbols"""
        signals = []
        
        # Check if we've reached maximum open positions
        if open_orders >= MAX_OPEN:
            logger.info(f"Maximum open positions ({MAX_OPEN}) reached, skipping new orders")
            return signals
        
        # Process each symbol
        for sym in SYMBOLS:
            # Skip if we already have a position for this symbol
            if self.positions[sym] is not None:
                logger.info(f"Already have a position for {sym}, skipping")
                continue
                
            # Check if we have enough data for all timeframes
            has_all_data = True
            for tf in TIMEFRAMES:
                df = self.data_handler.get_data(sym, tf)
                if len(df) < SLOW_EMA:
                    logger.warning(f"Not enough data for {sym} on {tf}, skipping")
                    has_all_data = False
                    break
            
            if not has_all_data:
                continue
                
            # Get signal for this symbol
            signal = self._calculate_signal_for_symbol(sym)
            if signal:
                signals.append(signal)
                
                # Only take one signal at a time to avoid overtrading
                if len(signals) + open_orders >= MAX_OPEN:
                    break
                
        return signals
    
    def _calculate_signal_for_symbol(self, symbol):
        """Calculate trading signal for a specific symbol using multiple timeframes"""
        try:
            # Get data for different timeframes
            m1_data = self.data_handler.get_data(symbol, "M1")
            m15_data = self.data_handler.get_data(symbol, "M15")
            h1_data = self.data_handler.get_data(symbol, "H1")
            h4_data = self.data_handler.get_data(symbol, "H4")
            d1_data = self.data_handler.get_data(symbol, "D1")
            
            if m1_data.empty or m15_data.empty or h1_data.empty or h4_data.empty or d1_data.empty:
                return None
            
            # Determine main trend from higher timeframes
            h4_trend = self._determine_trend(h4_data)
            d1_trend = self._determine_trend(d1_data)
            
            # Only trade in the direction of the higher timeframe trend
            if h4_trend == "neutral" or d1_trend == "neutral":
                return None
                
            if h4_trend != d1_trend:
                logger.info(f"{symbol}: Mixed trend on higher timeframes, skipping")
                return None
                
            main_trend = h4_trend  # Use H4 as the main trend
            
            # Check for entry signals on lower timeframes
            m1_signal = self._check_entry_signal(m1_data, main_trend)
            m15_signal = self._check_entry_signal(m15_data, main_trend)
            h1_signal = self._check_entry_signal(h1_data, main_trend)
            
            # Only generate a signal if M1 shows an entry and M15/H1 confirm the trend
            if m1_signal and m15_signal == main_trend and h1_signal == main_trend:
                price = m1_data['close'].iloc[-1]
                logger.info(f"{symbol}: {main_trend} signal confirmed across multiple timeframes")
                return {"symbol": symbol, "direction": main_trend, "price": price}
                
            return None
            
        except Exception as e:
            logger.error(f"Error calculating signal for {symbol}: {str(e)}")
            return None
    
    def _determine_trend(self, df):
        """Determine the trend based on EMAs and MACD"""
        if df.empty or 'ema_fast' not in df.columns or 'ema_slow' not in df.columns:
            return "neutral"
            
        fast = df['ema_fast'].iloc[-1]
        slow = df['ema_slow'].iloc[-1]
        
        if fast > slow:
            return "BUY"
        elif fast < slow:
            return "SELL"
        else:
            return "neutral"
    
    def _check_entry_signal(self, df, trend_direction):
        """Check for entry signals based on multiple indicators"""
        if df.empty or len(df) < 30:  # Need enough data for indicators
            return None
            
        # Get latest values
        fast_ema = df['ema_fast'].iloc[-1]
        slow_ema = df['ema_slow'].iloc[-1]
        fast_ema_prev = df['ema_fast'].iloc[-2]
        macd_hist = df['histogram'].iloc[-1]
        rsi = df['rsi'].iloc[-1]
        price = df['close'].iloc[-1]
        bb_upper = df['bb_upper'].iloc[-1]
        bb_lower = df['bb_lower'].iloc[-1]
        
        # Buy signal conditions
        if trend_direction == "BUY":
            # 1. Moving Average crossover
            ma_signal = fast_ema > slow_ema and fast_ema_prev <= slow_ema
            
            # 2. RSI conditions
            rsi_signal = rsi < RSI_OVERSOLD or (rsi > RSI_BULLISH and rsi < RSI_OVERBOUGHT)
            
            # 3. Bollinger Bands
            bb_signal = price <= bb_lower
            
            # 4. MACD
            macd_signal = macd_hist > 0 and df['histogram'].iloc[-2] < macd_hist
            
            # Combined signal
            if (ma_signal or bb_signal) and rsi_signal and macd_signal:
                return "BUY"
                
        # Sell signal conditions
        elif trend_direction == "SELL":
            # 1. Moving Average crossover
            ma_signal = fast_ema < slow_ema and fast_ema_prev >= slow_ema
            
            # 2. RSI conditions
            rsi_signal = rsi > RSI_OVERBOUGHT or (rsi < RSI_BEARISH and rsi > RSI_OVERSOLD)
            
            # 3. Bollinger Bands
            bb_signal = price >= bb_upper
            
            # 4. MACD
            macd_signal = macd_hist < 0 and df['histogram'].iloc[-2] > macd_hist
            
            # Combined signal
            if (ma_signal or bb_signal) and rsi_signal and macd_signal:
                return "SELL"
                
        return None
    
    def update_position(self, symbol, status):
        """Update position tracking"""
        if status == "closed":
            self.positions[symbol] = None
        else:
            self.positions[symbol] = status