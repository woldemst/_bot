import os
from dotenv import load_dotenv
import logging

# Load environment variables
load_dotenv()

# Connection settings
IB_ACCOUNT = os.getenv("IB_ACCOUNT")
IB_PASSWORD = os.getenv("IB_PASSWORD")
IB_HOST = os.getenv("IB_HOST", "127.0.0.1")
PORT = int(os.getenv("PORT", "4002"))

# Trading parameters
SYMBOLS = ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "EURGBP"]
MAX_OPEN = 5
RISK_PER_TRADE = 0.01  # 1% per Trade
FAST_EMA = 5
SLOW_EMA = 20

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[logging.FileHandler("trading_bot.log"), logging.StreamHandler()],
)
logger = logging.getLogger(__name__)