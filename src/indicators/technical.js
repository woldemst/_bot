const { EMA, RSI, BollingerBands, MACD, Stochastic } = require('technicalindicators');

class TechnicalIndicators {
    static calculate(candles) {
        const closes = candles.map(c => parseFloat(c.mid.c));
        const ema5 = EMA.calculate({ period: 5, values: closes }).pop();
        const ema20 = EMA.calculate({ period: 20, values: closes }).pop();
        const rsi = RSI.calculate({ period: 14, values: closes }).pop();
        const bb = BollingerBands.calculate({ period: 20, stdDev: 2, values: closes }).pop();
        const macdArr = MACD.calculate({ fastPeriod:12, slowPeriod:26, signalPeriod:9, values:closes });
        const macd = macdArr.length ? macdArr.pop().MACD : null;
        const macdSig = macdArr.length ? macdArr.pop().signal : null;
        const stArr = Stochastic.calculate({ period:14, signalPeriod:3, values:closes });
        const stochK = stArr.length ? stArr.pop().k : null;
        const stochD = stArr.length ? stArr.pop().d : null;
        
        return { ema5, ema20, rsi, bb, macd, macdSig, stochK, stochD };
    }
}

module.exports = TechnicalIndicators;