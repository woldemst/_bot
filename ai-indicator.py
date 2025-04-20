import pandas as pd
import numpy as np
import joblib
from sklearn.preprocessing import StandardScaler
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
import matplotlib.pyplot as plt
import json
import os

# Configuration
CONFIG = {
    "symbols": ["EURUSD", "GBPUSD", "AUDUSD", "EURGBP"],
    "timeframes": [1, 15, 60],  # M1, M15, H1
    "features": {
        "ema_periods": [8, 21],
        "rsi_period": 14,
        "macd_params": {"fast": 12, "slow": 26, "signal": 9},
        "lookback_periods": 10  # How many candles to look back for features
    },
    "target_pips": 10,  # Target profit in pips
    "stop_pips": 5,     # Stop loss in pips
    "training_data_days": 60,  # Days of data to use for training
    "model_path": "ai_model.joblib",
    "model_params_path": "model_params.json"
}

# Technical indicators
def calculate_ema(prices, period):
    return pd.Series(prices).ewm(span=period, adjust=False).mean().values

def calculate_rsi(prices, period=14):
    delta = pd.Series(prices).diff()
    gain = delta.where(delta > 0, 0)
    loss = -delta.where(delta < 0, 0)
    
    avg_gain = gain.rolling(window=period).mean()
    avg_loss = loss.rolling(window=period).mean()
    
    rs = avg_gain / avg_loss
    rsi = 100 - (100 / (1 + rs))
    return rsi.values

def calculate_macd(prices, fast_period=12, slow_period=26, signal_period=9):
    ema_fast = pd.Series(prices).ewm(span=fast_period, adjust=False).mean()
    ema_slow = pd.Series(prices).ewm(span=slow_period, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal_period, adjust=False).mean()
    histogram = macd_line - signal_line
    return macd_line.values, signal_line.values, histogram.values

# Load historical data
def load_historical_data(symbol, timeframe, days=60):
    """
    This function should load historical data from your data source.
    For now, we'll create a placeholder that loads from a CSV or creates dummy data.
    """
    # Check if we have saved data
    filename = f"data/{symbol}_{timeframe}_{days}days.csv"
    
    if os.path.exists(filename):
        print(f"Loading data from {filename}")
        return pd.read_csv(filename)
    
    # If no saved data, create dummy data for testing
    print(f"Creating dummy data for {symbol} {timeframe}")
    periods = int((days * 24 * 60) / timeframe)  # Approximate number of candles
    
    # Create dummy price data with some trend and noise
    np.random.seed(42)  # For reproducibility
    base_price = 1.0 if symbol.startswith("EUR") else (0.8 if symbol.startswith("GBP") else 0.7)
    trend = np.linspace(0, 0.1, periods)  # Small uptrend
    noise = np.random.normal(0, 0.001, periods)  # Small noise
    
    closes = base_price + trend + noise
    highs = closes + np.random.uniform(0, 0.002, periods)
    lows = closes - np.random.uniform(0, 0.002, periods)
    opens = closes - np.random.uniform(-0.001, 0.001, periods)
    
    # Create timestamps
    end_time = pd.Timestamp.now()
    start_time = end_time - pd.Timedelta(days=days)
    timestamps = pd.date_range(start=start_time, end=end_time, periods=periods)
    
    # Create DataFrame
    df = pd.DataFrame({
        'timestamp': timestamps,
        'open': opens,
        'high': highs,
        'low': lows,
        'close': closes
    })
    
    # Ensure directory exists
    os.makedirs('data', exist_ok=True)
    
    # Save to CSV for future use
    df.to_csv(filename, index=False)
    
    return df

# Prepare features and target for ML model
def prepare_data(df, symbol):
    # Calculate technical indicators
    closes = df['close'].values
    
    # Calculate EMAs
    features = {}
    for period in CONFIG['features']['ema_periods']:
        features[f'ema_{period}'] = calculate_ema(closes, period)
    
    # Calculate RSI
    features['rsi'] = calculate_rsi(closes, CONFIG['features']['rsi_period'])
    
    # Calculate MACD
    macd_params = CONFIG['features']['macd_params']
    macd_line, signal_line, histogram = calculate_macd(
        closes, macd_params['fast'], macd_params['slow'], macd_params['signal']
    )
    features['macd_line'] = macd_line
    features['macd_signal'] = signal_line
    features['macd_histogram'] = histogram
    
    # Create feature DataFrame
    feature_df = pd.DataFrame(features)
    
    # Add price-based features
    lookback = CONFIG['features']['lookback_periods']
    for i in range(1, lookback + 1):
        feature_df[f'close_change_{i}'] = df['close'].pct_change(i).values
    
    # Calculate pip multiplier based on symbol
    pip_multiplier = 0.01 if 'JPY' in symbol else 0.0001
    
    # Create target: 1 if price goes up by target_pips, 0 if it goes down by stop_pips, -1 otherwise
    target = np.zeros(len(df))
    
    for i in range(len(df) - 1):
        future_high = df['high'].iloc[i+1:i+20].max() if i+20 < len(df) else df['high'].iloc[i+1:].max()
        future_low = df['low'].iloc[i+1:i+20].min() if i+20 < len(df) else df['low'].iloc[i+1:].min()
        
        # Check if target is hit (price goes up by target_pips)
        if future_high >= df['close'].iloc[i] + (CONFIG['target_pips'] * pip_multiplier):
            target[i] = 1  # Buy signal
        # Check if stop is hit (price goes down by stop_pips)
        elif future_low <= df['close'].iloc[i] - (CONFIG['stop_pips'] * pip_multiplier):
            target[i] = 0  # Sell signal
        else:
            target[i] = -1  # No trade
    
    # Combine features and target
    data = feature_df.copy()
    data['target'] = target
    
    # Drop NaN values (from indicators calculation)
    data = data.dropna()
    
    # Only keep rows with valid targets (1 or 0)
    data = data[data['target'] != -1]
    
    return data

# Train the model
def train_model(data):
    # Split features and target
    X = data.drop('target', axis=1)
    y = data['target']
    
    # Split into training and testing sets
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
    
    # Scale features
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_test_scaled = scaler.transform(X_test)
    
    # Train Random Forest model
    model = RandomForestClassifier(n_estimators=100, random_state=42)
    model.fit(X_train_scaled, y_train)
    
    # Evaluate model
    train_accuracy = model.score(X_train_scaled, y_train)
    test_accuracy = model.score(X_test_scaled, y_test)
    
    print(f"Training accuracy: {train_accuracy:.4f}")
    print(f"Testing accuracy: {test_accuracy:.4f}")
    
    # Feature importance
    feature_importance = pd.DataFrame({
        'feature': X.columns,
        'importance': model.feature_importances_
    }).sort_values('importance', ascending=False)
    
    print("\nFeature Importance:")
    print(feature_importance.head(10))
    
    # Save model and scaler
    joblib.dump((model, scaler), CONFIG['model_path'])
    
    # Save model parameters for JavaScript
    model_params = {
        'features': list(X.columns),
        'accuracy': test_accuracy,
        'pip_multiplier': 0.01 if any('JPY' in s for s in CONFIG['symbols']) else 0.0001,
        'target_pips': CONFIG['target_pips'],
        'stop_pips': CONFIG['stop_pips']
    }
    
    with open(CONFIG['model_params_path'], 'w') as f:
        json.dump(model_params, f, indent=2)
    
    return model, scaler, feature_importance

# Export model for JavaScript
def export_model_for_js(model, feature_importance):
    """
    Export a simplified version of the model for use in JavaScript.
    For a Random Forest, we'll export the most important decision trees.
    """
    # For simplicity, we'll just save the feature names and their importance
    # In a real implementation, you might want to export the actual decision trees
    export_data = {
        'features': feature_importance['feature'].tolist(),
        'importance': feature_importance['importance'].tolist(),
        'threshold': 0.5  # Decision threshold
    }
    
    with open('ai_model_js.json', 'w') as f:
        json.dump(export_data, f, indent=2)
    
    print("Model exported for JavaScript use.")

# Main function
def main():
    all_data = []
    
    # Load and prepare data for each symbol and timeframe
    for symbol in CONFIG['symbols']:
        for timeframe in CONFIG['timeframes']:
            print(f"\nProcessing {symbol} {timeframe}m data...")
            df = load_historical_data(symbol, timeframe, CONFIG['training_data_days'])
            prepared_data = prepare_data(df, symbol)
            
            # Add symbol and timeframe columns
            prepared_data['symbol'] = symbol
            prepared_data['timeframe'] = timeframe
            
            all_data.append(prepared_data)
    
    # Combine all data
    combined_data = pd.concat(all_data, ignore_index=True)
    print(f"\nCombined data shape: {combined_data.shape}")
    
    # Train model on combined data
    model, scaler, feature_importance = train_model(combined_data)
    
    # Export model for JavaScript
    export_model_for_js(model, feature_importance)
    
    print("\nAI indicator model training complete!")

if __name__ == "__main__":
    main()