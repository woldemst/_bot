
// ai-indicator.js
const fs = require('fs');
const { calculateEMA, calculateRSI, calculateMACD } = require('./indicators');

// Load the AI model exported from Python
const loadAIModel = () => {
  try {
    const modelData = JSON.parse(fs.readFileSync('ai_model_js.json', 'utf8'));
    const modelParams = JSON.parse(fs.readFileSync('model_params.json', 'utf8'));
    return { modelData, modelParams };
  } catch (error) {
    console.error('Error loading AI model:', error);
    return null;
  }
};

// Calculate features for the model (same as in Python)
const calculateFeatures = (candles) => {
  if (candles.length < 30) return null; // Need enough data for features
  
  const closes = candles.map(c => c.close);
  
  // Calculate the same features used in the Python model
  const features = {};
  
  // EMA features
  features.ema_8 = calculateEMA(closes, 8);
  features.ema_21 = calculateEMA(closes, 21);
  
  // RSI
  features.rsi = calculateRSI(closes, 14);
  
  // MACD
  const macd = calculateMACD(closes, 12, 26, 9);
  features.macd_line = macd.macdLine;
  features.macd_signal = macd.signalLine;
  features.macd_histogram = macd.histogram;
  
  // Price changes (percent change over different periods)
  for (let i = 1; i <= 10; i++) {
    if (closes.length > i) {
      features[`close_change_${i}`] = (closes[closes.length - 1] - closes[closes.length - 1 - i]) / closes[closes.length - 1 - i];
    } else {
      features[`close_change_${i}`] = 0;
    }
  }
  
  return features;
};

// Normalize features similar to StandardScaler in Python
const normalizeFeatures = (features, model) => {
  if (!model || !model.modelParams || !model.modelParams.features) return features;
  
  // Simple normalization - in a real implementation you would use means and standard deviations from the model
  const normalizedFeatures = {};
  for (const feature of model.modelParams.features) {
    if (features[feature] !== undefined) {
      // Simple Z-score normalization (this is a simplification)
      normalizedFeatures[feature] = features[feature];
    }
  }
  
  return normalizedFeatures;
};

// Get trading signal from AI model
const getAISignal = (candles, symbol) => {
  const model = loadAIModel();
  if (!model) return null;
  
  const features = calculateFeatures(candles);
  if (!features) return null;
  
  const normalizedFeatures = normalizeFeatures(features, model);
  
  // Simple prediction using feature importance
  // In a real implementation, you would implement the actual decision tree logic
  let score = 0;
  model.modelData.features.forEach((feature, i) => {
    if (normalizedFeatures[feature] !== undefined) {
      // Weight the feature by its importance
      score += normalizedFeatures[feature] * model.modelData.importance[i];
    }
  });
  
  // Apply threshold
  if (score > model.modelData.threshold) {
    return { 
      signal: "BUY", 
      confidence: Math.min(Math.abs(score), 1),
      entry: candles[candles.length - 1].close,
      stopLoss: candles[candles.length - 1].close - (model.modelParams.stop_pips * model.modelParams.pip_multiplier),
      takeProfit: candles[candles.length - 1].close + (model.modelParams.target_pips * model.modelParams.pip_multiplier)
    };
  } else if (score < -model.modelData.threshold) {
    return { 
      signal: "SELL", 
      confidence: Math.min(Math.abs(score), 1),
      entry: candles[candles.length - 1].close,
      stopLoss: candles[candles.length - 1].close + (model.modelParams.stop_pips * model.modelParams.pip_multiplier),
      takeProfit: candles[candles.length - 1].close - (model.modelParams.target_pips * model.modelParams.pip_multiplier)
    };
  }
  
  return { signal: "NEUTRAL", confidence: Math.abs(score) };
};

module.exports = { getAISignal };