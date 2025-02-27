// config/constants.js
const WSS_ENDPOINTS_CALL = process.env.WSS_ENDPOINTS_CALL;
const WSS_ENDPOINTS_TX = process.env.WSS_ENDPOINTS_TX;
const PREDICTION_CONTRACT = process.env.PREDICTION_CONTRACT;

// Add validation
if (!WSS_ENDPOINTS_CALL) {
    throw new Error('WSS_ENDPOINTS_CALL is not defined in environment variables');
}

if (!WSS_ENDPOINTS_TX) {
    throw new Error('WSS_ENDPOINTS_TX is not defined in environment variables');
}

if (!PREDICTION_CONTRACT) {
    throw new Error('PREDICTION_CONTRACT is not defined in environment variables');
}

module.exports = {
    WSS_ENDPOINTS_CALL,
    WSS_ENDPOINTS_TX,
    PREDICTION_CONTRACT
};
