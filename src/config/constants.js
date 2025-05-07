require('dotenv').config();

module.exports = {
    BASE_URL: 'https://demo-api.ig.com/gateway/deal',
    INSTRUMENTS: [
        'CS.D.EURUSD.CFD.IP',
        'CS.D.GBPUSD.CFD.IP',
        'CS.D.USDJPY.CFD.IP',
        'CS.D.AUDUSD.CFD.IP',
        'CS.D.USDCAD.CFD.IP'
    ],
    MAX_TRADES: 5,
    RISK_PERCENT: 0.02,
    MODEL_PATH: './model.onnx',
    TIMEZONE: 'Europe/Berlin'
};