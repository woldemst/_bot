import os
from dotenv import load_dotenv
import logging

# Load environment variables
load_dotenv()

# Connection settings
IB_ACCOUNT = os.getenv("IB_ACCOUNT")
IB_PASSWORD = os.getenv("IB_PASSWORD")
IB_HOST = os.getenv("IB_HOST", "127.0.0.1")
PORT = int(os.getenv("PORT", "7496"))  # Updated to match your TWS port

# Trading parameters
SYMBOLS = ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD"]
# Updated trading parameters
MAX_OPEN = 3
LEVERAGE = 30  # 1:30 leverage
MICRO_LOT = 0.01
RSI_BUY_THRESHOLD = 30
RSI_SELL_THRESHOLD = 70
PROFIT_THRESHOLD = 0.05  # 5% profit for leverage increase
LEVERAGE_INCREASE = 0.5  # 50% increase
TRAILING_STOP_START = 0.5  # 50% of take profit
RISK_PER_TRADE = 0.02  # 2% per Trade
FAST_EMA = 5
SLOW_EMA = 20

# RSI parameters
RSI_PERIOD = 14
RSI_OVERBOUGHT = 70
RSI_OVERSOLD = 30
RSI_BULLISH = 50  # Above 50 for bullish
RSI_BEARISH = 50  # Below 50 for bearish

# Bollinger Bands parameters
BB_PERIOD = 20
BB_STD_DEV = 2

# Timeframes for analysis
TIMEFRAMES = {
    "M1": "1 min",
    "M15": "15 mins",
    "H1": "1 hour",
    "H4": "4 hours",
    "D1": "1 day"
}

# Trailing stop parameters
TRAILING_STOP_START = 0.5  # Start trailing at 50% of take profit
TRAILING_STOP_STEP = 10  # 10 pips for EUR/USD

# Leverage settings
INITIAL_LEVERAGE = 5  # Start with 1:5 leverage
PROFIT_THRESHOLD = 0.05  # 5% profit
LEVERAGE_INCREASE = 0.5  # Increase by 50% when threshold reached

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[logging.FileHandler("trading_bot.log"), logging.StreamHandler()],
)
logger = logging.getLogger(__name__)