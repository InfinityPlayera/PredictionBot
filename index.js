// index.js
require('dotenv').config();
require('./config/database').connect();
const { ethers } = require('ethers');
const { CONTRACT_ABI } = require('./config/contract');
const { WSS_ENDPOINTS_CALL, RPC_ENDPOINTS_TX, PREDICTION_CONTRACT } = require('./config/constants');
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

// Initialize transaction provider (using HTTP RPC for reliability)
const txProvider = new ethers.JsonRpcProvider(RPC_ENDPOINTS_TX);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, txProvider);
const txContract = new ethers.Contract(PREDICTION_CONTRACT, CONTRACT_ABI, wallet);

let bettingIndex = 0;
let listenerProvider = null;
let listenerContract = null;

// Send Telegram messages to admin
const sendTelegramMessage = async (message) => {
    try {
        await bot.telegram.sendMessage(process.env.BOT_ADMIN_ID, message);
    } catch (error) {
        console.error('Error sending Telegram message: ', error);
    }
};

// Handle BetBull events
const handleBetBullEvent = async (eventData) => {
    try {
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
        message = await placeBullBet(epoch, amount, txContract, wallet.address);
        await sendTelegramMessage(message);
        
        bettingIndex++;
        if (bettingIndex >= 10) {
            bettingIndex = 0;
            message = await claimRewards(txContract, wallet.address);
            await sendTelegramMessage(message);
        }
    } catch (error) {
        console.error('Error in bull listener:', error);
        await sendTelegramMessage(`❌ Error processing bull bet: ${error.message}`);
    }
};

// Handle BetBear events
const handleBetBearEvent = async (eventData) => {
    try {
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
        message = await placeBearBet(epoch, amount, txContract, wallet.address);
        await sendTelegramMessage(message);

        bettingIndex++;
        if (bettingIndex >= 10) {
            bettingIndex = 0;
            message = await claimRewards(txContract, wallet.address);
            await sendTelegramMessage(message);
        }
    } catch (error) {
        console.error('Error in bear listener:', error);
        await sendTelegramMessage(`❌ Error processing bear bet: ${error.message}`);
    }
};

// Set up event listeners
const setupEventListeners = (contract) => {
    // Listen for BetBull events from target address
    contract.on(contract.filters.BetBull(process.env.TARGET_ADDRESS), handleBetBullEvent);
    
    // Listen for BetBear events from target address
    contract.on(contract.filters.BetBear(process.env.TARGET_ADDRESS), handleBetBearEvent);
    
    console.log(`✅ Event listeners set up for address: ${process.env.TARGET_ADDRESS}`);
};

// WebSocket provider with auto-reconnection
function createReconnectingWebSocketProvider() {
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 10;
    let heartbeatInterval;

    const connect = async () => {
        try {
            // Clean up any existing provider
            if (listenerProvider) {
                console.log("Cleaning up existing WebSocket provider...");
                clearInterval(heartbeatInterval);
                
                try {
                    listenerProvider.removeAllListeners();
                    await listenerProvider.destroy();
                } catch (err) {
                    console.log("Error during cleanup:", err.message);
                }
            }

            // Create new provider
            console.log(`Connecting to WebSocket at ${WSS_ENDPOINTS_CALL}...`);
            listenerProvider = new ethers.WebSocketProvider(WSS_ENDPOINTS_CALL);
            listenerContract = new ethers.Contract(PREDICTION_CONTRACT, CONTRACT_ABI, listenerProvider);
            
            // Set up event listeners
            setupEventListeners(listenerContract);
            
            // Handle WebSocket-specific errors
            listenerProvider.on("error", (error) => {
                console.error(`WebSocket error:`, error);
                reconnect("WebSocket error occurred");
            });
            
            // Monitor WebSocket connection status
            if (listenerProvider.websocket) {
                listenerProvider.websocket.on("close", () => {
                    console.log(`WebSocket connection closed`);
                    reconnect("WebSocket connection closed");
                });
            }
            
            // Set up heartbeat to keep connection alive
            heartbeatInterval = setInterval(async () => {
                try {
                    const blockNumber = await listenerProvider.getBlockNumber();
                    console.log(`Heartbeat: Connection alive, current block ${blockNumber}`);
                } catch (error) {
                    console.error("Heartbeat check failed:", error);
                    reconnect("Heartbeat check failed");
                }
            }, 30000); // Every 30 seconds
            
            // Reset reconnection counter on successful connection
            reconnectAttempts = 0;
            await sendTelegramMessage("🔄 WebSocket connection established successfully");
            console.log("WebSocket connection established successfully");
            
            return true;
        } catch (error) {
            console.error("WebSocket connection failed:", error);
            reconnect("Initial connection failed");
            return false;
        }
    };

    const reconnect = async (reason) => {
        clearInterval(heartbeatInterval);
        
        if (reconnectAttempts >= maxReconnectAttempts) {
            console.error(`Failed to reconnect after ${maxReconnectAttempts} attempts`);
            await sendTelegramMessage("⚠️ WebSocket reconnection failed after maximum attempts! Bot may miss events. Please restart manually.");
            return;
        }
        
        reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 60000); // Exponential backoff, max 1 minute
        
        console.log(`WebSocket disconnected (${reason}). Attempting to reconnect in ${delay/1000}s (attempt ${reconnectAttempts}/${maxReconnectAttempts})...`);
        await sendTelegramMessage(`⚠️ WebSocket disconnected (${reason}). Reconnecting in ${delay/1000}s (attempt ${reconnectAttempts}/${maxReconnectAttempts})`);
        
        setTimeout(() => {
            connect();
        }, delay);
    };

    // Initial connection
    connect();
    
    return {
        reconnect,
        getStatus: () => ({
            connected: !!(listenerProvider && listenerProvider.websocket && listenerProvider.websocket.readyState === 1),
            reconnectAttempts: reconnectAttempts
        })
    };
}

// Create the WebSocket connection manager
const wsManager = createReconnectingWebSocketProvider();

// Add a status command to the bot
bot.command('status', async (ctx) => {
    if (!isPrivateChat(ctx)) return;
    
    const status = wsManager.getStatus();
    const txProviderConnected = await txProvider.getNetwork().then(() => true).catch(() => false);
    
    const statusMessage = `
🤖 Bot Status:
- WebSocket: ${status.connected ? '✅ Connected' : '❌ Disconnected'}
- Reconnect Attempts: ${status.reconnectAttempts}
- Transaction Provider: ${txProviderConnected ? '✅ Connected' : '❌ Disconnected'}
- Monitoring Address: ${process.env.TARGET_ADDRESS}
- Betting Index: ${bettingIndex}/10
    `;
    
    ctx.reply(statusMessage);
});

// Command to force WebSocket reconnection
bot.command('reconnect', async (ctx) => {
    if (!isPrivateChat(ctx)) return;
    
    await ctx.reply('🔄 Manually reconnecting WebSocket...');
    wsManager.reconnect('Manual reconnection requested');
    
    await ctx.reply('Reconnection process started');
});

// Enhanced graceful shutdown
process.once('SIGINT', async () => {
    console.log('Shutting down bot and closing connections...');
    
    // Close Telegram bot
    bot.stop('SIGINT');
    
    try {
        console.log('Closing WebSocket connections...');
        clearInterval(heartbeatInterval);
        
        if (listenerProvider) {
            await listenerProvider.destroy();
        }
        
        if (txProvider) {
            await txProvider.destroy();
        }
        
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
        clearInterval(heartbeatInterval);
        
        if (listenerProvider) {
            await listenerProvider.destroy();
        }
        
        if (txProvider) {
            await txProvider.destroy();
        }
        
        console.log('WebSocket connections closed successfully');
    } catch (error) {
        console.error('Error closing WebSocket connections:', error);
    }
    
    console.log('Shutdown complete');
    process.exit(0);
});

// Notify on startup
console.log(`🚀 Monitoring bets from address: ${process.env.TARGET_ADDRESS}`);
sendTelegramMessage(`🚀 Bot started! Monitoring bets from address: ${process.env.TARGET_ADDRESS}`);
