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
                        // Update claimed status for epochs with no rewards
                        await ClaimEpoch.updateOne(
                            { epoch: bet.epoch, userAddress: bet.userAddress },
                            { claimed: true }
                        );
                    }
                } catch (error) {
                    console.error(`Error checking round ${bet.epoch}:`, error);
                    await this.sendTelegramMessage(`Error checking round ${bet.epoch}: ${error.message}`);
                }
            }

            // Prepare status message
            let statusMessage = '';
            if (skippedEpochs.notClosed.length > 0) {
                statusMessage += `Rounds not yet closed: ${skippedEpochs.notClosed.join(', ')}\n`;
            }
            if (skippedEpochs.noRewards.length > 0) {
                statusMessage += `Rounds with no rewards: ${skippedEpochs.noRewards.join(', ')}\n`;
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
                console.error('Claim Error: ', error)
            }

            // Update claimed status in MongoDB for claimed epochs
            await ClaimEpoch.updateMany(
                {
                    epoch: { $in: claimableEpochs },
                    userAddress: this.wallet.address
                },
                {
                    claimed: true
                }
            );

            const successMessage = `Successfully claimed rewards for epochs: ${claimableEpochs.join(', ')}\n\n${statusMessage}`;
            console.log(successMessage);
            await this.sendTelegramMessage(successMessage.trim());
        } catch (error) {
            const errorMsg = `Error claiming rewards: ${error.message}`;
            console.error(errorMsg);
            await this.sendTelegramMessage(errorMsg);
        }
    }

    async checkConnection() {
        try {
            if (!this.txContract || !this.listenerContract) {
                return false;
            }
            // Check both contracts
            await Promise.all([
                this.txContract.currentEpoch(),
                this.listenerContract.currentEpoch()
            ]);
            this.reconnectAttempts = 0; // Reset reconnect attempts on successful connection
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
                setTimeout(() => this.reconnect(), this.reconnectDelay);
            }
        }
    }

    async setupConnections() {
        // Setup providers
        this.listenerProvider = new ethers.WebSocketProvider(WSS_ENDPOINTS_CALL);
        this.txProvider = new ethers.WebSocketProvider(WSS_ENDPOINTS_TX);

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
            await this.sendTelegramMessage('🔄 Bot starting...');
            
            await this.setupConnections();
            this.setupComplete = true;
            
            await this.sendTelegramMessage('✅ Bot started successfully\n👀 Monitoring PancakeSwap Prediction events...');
            
            this.monitorConnection();
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