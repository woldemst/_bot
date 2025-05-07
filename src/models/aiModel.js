const ort = require('onnxruntime-node');
const { MODEL_PATH } = require('../config/constants');

class AIModel {
    constructor() {
        this.session = null;
    }

    async load() {
        this.session = await ort.InferenceSession.create(MODEL_PATH);
        console.log('✅ ONNX model loaded');
    }

    async predict(features) {
        const tensor = new ort.Tensor('float32', Float32Array.from(features), [1, features.length]);
        const out = await this.session.run({ input: tensor });
        return out.output.data[0];
    }
}

module.exports = new AIModel();