// index.js
require('dotenv').config();
require('./config/database').connect();
const { ethers } = require('ethers');
const { CONTRACT_ABI } = require('./config/contract');
const { WSS_ENDPOINTS_CALL, WSS_ENDPOINTS_TX, PREDICTION_CONTRACT } = require('./config/constants');
const { placeBearBet, placeBullBet, claimRewards } = require('./services/prediction');

// Import Telegram bot and command handlers
const bot = require('./config/bot');
const { isPrivateChat } = require('./utils/validation');
const startHandler = require('./commands/start');

// Register bot commands
bot.start(isPrivateChat, startHandler);

// Add error handler for the bot
bot.catch((error, ctx) => {
    console.error('Bot error:', error);
    ctx.reply(`❌ An error occurred: ${error.message}`).catch(console.error);
});

// Launch the Telegram bot
bot.launch().then(() => {
    console.log('🤖 Telegram Bot successfully launched');
}).catch((error) => {
    console.error('Failed to launch bot:', error);
});

// Set up WebSocket providers and contracts
const listenerProvider = new ethers.WebSocketProvider(WSS_ENDPOINTS_CALL);
const listenerContract = new ethers.Contract(PREDICTION_CONTRACT, CONTRACT_ABI, listenerProvider);

const txProvider = new ethers.WebSocketProvider(WSS_ENDPOINTS_TX);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, txProvider);
const txContract = new ethers.Contract(PREDICTION_CONTRACT, CONTRACT_ABI, wallet);

let bettingIndex = 0;

// Updated sendTelegramMessage function that uses the bot directly
const sendTelegramMessage = async (message) => {
    try {
        await bot.telegram.sendMessage(process.env.BOT_ADMIN_ID, message);
    } catch (error) {
        console.error('Error sending Telegram message: ', error);
    }
};

// Set up blockchain event listeners
listenerContract.on(listenerContract.filters.BetBull(process.env.TARGET_ADDRESS),
    async (eventData) => {
        try {
            // console.log('Raw BetBull event data:', JSON.stringify(eventData, null, 2));

            const args = eventData.args || {};
            const sender = args.sender;
            const epoch = args.epoch;
            const amount = args.amount;

            if (!epoch || !amount) {
                console.error('Missing required event data:', args);
                return;
            }

            let message = `
🟢 BULL BET Detected:
Address: ${sender}
Epoch: ${epoch.toString()}
Amount: ${ethers.formatEther(amount.toString())} BNB
`;
            console.log(message);

            await sendTelegramMessage('🎯 Target address matched!');
            await sendTelegramMessage(message);
            message = await placeBullBet(epoch, BigInt(amount) / BigInt(10), txContract, wallet.address);
            await sendTelegramMessage(message);
            
            bettingIndex++;
            if (bettingIndex >= 10) {
                bettingIndex = 0;

                message = await claimRewards(txContract, wallet.address);
                await sendTelegramMessage(message);
            }
        } catch (error) {
            console.error('Error in bull listener:', error);
        }
    }
);

listenerContract.on(listenerContract.filters.BetBear(process.env.TARGET_ADDRESS),
    async (eventData) => {
        try {
            // console.log('Raw BetBear event data:', JSON.stringify(eventData, null, 2));
            
            const args = eventData.args || {};
            const sender = args.sender;
            const epoch = args.epoch;
            const amount = args.amount;
            
            if (!epoch || !amount) {
                console.error('Missing required event data:', args);
                return;
            }
            let message = `
🔴 BEAR BET Detected:
Address: ${sender}
Epoch: ${epoch.toString()}
Amount: ${ethers.formatEther(amount.toString())} BNB
`;
            console.log(message);

            await sendTelegramMessage('🎯 Target address matched!');
            await sendTelegramMessage(message);
            message = await placeBearBet(epoch, BigInt(amount) / BigInt(10), txContract, wallet.address);
            await sendTelegramMessage(message);

            bettingIndex++;
            if (bettingIndex >= 10) {
                bettingIndex = 0;

                message = await claimRewards(txContract, wallet.address);
                await sendTelegramMessage(message);
            }
        } catch (error) {
            console.error('Error in bear listener:', error);
        }
    }
);

// Proper WebSocket error handling for ethers.js v6.13.5
// Error handling for listener provider
listenerProvider.on("error", (error) => {
    console.error(`Listener WebSocket error:`, error);
});

// You can also listen for network changes
listenerProvider.on("network", (newNetwork, oldNetwork) => {
    if (oldNetwork) {
        console.log(`Network changed from ${oldNetwork.name} to ${newNetwork.name}`);
    }
});

// Error handling for tx provider
txProvider.on("error", (error) => {
    console.error(`Transaction WebSocket error:`, error);
});

// Add connection status logging
console.log(`Connected to listener WebSocket at ${WSS_ENDPOINTS_CALL}`);
console.log(`Connected to transaction WebSocket at ${WSS_ENDPOINTS_TX}`);

// Enhanced graceful shutdown for ethers.js v6.13.5
process.once('SIGINT', async () => {
    console.log('Shutting down bot and closing connections...');
    
    // Close Telegram bot
    bot.stop('SIGINT');
    
    try {
        console.log('Closing WebSocket connections...');
        // In ethers.js v6, use destroy() to close connections
        await listenerProvider.destroy();
        await txProvider.destroy();
        console.log('WebSocket connections closed successfully');
    } catch (error) {
        console.error('Error closing WebSocket connections:', error);
    }
    
    console.log('Shutdown complete');
    process.exit(0);
});

process.once('SIGTERM', async () => {
    // Same shutdown procedure as SIGINT
    console.log('Shutting down bot and closing connections...');
    bot.stop('SIGTERM');
    
    try {
        console.log('Closing WebSocket connections...');
        await listenerProvider.destroy();
        await txProvider.destroy();
        console.log('WebSocket connections closed successfully');
    } catch (error) {
        console.error('Error closing WebSocket connections:', error);
    }
    
    console.log('Shutdown complete');
    process.exit(0);
});

console.log(`🚀 Monitoring bets from address: ${process.env.TARGET_ADDRESS}`);
