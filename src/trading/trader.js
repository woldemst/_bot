const moment = require('moment-timezone');
const { TIMEZONE, INSTRUMENTS, MAX_TRADES, RISK_PERCENT } = require('../config/constants');
const igClient = require('../api/igClient');
const TechnicalIndicators = require('../indicators/technical');
const AIModel = require('../models/aiModel');
const PositionSizer = require('./positionSizer');

class Trader {
    async checkTradeConditions() {
        const now = moment().tz(TIMEZONE);
        if (now.hour() < 9 || now.hour() > 18) {
            console.log(`⏸ Outside trading hours: ${now.format()}`);
            return false;
        }
        
        const openPositions = await igClient.getOpenPositions();
        if (openPositions >= MAX_TRADES) {
            console.log(`🔒 Max trades (${openPositions}) reached`);
            return false;
        }
        
        return true;
    }

    async analyzeMarket(epic) {
        const now = moment().tz(TIMEZONE);
        const end = now.clone();
        const start = now.clone().subtract(30, 'minutes');
        const candles = await igClient.getHistory(epic, 'MINUTE', start, end);
        
        if (!candles.length) return null;

        const indicators = TechnicalIndicators.calculate(candles);
        console.log(`${epic} | EMA5=${indicators.ema5.toFixed(5)} EMA20=${indicators.ema20.toFixed(5)} RSI=${indicators.rsi.toFixed(1)}`);

        return indicators;
    }

    determineSignal(indicators) {
        let signal = 0;
        if (indicators.ema5 > indicators.ema20 && indicators.rsi < 70) signal = 1;
        if (indicators.ema5 < indicators.ema20 && indicators.rsi > 30) signal = -1;
        return signal;
    }

    async mainLoop() {
        if (!await this.checkTradeConditions()) return;

        const balance = await igClient.getBalance();
        let openTrades = await igClient.getOpenPositions();

        for (const epic of INSTRUMENTS) {
            if (openTrades >= MAX_TRADES) break;

            const indicators = await this.analyzeMarket(epic);
            if (!indicators) continue;

            let signal = this.determineSignal(indicators);
            
            const features = [
                indicators.rsi, 
                indicators.macd || 0, 
                indicators.macdSig || 0, 
                indicators.stochK || 0, 
                indicators.stochD || 0
            ];
            
            const aiSignal = await AIModel.predict(features);
            signal *= aiSignal > 0.5 ? 1 : -1;
            console.log(`  AI Signal: ${aiSignal.toFixed(2)} → ${signal>0?'BUY':'SELL'}`);

            if (signal === 0) continue;

            const direction = signal > 0 ? 'BUY' : 'SELL';
            const pipSize = epic.endsWith('.JPY.IP') ? 0.01 : 0.0001;
            const stopPips = 10;
            const tpPips = stopPips * 2;
            const units = PositionSizer.calculateUnits(balance, RISK_PERCENT, stopPips, pipSize);
            
            if (units <= 0) continue;

            await igClient.placeOrder(epic, direction, units, stopPips, tpPips);
            openTrades++;
        }
    }
}

module.exports = new Trader();