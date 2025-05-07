// bot-ig.js
require('dotenv').config();
const axios = require('axios');
const moment = require('moment-timezone');
const ort = require('onnxruntime-node');
const { EMA, RSI, BollingerBands, MACD, Stochastic } = require('technicalindicators');

// ————— Configuration —————
const BASE_URL   = 'https://demo-api.ig.com/gateway/deal'; // Demo-Endpoint

const INSTRUMENTS = [
  'CS.D.EURUSD.CFD.IP',
  'CS.D.GBPUSD.CFD.IP',
  'CS.D.USDJPY.CFD.IP',
  'CS.D.AUDUSD.CFD.IP',
  'CS.D.USDCAD.CFD.IP'
];

const MAX_TRADES   = 5;
const RISK_PERCENT = 0.02;          // 2% per trade
const MODEL_PATH   = './model.onnx';
const TIMEZONE     = 'Europe/Berlin';

// Axios instance for API calls
const api = axios.create({
  baseURL: BASE_URL,
  headers: {
    'X-IG-API-KEY': process.env.API_KEY,
    'Content-Type': 'application/json',
    'Accept': 'application/json; charset=UTF-8',
    'Version': '2'
  }
});

// ————— 1. Build Session —————
// Authentication via POST /session v1/v2 → CST + X-SECURITY-TOKEN in header :contentReference[oaicite:0]{index=0}
async function login() {
  const resp = await api.post('/session', {
    identifier: process.env.USERNAME,
    password: process.env.PASSWORD,
    encryptedPassword: false
  });
  const cst   = resp.headers['cst'];
  const token = resp.headers['x-security-token'];
  api.defaults.headers['CST'] = cst;
  api.defaults.headers['X-SECURITY-TOKEN'] = token;
  console.log('✅ Logged in, Session token received');
}

// ————— 2. Get Account Balance —————
async function getBalance() {
  const resp = await api.get(`/accounts/${process.env.ACCOUNT_ID}/balance`);
  return parseFloat(resp.data.balance.balanceAvailable);
}

// ————— 3. Get Historical Candles —————
// /prices/{epic}/{resolution}/{startDate}/{endDate} for M1, M15, H1 etc. :contentReference[oaicite:1]{index=1}
async function getHistory(epic, resolution, start, end) {
  const from = start.format('YYYY-MM-DD HH:mm:ss');
  const to   = end.format('YYYY-MM-DD HH:mm:ss');
  const resp = await api.get(`/prices/${epic}/${resolution}/${from}/${to}`);
  return resp.data.prices.map(p => ({
    time: p.snapshotTime,
    mid: { o: p.openPrice, h: p.highPrice, l: p.lowPrice, c: p.closePrice }
  }));
}

// ————— 4. Calculate Indicators —————
function calcIndicators(candles) {
  const closes = candles.map(c => parseFloat(c.mid.c));
  const ema5    = EMA.calculate({ period: 5, values: closes }).pop();
  const ema20   = EMA.calculate({ period: 20, values: closes }).pop();
  const rsi     = RSI.calculate({ period: 14, values: closes }).pop();
  const bb      = BollingerBands.calculate({ period: 20, stdDev: 2, values: closes }).pop();
  const macdArr = MACD.calculate({ fastPeriod:12, slowPeriod:26, signalPeriod:9, values:closes });
  const macd    = macdArr.length ? macdArr.pop().MACD : null;
  const macdSig = macdArr.length ? macdArr.pop().signal : null;
  const stArr   = Stochastic.calculate({ period:14, signalPeriod:3, values:closes });
  const stochK  = stArr.length ? stArr.pop().k : null;
  const stochD  = stArr.length ? stArr.pop().d : null;
  return { ema5, ema20, rsi, bb, macd, macdSig, stochK, stochD };
}

// ————— 5. Calculate Position Size —————
function calcUnits(balance, riskPercent, stopPips, pipSize) {
  const riskAmt = balance * riskPercent;
  return Math.floor(riskAmt / (stopPips * pipSize));
}

// ————— 6. Load & Infer ONNX Model —————
let session;
async function loadModel() {
  session = await ort.InferenceSession.create(MODEL_PATH);
  console.log('✅ ONNX model loaded');
}
async function modelSignal(feat) {
  const tensor = new ort.Tensor('float32', Float32Array.from(feat), [1, feat.length]);
  const out = await session.run({ input: tensor });
  return out.output.data[0]; // e.g. >0.5 ⇒ Buy, <0.5 ⇒ Sell
}

// ————— 7. Place Order —————
async function placeOrder(epic, direction, size, slDistance, tpDistance) {
  const order = {
    epic,
    expiry: '-',
    direction,
    size: size.toString(),
    orderType: 'MARKET',
    timeInForce: 'FILL_OR_KILL',
    forceOpen: true,
    stopDistance: slDistance.toString(),
    limitDistance: tpDistance.toString()
  };
  try {
    const res = await api.post('/positions/otc', order);
    console.log(`→ Order ${direction} ${epic}:`, res.data.dealReference);
  } catch (e) {
    console.error(`✖ Order error ${epic}:`, e.response?.data || e.message);
  }
}

// ————— 8. Main Loop (every minute) —————
async function mainLoop() {
  const now = moment().tz(TIMEZONE);
  // Trade only during London/NY Session (09-18 CET)
  if (now.hour() < 9 || now.hour() > 18) {
    console.log(`⏸ Outside trading hours: ${now.format()}`);
    return;
  }
  const balance = await getBalance();
  // Count open trades
  const open = await api.get(`/positions`).then(r => r.data.positions.length);
  if (open >= MAX_TRADES) {
    console.log(`🔒 Max trades (${open}) reached`);
    return;
  }

  for (const epic of INSTRUMENTS) {
    if (open >= MAX_TRADES) break;
    // Get M1 candles from last 30 min
    const end   = now.clone();
    const start = now.clone().subtract(30, 'minutes');
    const candles = await getHistory(epic, 'MINUTE', start, end);
    if (!candles.length) continue;

    const ind = calcIndicators(candles);
    console.log(`${epic} | EMA5=${ind.ema5.toFixed(5)} EMA20=${ind.ema20.toFixed(5)} RSI=${ind.rsi.toFixed(1)}`);

    // Signal logic: EMA Crossover + RSI Filter
    let signal = 0;
    if (ind.ema5 > ind.ema20 && ind.rsi < 70) signal = 1;
    if (ind.ema5 < ind.ema20 && ind.rsi > 30) signal = -1;

    // ONNX Model as Filter
    const feat = [ind.rsi, ind.macd||0, ind.macdSig||0, ind.stochK||0, ind.stochD||0];
    const ai   = await modelSignal(feat);
    signal *= ai > 0.5 ? 1 : -1;
    console.log(`  AI Signal: ${ai.toFixed(2)} → ${signal>0?'BUY':'SELL'}`);

    if (signal === 0) continue;

    // Order Parameters
    const direction   = signal>0 ? 'BUY' : 'SELL';
    const pipSize     = epic.endsWith('.JPY.IP') ? 0.01 : 0.0001;
    const stopPips    = 10;
    const tpPips      = stopPips*2;
    const units       = calcUnits(balance, RISK_PERCENT, stopPips, pipSize);
    if (units <= 0) continue;

    await placeOrder(epic, direction, units, stopPips, tpPips);
    open++;
  }
}

// ————— 9. Start Bot —————
const igClient = require('./api/igClient');
const AIModel = require('./models/aiModel');
const trader = require('./trading/trader');

(async () => {
    await igClient.login();
    await AIModel.load();
    console.log('🚀 Starting main loop...');
    trader.mainLoop();
    setInterval(() => trader.mainLoop(), 60*1000);
})();
