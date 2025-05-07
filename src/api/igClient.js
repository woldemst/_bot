const axios = require('axios');
const { BASE_URL } = require('../config/constants');

class IGClient {
    constructor() {
        this.api = axios.create({
            baseURL: BASE_URL,
            headers: {
                'X-IG-API-KEY': process.env.API_KEY,
                'Content-Type': 'application/json',
                'Accept': 'application/json; charset=UTF-8',
                'Version': '2'
            }
        });
    }

    async login() {
        const resp = await this.api.post('/session', {
            identifier: process.env.USERNAME,
            password: process.env.PASSWORD,
            encryptedPassword: false
        });
        this.api.defaults.headers['CST'] = resp.headers['cst'];
        this.api.defaults.headers['X-SECURITY-TOKEN'] = resp.headers['x-security-token'];
        console.log('✅ Logged in, Session token received');
    }

    async getBalance() {
        const resp = await this.api.get(`/accounts/${process.env.ACCOUNT_ID}/balance`);
        return parseFloat(resp.data.balance.balanceAvailable);
    }

    async getHistory(epic, resolution, start, end) {
        const from = start.format('YYYY-MM-DD HH:mm:ss');
        const to = end.format('YYYY-MM-DD HH:mm:ss');
        const resp = await this.api.get(`/prices/${epic}/${resolution}/${from}/${to}`);
        return resp.data.prices.map(p => ({
            time: p.snapshotTime,
            mid: { o: p.openPrice, h: p.highPrice, l: p.lowPrice, c: p.closePrice }
        }));
    }

    async getOpenPositions() {
        const resp = await this.api.get('/positions');
        return resp.data.positions.length;
    }

    async placeOrder(epic, direction, size, slDistance, tpDistance) {
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
            const res = await this.api.post('/positions/otc', order);
            console.log(`→ Order ${direction} ${epic}:`, res.data.dealReference);
        } catch (e) {
            console.error(`✖ Order error ${epic}:`, e.response?.data || e.message);
        }
    }
}

module.exports = new IGClient();