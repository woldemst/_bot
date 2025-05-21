import pandas as pd
from ibapi.contract import Contract
from ibapi.order import Order
from config import (
    logger, RISK_PER_TRADE, TRAILING_STOP_START, 
    TRAILING_STOP_STEP, INITIAL_LEVERAGE
)

class OrderManager:
    def __init__(self, client):
        self.client = client
        self.open_orders = 0
        self.positions = {}  # Track positions by symbol
        self.order_ids = {}  # Track order IDs by symbol
    
    def place_order(self, sym, direction, price):
        """Place an order with stop loss and take profit"""
        try:
            # Check if we already have a position for this symbol
            if sym in self.positions and self.positions[sym]:
                logger.info(f"Already have a position for {sym}, skipping")
                return
                
            # Position sizing: Risk 2% of account
            sl_pips = self._calculate_stop_loss_pips(sym)
            tp_pips = sl_pips * 2  # 2:1 reward-to-risk ratio
            
            # Calculate stop loss distance based on currency pair
            is_jpy_pair = "JPY" in sym
            pip_multiplier = 0.01 if is_jpy_pair else 0.0001
            sl_dist = sl_pips * pip_multiplier
            tp_dist = tp_pips * pip_multiplier
            
            # Get account value for position sizing
            if self.client.accountValue[0] is None or self.client.accountValue[1] is None:
                logger.warning("Account value not available, using default position size")
                account_value = 1000  # Default account value
            else:
                account_value = float(self.client.accountValue[1])
            
            # Calculate risk amount
            risk_amount = account_value * RISK_PER_TRADE
            
            # Leverage increase on profit
            profit_threshold = getattr(self.client, "profit_threshold", 0.05)
            leverage = INITIAL_LEVERAGE
            if hasattr(self.client, "starting_equity") and account_value > self.client.starting_equity * (1 + profit_threshold):
                leverage = int(INITIAL_LEVERAGE * 1.5)  # Increase leverage by 50% when profitable
            
            symbol_multiplier = 100 if is_jpy_pair else 10000
            qty = max(1, int((risk_amount * leverage) / (sl_dist * symbol_multiplier)))
            
            # Create contract
            contract = self._create_contract(sym)
            
            # Create orders
            main_order, parent_id = self._create_main_order(direction, qty)
            sl_order = self._create_stop_loss_order(direction, qty, price, sl_dist, parent_id)
            tp_order = self._create_take_profit_order(direction, qty, price, tp_dist, parent_id)
            
            # Calculate SL and TP prices
            sl_price = price - sl_dist if direction == "BUY" else price + sl_dist
            tp_price = price + tp_dist if direction == "BUY" else price - tp_dist
            
            # Place orders
            self.client.placeOrder(parent_id, contract, main_order)
            self.client.placeOrder(sl_order.orderId, contract, sl_order)
            self.client.placeOrder(tp_order.orderId, contract, tp_order)
            
            # Track this position
            self.positions[sym] = {
                "direction": direction,
                "entry_price": price,
                "stop_loss": sl_price,
                "take_profit": tp_price,
                "quantity": qty,
                "parent_id": parent_id,
                "sl_order_id": sl_order.orderId,
                "tp_order_id": tp_order.orderId,
                "trailing_active": False
            }
            
            # Track order IDs
            self.order_ids[parent_id] = sym
            self.order_ids[sl_order.orderId] = sym
            self.order_ids[tp_order.orderId] = sym
            
            logger.info(f"{direction} {sym} QTY={qty} @ {price:.5f}, SL={sl_price:.5f}, TP={tp_price:.5f}")
            self.open_orders += 1
            
        except Exception as e:
            logger.error(f"Error placing order: {str(e)}")
    
    def _calculate_stop_loss_pips(self, symbol):
        """Calculate dynamic stop loss based on volatility"""
        try:
            # Get H1 data for volatility calculation
            df = self.client.data_handler.get_data(symbol, "H1")
            if df.empty or len(df) < 20:
                return 10  # Default if not enough data
                
            # Calculate Average True Range (ATR)
            high = df['high'].astype(float)
            low = df['low'].astype(float)
            close = df['close'].astype(float)
            
            tr1 = high - low
            tr2 = abs(high - close.shift())
            tr3 = abs(low - close.shift())
            
            tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
            atr = tr.rolling(14).mean().iloc[-1]
            
            # Convert ATR to pips
            is_jpy_pair = "JPY" in symbol
            pip_multiplier = 100 if is_jpy_pair else 10000
            atr_pips = atr * pip_multiplier
            
            # Set stop loss to 1.5x ATR with min/max bounds
            sl_pips = max(10, min(50, int(atr_pips * 1.5)))
            return sl_pips
            
        except Exception as e:
            logger.error(f"Error calculating stop loss: {str(e)}")
            return 10  # Default value
    
    def _create_contract(self, sym):
        """Create a contract for the given symbol"""
        contract = Contract()
        contract.symbol = sym[:3]
        contract.secType = "CASH"
        contract.currency = sym[3:]
        contract.exchange = "IDEALPRO"
        return contract
    
    def _create_main_order(self, direction, qty):
        """Create the main order"""
        main_order = Order()
        main_order.orderType = "MKT"
        main_order.totalQuantity = qty
        main_order.action = direction
        main_order.transmit = False  # Don't transmit until we've attached SL/TP
        main_order.orderId = self.client.nextOrderId
        parent_id = self.client.nextOrderId
        self.client.nextOrderId += 1
        return main_order, parent_id
    
    def _create_stop_loss_order(self, direction, qty, price, sl_dist, parent_id):
        """Create a stop loss order"""
        sl_price = price - sl_dist if direction == "BUY" else price + sl_dist
        
        sl_order = Order()
        sl_order.orderType = "STP"
        sl_order.totalQuantity = qty
        sl_order.action = "SELL" if direction == "BUY" else "BUY"
        sl_order.auxPrice = round(sl_price, 5)
        sl_order.parentId = parent_id
        sl_order.transmit = False
        sl_order.orderId = self.client.nextOrderId
        self.client.nextOrderId += 1
        
        return sl_order
    
    def _create_take_profit_order(self, direction, qty, price, tp_dist, parent_id):
        """Create a take profit order"""
        tp_price = price + tp_dist if direction == "BUY" else price - tp_dist
        
        tp_order = Order()
        tp_order.orderType = "LMT"
        tp_order.totalQuantity = qty
        tp_order.action = "SELL" if direction == "BUY" else "BUY"
        tp_order.lmtPrice = round(tp_price, 5)
        tp_order.parentId = parent_id
        tp_order.transmit = True  # This will transmit all orders
        tp_order.orderId = self.client.nextOrderId
        self.client.nextOrderId += 1
        
        return tp_order
    
    def update_order_status(self, orderId, status, filled, remaining, avgFillPrice, parentId):
        """Update order status and manage trailing stops"""
        try:
            # Find which symbol this order belongs to
            sym = self._get_symbol_for_order(orderId, parentId)
            if not sym:
                return
                
            # Update position tracking
            if status == "Filled":
                if parentId == 0:  # This is a parent order
                    logger.info(f"Main order for {sym} filled at {avgFillPrice}")
                    
                    # Update position with actual fill price
                    if sym in self.positions:
                        self.positions[sym]["entry_price"] = avgFillPrice
                        
                elif sym in self.positions:
                    # Check if this is a SL or TP order
                    if orderId == self.positions[sym]["sl_order_id"]:
                        logger.info(f"Stop loss for {sym} triggered")
                        self.positions[sym] = None
                        self.open_orders -= 1
                        # Notify strategy that position is closed
                        self.client.strategy.update_position(sym, "closed")
                        
                    elif orderId == self.positions[sym]["tp_order_id"]:
                        logger.info(f"Take profit for {sym} reached")
                        self.positions[sym] = None
                        self.open_orders -= 1
                        # Notify strategy that position is closed
                        self.client.strategy.update_position(sym, "closed")
            
            # Handle cancelled orders
            elif status == "Cancelled":
                if sym in self.positions and (
                    orderId == self.positions[sym]["parent_id"] or
                    orderId == self.positions[sym]["sl_order_id"] or
                    orderId == self.positions[sym]["tp_order_id"]
                ):
                    logger.info(f"Order for {sym} cancelled")
                    self.positions[sym] = None
                    self.open_orders -= 1
                    # Notify strategy that position is closed
                    self.client.strategy.update_position(sym, "closed")
                    
        except Exception as e:
            logger.error(f"Error updating order status: {str(e)}")
    
    def _get_symbol_for_order(self, orderId, parentId):
        """Find which symbol an order belongs to"""
        # First check direct mapping
        if orderId in self.order_ids:
            return self.order_ids[orderId]
            
        # Then check parent ID
        if parentId in self.order_ids:
            return self.order_ids[parentId]
            
        # If not found, check all positions
        for sym, pos in self.positions.items():
            if pos and (
                pos["parent_id"] == orderId or 
                pos["parent_id"] == parentId or
                pos["sl_order_id"] == orderId or
                pos["tp_order_id"] == orderId
            ):
                return sym
                
        return None
    
    def check_trailing_stops(self):
        """Check and update trailing stops for all positions"""
        for sym, pos in self.positions.items():
            if not pos or pos["trailing_active"]:
                continue
                
            # Get current price
            current_price = self._get_current_price(sym)
            if not current_price:
                continue
                
            # Calculate profit in pips
            is_jpy_pair = "JPY" in sym
            pip_multiplier = 0.01 if is_jpy_pair else 0.0001
            
            if pos["direction"] == "BUY":
                profit_dist = current_price - pos["entry_price"]
            else:
                profit_dist = pos["entry_price"] - current_price
                
            profit_pips = profit_dist / pip_multiplier
            
            # Calculate take profit distance
            tp_dist = abs(pos["take_profit"] - pos["entry_price"]) / pip_multiplier
            
            # Check if we've reached trailing stop activation point
            if profit_pips >= (tp_dist * TRAILING_STOP_START):
                # Calculate new stop loss level
                trailing_pips = TRAILING_STOP_STEP
                
                if pos["direction"] == "BUY":
                    new_sl = current_price - (trailing_pips * pip_multiplier)
                    # Only move stop loss up
                    if new_sl > pos["stop_loss"]:
                        self._modify_stop_loss(sym, pos, new_sl)
                else:
                    new_sl = current_price + (trailing_pips * pip_multiplier)
                    # Only move stop loss down
                    if new_sl < pos["stop_loss"]:
                        self._modify_stop_loss(sym, pos, new_sl)
                
                # Mark trailing as active
                pos["trailing_active"] = True
    
    def _get_current_price(self, symbol):
        """Get current price for a symbol"""
        try:
            df = self.client.data_handler.get_data(symbol, "M1")
            if df.empty:
                return None
            return df["close"].iloc[-1]
        except Exception as e:
            logger.error(f"Error getting current price: {str(e)}")
            return None
    
    def _modify_stop_loss(self, symbol, position, new_sl_price):
        """Modify stop loss order"""
        try:
            # Cancel existing stop loss
            self.client.cancelOrder(position["sl_order_id"])
            
            # Create new stop loss order
            contract = self._create_contract(symbol)
            
            sl_order = Order()
            sl_order.orderType = "STP"
            sl_order.totalQuantity = position["quantity"]
            sl_order.action = "SELL" if position["direction"] == "BUY" else "BUY"
            sl_order.auxPrice = round(new_sl_price, 5)
            sl_order.parentId = position["parent_id"]
            sl_order.transmit = True
            sl_order.orderId = self.client.nextOrderId
            
            # Update tracking
            old_sl_id = position["sl_order_id"]
            position["sl_order_id"] = sl_order.orderId
            position["stop_loss"] = new_sl_price
            
            # Remove old order ID from tracking
            if old_sl_id in self.order_ids:
                del self.order_ids[old_sl_id]
                
            # Add new order ID to tracking
            self.order_ids[sl_order.orderId] = symbol
            
            # Place new stop loss
            self.client.placeOrder(sl_order.orderId, contract, sl_order)
            
            logger.info(f"Updated trailing stop for {symbol} to {new_sl_price:.5f}")
            
        except Exception as e:
            logger.error(f"Error modifying stop loss: {str(e)}")
