const axios = require('axios');
const sleep = require('sleep-promise');
const crypto = require("crypto");
const fs = require("fs");

const main = async () => {
    const api_key_public = ""; // public api key
    const api_key_private = ""; // private api key

    // Configure market/orders/trades
    const trade_symbol = 'XXBTZUSD';
    const trade_interval = 1; // OHLC interval in minutes
    const trade_size = 0.0001; // trade volume in base currency
    const trade_leverage = 2;

    // Initial indicator/trade variables
    let trade_direction = 0;
    let sma_values = [0.0, 0.0, 0.0];
    let api_data = "";
    let make_trade = 0;
    let jsonData = "";

    try {
        while (true) {
            console.log("Retrieving OHLC data...");
            try {
                const baseDomain = "https://api.kraken.com";
                const publicPath = "/0/public/OHLC";
                const inputParameters = `pair=${trade_symbol}&interval=${trade_interval}`;
                const apiEndpointFullURL = `${baseDomain}${publicPath}?${inputParameters}`;
                await axios.get(apiEndpointFullURL)
                    .then((res) => {
                        jsonData = res;
                    })
                    .catch((error) => {
                        jsonData = error;
                    });
                api_data = jsonData.data;
            } catch (error) {
                console.log('Failed' + error);
            }

            if (jsonData.data.error.length == 0) {
                console.log("Done..");
            } else {
                console.log(api_data.error);
            }

            // Calculating SMA
            console.log('Calculating SMA 20...');
            let api_ohlc = api_data.result[trade_symbol];
            let api_ohlc_length = api_ohlc.length - 1;
            let sma_temp = 0.0;

            for (let count = 0; count < 20; count++) {
                sma_temp += parseFloat(api_ohlc[api_ohlc_length - count][4]);
            }
            sma_temp = sma_temp / 20;

            // Update SMA values
            sma_values[2] = sma_values[1];
            sma_values[1] = sma_values[0];
            sma_values[0] = sma_temp;

            console.log(sma_values[2]);
            console.log(sma_values[1]);
            console.log(sma_values[0]);

            if (sma_values[2] == 0) {
                console.log("Waiting " + trade_interval * 60 + ' seconds');
                await sleep(trade_interval * 60 * 1000);
                continue;
            } else {
                console.log("SMA 20 values...." + sma_values[2] + "/" + sma_values[1] + "/" + sma_values[0]);
            }

            // Trading Decision (Change in slope of SMA)
            console.log("Trading decision ......");
            if (sma_values[0] > sma_values[1] && sma_values[1] < sma_values[2]) {
                make_trade = 1;
                console.log("Long");
            } else if (sma_values[0] < sma_values[1] && sma_values[1] > sma_values[2]) {
                make_trade = -1;
                console.log("Short");
            } else {
                make_trade = 0;
                console.log("No Trade");
            }

            // Place Order
            if (make_trade != 0) {
                console.log('Placing Order/trade....');
                try {
                    const api_path = '/0/private/AddOrder';
                    const api_nonce = (Date.now() * 1000).toString();
                    const api_post = `nonce=${api_nonce}&pair=${trade_symbol}&type=${make_trade == 1 ? 'buy' : 'sell'}&ordertype=market&volume=${trade_direction == 0 ? trade_size : trade_size * 2}&leverage=${trade_leverage > 0 ? trade_leverage : 'none'}`;
                    const signature = CreateAuthenticationSignature(api_key_private, api_path, api_nonce, api_post);
                    const api_data = await QueryAddOrder(api_post, api_path, signature, api_key_public);
                    const final = api_data.error.length == 0 ? api_data.result : api_data.error;
                    console.log("Done");
                    console.log(final);
                } catch (err) {
                    console.log(err);
                }
            }

            // Wait until next OHLC interval
            console.log("Waiting " + trade_interval * 60 + ' seconds');
            await sleep(trade_interval * 60 * 1000);
        }
    } catch (err) {
        console.log(err);
    }
};

function CreateAuthenticationSignature(apiPrivateKey, api_path, nonce, apiPostBodyData) {
    const apiPost = nonce + apiPostBodyData;
    const secret = Buffer.from(apiPrivateKey, "base64");
    const sha256 = crypto.createHash("sha256");
    const hash256 = sha256.update(apiPost).digest("binary");
    const hmac512 = crypto.createHmac("sha512", secret);
    const signatureString = hmac512
        .update(api_path + hash256, "binary")
        .digest("base64");
    return signatureString;
}

async function QueryAddOrder(api_post, api_path, signature, api_key_public) {
    const baseDomain = "https://api.kraken.com";
    const apiEndpointFullURL = `${baseDomain}${api_path}`;
    console.log(apiEndpointFullURL);
    const httpOptions = {
        headers: {
            "API-Key": api_key_public,
            "API-Sign": signature
        }
    };
    await axios.post(apiEndpointFullURL, api_post, httpOptions)
        .then((res) => {
            jsonData = res;
        })
        .catch((err) => {
            jsonData = err;
        });
    return jsonData.data;
}

main();