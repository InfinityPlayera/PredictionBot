require('dotenv').config();
const { ethers } = require('ethers');
const { CONTRACT_ABI } = require('../config/contract');
const { WSS_ENDPOINTS_CALL, WSS_ENDPOINTS_TX, PREDICTION_CONTRACT } = require('../config/constants');
const ClaimEpoch = require('../models/claimModel');

class AutoBot {
    constructor(telegramBot) {
        this.telegramBot = telegramBot;
        this.betAmount = ethers.parseEther("0.001");
        this.isRunning = false;
        this.listenerProvider = null;
        this.txProvider = null;
        this.listenerContract = null;
        this.txContract = null;
        this.wallet = null;
        this.bullListener = null;
        this.bearListener = null;
        
        // Connection management properties
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectDelay = 30000; // 30 seconds
        this.connectionCheckInterval = 60000; // 60 seconds
        this.setupComplete = false;
        
        // Watchdog properties
        this.lastActivityTimestamp = Date.now();
        this.watchdogInterval = 15 * 60 * 1000; // 15 minutes
        this.dailyRestartTimer = null;
    }

    async sendTelegramMessage(message) {
        if (this.telegramBot) {
            try {
                await this.telegramBot.sendMessage(process.env.BOT_ADMIN_ID, message);
            } catch (error) {
                console.error('Error sending Telegram message: ', error);
            }
        }
    }

    async placeBullBet(epoch, amount) {
        try {
            const tx = await this.txContract.betBull(epoch, {
                value: amount,
                gasLimit: 500000
            });
            await tx.wait();

            await ClaimEpoch.create({
                epoch: epoch.toString(),
                userAddress: this.wallet.address,
                claimed: false
            });

            const message = `Successfully placing bull bet on ${epoch}`;
            console.log(message);
            await this.sendTelegramMessage(message);
            this.lastActivityTimestamp = Date.now(); // Update activity timestamp
        } catch (error) {
            const errorMsg = `Error placing bull bet on ${epoch}: ${error.message}`;
            console.error(errorMsg);
            await this.sendTelegramMessage(errorMsg);
        }
    }

    async placeBearBet(epoch, amount) {
        try {
            const tx = await this.txContract.betBear(epoch, {
                value: amount,
                gasLimit: 500000
            });
            await tx.wait();

            await ClaimEpoch.create({
                epoch: epoch.toString(),
                userAddress: this.wallet.address,
                claimed: false
            });

            const message = `Successfully placing bear bet on ${epoch}`;
            console.log(message);
            await this.sendTelegramMessage(message);
            this.lastActivityTimestamp = Date.now(); // Update activity timestamp
        } catch (error) {
            const errorMsg = `Error placing bear bet on ${epoch}: ${error.message}`;
            console.error(errorMsg);
            await this.sendTelegramMessage(errorMsg);
        }
    }

    async claimRewards() {
        try {
            // Get unclaimed bets from MongoDB
            const unclaimedBets = await ClaimEpoch.find({
                userAddress: this.wallet.address,
                claimed: false
            });

            if (unclaimedBets.length === 0) {
                await this.sendTelegramMessage('No unclaimed bets found');
                return;
            }

            // Filter epochs that have closed and have rewards
            const currentTimestamp = Math.floor(Date.now() / 1000); // Convert to seconds
            const claimableEpochs = [];
            const skippedEpochs = {
                notClosed: [],
                noRewards: []
            };
            
            const epochsToDelete = []; // Track epochs to delete
            
            for (const bet of unclaimedBets) {
                try {
                    const round = await this.txContract.rounds(BigInt(bet.epoch));
                    // Check if round is closed
                    if (currentTimestamp <= Number(round.closeTimestamp)) {
                        skippedEpochs.notClosed.push(BigInt(bet.epoch));
                        continue;
                    }
                    // Check if user has rewards for this epoch
                    const isClaimable = await this.txContract.claimable(BigInt(bet.epoch), bet.userAddress);

                    if (isClaimable) {
                        claimableEpochs.push(BigInt(bet.epoch));
                    } else {
                        skippedEpochs.noRewards.push(BigInt(bet.epoch));
                        // Delete epochs with no rewards instead of updating them
                        epochsToDelete.push(bet.epoch);
                    }
                } catch (error) {
                    console.error(`Error checking round ${bet.epoch}:`, error);
                    await this.sendTelegramMessage(`Error checking round ${bet.epoch}: ${error.message}`);
                }
            }
            
            // Delete epochs with no rewards
            if (epochsToDelete.length > 0) {
                await ClaimEpoch.deleteMany({
                    epoch: { $in: epochsToDelete },
                    userAddress: this.wallet.address
                });
            }

            // Prepare status message
            let statusMessage = '';
            if (skippedEpochs.notClosed.length > 0) {
                statusMessage += `Rounds not yet closed: ${skippedEpochs.notClosed.join(', ')}\n`;
            }
            if (skippedEpochs.noRewards.length > 0) {
                statusMessage += `Rounds with no rewards (deleted): ${skippedEpochs.noRewards.join(', ')}\n`;
            }

            if (claimableEpochs.length === 0) {
                statusMessage = 'No claimable rewards found.\n' + statusMessage;
                await this.sendTelegramMessage(statusMessage.trim());
                return;
            }

            // Call the claim function on the smart contract for epochs with rewards
            try {
                const tx = await this.txContract.claim(claimableEpochs);
                await tx.wait();
            } catch (error) {
                console.error('Claim Error: ', error);
                await this.sendTelegramMessage(`Claim Error: ${error.message}`);
                return;
            }

            // Delete claimed epochs instead of updating them
            await ClaimEpoch.deleteMany({
                epoch: { $in: claimableEpochs.map(e => e.toString()) },
                userAddress: this.wallet.address
            });

            const successMessage = `Successfully claimed rewards for epochs: ${claimableEpochs.join(', ')}\n\n${statusMessage}`;
            console.log(successMessage);
            await this.sendTelegramMessage(successMessage.trim());
            this.lastActivityTimestamp = Date.now(); // Update activity timestamp
        } catch (error) {
            const errorMsg = `Error claiming rewards: ${error.message}`;
            console.error(errorMsg);
            await this.sendTelegramMessage(errorMsg);
        }
    }

    async checkConnection() {
        try {
            if (!this.txContract || !this.listenerContract) {
                console.log("Contracts not initialized");
                return false;
            }
            
            // Check both contracts
            const [txEpoch, listenerEpoch] = await Promise.all([
                this.txContract.currentEpoch(),
                this.listenerContract.currentEpoch()
            ]);
            
            console.log(`Connection check passed. Current epoch: ${txEpoch}`);
            this.reconnectAttempts = 0; // Reset reconnect attempts on successful connection
            this.lastActivityTimestamp = Date.now(); // Update activity timestamp
            return true;
        } catch (error) {
            console.error('Connection check failed:', error);
            return false;
        }
    }

    async monitorConnection() {
        if (!this.isRunning) return;

        try {
            const isConnected = await this.checkConnection();
            if (!isConnected) {
                await this.sendTelegramMessage('⚠️ Connection lost, attempting to reconnect...');
                await this.reconnect();
            }
        } catch (error) {
            console.error('Monitor connection error:', error);
        } finally {
            if (this.isRunning) {
                setTimeout(() => this.monitorConnection(), this.connectionCheckInterval);
            }
        }
    }

    async reconnect() {
        try {
            if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                await this.sendTelegramMessage('❌ Max reconnection attempts reached. Stopping bot...');
                await this.stop();
                return;
            }

            this.reconnectAttempts++;
            await this.sendTelegramMessage(`🔄 Reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}...`);

            // Cleanup existing connections
            await this.cleanup();

            // Setup new connections
            await this.setupConnections();

            // Verify connection
            const isConnected = await this.checkConnection();
            if (!isConnected) {
                throw new Error('Connection verification failed');
            }

            await this.sendTelegramMessage('✅ Reconnection successful');
            this.setupComplete = true;
        } catch (error) {
            console.error('Reconnection failed:', error);
            await this.sendTelegramMessage(`❌ Reconnection failed: ${error.message}`);
            
            if (this.isRunning) {
                // Exponential backoff for reconnection
                const delay = Math.min(this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1), 300000); // Max 5 minutes
                await this.sendTelegramMessage(`Trying again in ${Math.round(delay/1000)} seconds...`);
                setTimeout(() => this.reconnect(), delay);
            }
        }
    }

    setupWebSocketHandlers(provider, name) {
        if (!provider || !provider._websocket) return;
        
        const ws = provider._websocket;
        
        ws.on('error', async (error) => {
            console.error(`${name} WebSocket error:`, error);
            await this.sendTelegramMessage(`⚠️ ${name} WebSocket error: ${error.message}`);
            if (this.isRunning) await this.reconnect();
        });
        
        ws.on('close', async (code, reason) => {
            console.log(`${name} WebSocket closed with code ${code} and reason: ${reason || 'Unknown'}`);
            await this.sendTelegramMessage(`⚠️ ${name} WebSocket closed. Reconnecting...`);
            if (this.isRunning) await this.reconnect();
        });
    }

    async setupHeartbeat() {
        if (!this.isRunning) return;
        
        try {
            // Simple request to keep connection alive
            if (this.listenerContract) {
                await this.listenerContract.currentEpoch();
                console.log("Heartbeat: Listener connection active");
            }
            if (this.txContract) {
                await this.txContract.currentEpoch();
                console.log("Heartbeat: Transaction connection active");
            }
        } catch (error) {
            console.error('Heartbeat error:', error);
            if (this.isRunning) await this.reconnect();
        } finally {
            // Schedule next heartbeat
            if (this.isRunning) {
                setTimeout(() => this.setupHeartbeat(), 30000); // Every 30 seconds
            }
        }
    }

    async watchdog() {
        if (!this.isRunning) return;
        
        const currentTime = Date.now();
        const inactivityTime = currentTime - this.lastActivityTimestamp;
        
        if (inactivityTime > this.watchdogInterval) {
            await this.sendTelegramMessage(`⚠️ No activity for ${Math.floor(inactivityTime/60000)} minutes. Restarting bot...`);
            await this.stop();
            await new Promise(resolve => setTimeout(resolve, 5000));
            await this.start();
        } else {
            setTimeout(() => this.watchdog(), 60000); // Check every minute
        }
    }

    async setupConnections() {
        // Setup providers
        this.listenerProvider = new ethers.WebSocketProvider(WSS_ENDPOINTS_CALL);
        this.txProvider = new ethers.WebSocketProvider(WSS_ENDPOINTS_TX);

        // Add WebSocket event handlers
        this.setupWebSocketHandlers(this.listenerProvider, "Listener");
        this.setupWebSocketHandlers(this.txProvider, "Transaction");

        // Create wallet
        this.wallet = new ethers.Wallet(process.env.PRIVATE_KEY, this.txProvider);

        // Create contracts
        this.listenerContract = new ethers.Contract(PREDICTION_CONTRACT, CONTRACT_ABI, this.listenerProvider);
        this.txContract = new ethers.Contract(PREDICTION_CONTRACT, CONTRACT_ABI, this.wallet);

        // Setup event listeners
        this.setupEventListeners();
    }

    setupEventListeners() {
        this.bullListener = async (sender, epoch, amount, event) => {
            try {
                this.lastActivityTimestamp = Date.now(); // Update activity timestamp
                
                if (!await this.checkConnection()) {
                    await this.reconnect();
                    return;
                }

                const message = `
🟢 BULL BET Detected:
Address: ${sender}
Epoch: ${epoch.toString()}
Amount: ${ethers.formatEther(amount.toString())} BNB
`;
                console.log(message);

                if (sender.toLowerCase() === process.env.TARGET_ADDRESS?.toLowerCase()) {
                    await this.sendTelegramMessage('🎯 Target address matched!');
                    await this.sendTelegramMessage(message);
                    await this.placeBullBet(epoch, BigInt(amount) / BigInt(10));
                }
            } catch (error) {
                console.error('Error in bull listener:', error);
                await this.handleListenerError('bull', error);
            }
        };

        this.bearListener = async (sender, epoch, amount, event) => {
            try {
                this.lastActivityTimestamp = Date.now(); // Update activity timestamp
                
                if (!await this.checkConnection()) {
                    await this.reconnect();
                    return;
                }

                const message = `
🔴 BEAR BET Detected:
Address: ${sender}
Epoch: ${epoch.toString()}
Amount: ${ethers.formatEther(amount.toString())} BNB
`;
                console.log(message);

                if (sender.toLowerCase() === process.env.TARGET_ADDRESS?.toLowerCase()) {
                    await this.sendTelegramMessage('🎯 Target address matched!');
                    await this.sendTelegramMessage(message);
                    await this.placeBearBet(epoch, BigInt(amount) / BigInt(10));
                }
            } catch (error) {
                console.error('Error in bear listener:', error);
                await this.handleListenerError('bear', error);
            }
        };

        // Attach listeners
        this.listenerContract.on("BetBull", this.bullListener);
        this.listenerContract.on("BetBear", this.bearListener);
    }

    async handleListenerError(type, error) {
        await this.sendTelegramMessage(`❌ Error in ${type} listener: ${error.message}`);
        if (!await this.checkConnection()) {
            await this.reconnect();
        }
    }

    async cleanup() {
        try {
            // Remove event listeners
            if (this.listenerContract) {
                this.listenerContract.removeAllListeners();
            }

            // Clear timers
            if (this.dailyRestartTimer) {
                clearTimeout(this.dailyRestartTimer);
                this.dailyRestartTimer = null;
            }

            // Destroy providers
            await Promise.all([
                this.listenerProvider?.destroy(),
                this.txProvider?.destroy()
            ]);

            // Reset instances
            this.listenerProvider = null;
            this.txProvider = null;
            this.listenerContract = null;
            this.txContract = null;
            this.wallet = null;
        } catch (error) {
            console.error('Cleanup error:', error);
        }
    }

    async start() {
        try {
            if (this.isRunning) {
                await this.sendTelegramMessage('Bot is already running!');
                return;
            }

            this.isRunning = true;
            this.reconnectAttempts = 0; // Reset reconnect attempts
            this.lastActivityTimestamp = Date.now(); // Reset activity timestamp
            await this.sendTelegramMessage('🔄 Bot starting...');
            
            await this.setupConnections();
            this.setupComplete = true;
            
            // Start heartbeat, connection monitoring, and watchdog
            this.setupHeartbeat();
            this.monitorConnection();
            this.watchdog();
            
            // Setup daily restart
            const restartTime = 24 * 60 * 60 * 1000; // 24 hours
            this.dailyRestartTimer = setTimeout(async () => {
                await this.sendTelegramMessage('🔄 Performing scheduled daily restart...');
                await this.stop();
                await new Promise(resolve => setTimeout(resolve, 5000));
                await this.start();
            }, restartTime);
            
            await this.sendTelegramMessage('✅ Bot started successfully\n👀 Monitoring PancakeSwap Prediction events...');
        } catch (error) {
            this.isRunning = false;
            console.error('Start error:', error);
            await this.sendTelegramMessage(`❌ Start error: ${error.message}`);
            
            if (!this.setupComplete) {
                setTimeout(() => this.start(), this.reconnectDelay);
            }
        }
    }

    async stop() {
        try {
            if (!this.isRunning) return;

            this.isRunning = false;
            await this.sendTelegramMessage('🛑 Bot stopping...');
            
            await this.cleanup();
            
            await this.sendTelegramMessage('✅ Bot stopped successfully');
        } catch (error) {
            console.error('Stop error:', error);
            await this.sendTelegramMessage(`❌ Stop error: ${error.message}`);
        }
    }
}

module.exports = AutoBot;
