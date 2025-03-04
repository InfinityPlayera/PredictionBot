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

    convertCurrentDate() {
        // Get the current timestamp
        const now = Date.now();
        // Create a new Date object
        const date = new Date(now);
        // Extract the components
        const year = String(date.getFullYear()).slice(-2); // Last two digits of the year
        const month = String(date.getMonth() + 1).padStart(2, '0'); // Months are 0-indexed
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');
        const milliseconds = String(date.getMilliseconds()).padStart(3, '0'); // Milliseconds can have 3 digits
        // Format the string
        const formattedDate = `${year}/${month}/${day} ${hours}/${minutes}/${seconds}/${milliseconds}`;
        return formattedDate;
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
            if (!this.txContract) {
                throw new Error('Contract not initialized');
            }
            await this.txContract.currentEpoch();
            return true;
        } catch (error) {
            return false;
        }
    }

    async monitorConnection() {
        if (!this.isRunning) return;

        const isConnected = await this.checkConnection();
        if (!isConnected) {
            await this.sendTelegramMessage('⚠️ Connection lost, attempting to reconnect...');
            await this.reconnect();
        }

        // Check connection every 30 seconds
        setTimeout(() => this.monitorConnection(), 30000);
    }

    // Add this method to AutoBot class
    async reconnect() {
        try {
            await this.sendTelegramMessage('🔄 Attempting to reconnect...');

            // Close existing connections
            if (this.listenerProvider) {
                await this.listenerProvider.destroy();
            }
            if (this.txProvider) {
                await this.txProvider.destroy();
            }

            // Recreate providers
            this.listenerProvider = new ethers.WebSocketProvider(WSS_ENDPOINTS_CALL);
            this.txProvider = new ethers.WebSocketProvider(WSS_ENDPOINTS_TX);

            // Recreate wallet and contracts
            this.wallet = new ethers.Wallet(process.env.PRIVATE_KEY, this.txProvider);
            this.listenerContract = new ethers.Contract(PREDICTION_CONTRACT, CONTRACT_ABI, this.listenerProvider);
            this.txContract = new ethers.Contract(PREDICTION_CONTRACT, CONTRACT_ABI, this.wallet);

            // Reattach event listeners
            this.listenerContract.on("BetBull", this.bullListener);
            this.listenerContract.on("BetBear", this.bearListener);

            await this.sendTelegramMessage('✅ Reconnection successful');
        } catch (error) {
            await this.sendTelegramMessage(`❌ Reconnection failed: ${error.message}`);
            // Try again after 5 seconds
            setTimeout(() => this.reconnect(), 5000);
        }
    }


    async start() {
        try {
            if (this.isRunning) {
                await this.sendTelegramMessage('Bot is already running!');
                return;
            }

            this.isRunning = true;
            console.log('🔄 Setting up WebSocket connections...');
            await this.sendTelegramMessage('🔄 Bot starting...');

            // Setup providers
            this.listenerProvider = new ethers.WebSocketProvider(WSS_ENDPOINTS_CALL);
            this.txProvider = new ethers.WebSocketProvider(WSS_ENDPOINTS_TX);

            // Create wallet from private key
            if (!process.env.PRIVATE_KEY) {
                throw new Error('PRIVATE_KEY not found in environment variables');
            }
            this.wallet = new ethers.Wallet(process.env.PRIVATE_KEY, this.txProvider);

            // Create contract instances
            this.listenerContract = new ethers.Contract(PREDICTION_CONTRACT, CONTRACT_ABI, this.listenerProvider);
            this.txContract = new ethers.Contract(PREDICTION_CONTRACT, CONTRACT_ABI, this.wallet);

            // Define listeners
            this.bullListener = async (sender, epoch, amount, event) => {
                try {
                    const message = `
🟢 BULL BET Detected:
Address: ${sender}
Epoch: ${epoch.toString()}
Amount: ${ethers.parseEther(amount.toString())} BNB
`;
                    console.log(message);
                    // await this.sendTelegramMessage(message);

                    if (sender.toLowerCase() === process.env.TARGET_ADDRESS?.toLowerCase()) {
                        await this.sendTelegramMessage('🎯 Target address matched!');
                        await this.sendTelegramMessage(message);
                        try {
                            await this.placeBullBet(epoch, BigInt(amount) / BigInt(10));
                            await this.sendTelegramMessage('✅ Bet Bull placed, waiting for next transaction...');
                        } catch (error) {
                            await this.sendTelegramMessage(`❌ Error placing bull bet: ${error.message}`);
                            await this.sendTelegramMessage('🔄 Continuing to monitor for next transaction...');
                        }

                    }
                } catch (error) {
                    console.error('Error in bull listener:', error);
                    await this.sendTelegramMessage(`❌ Error in bull listener: ${error.message}`);
                    await this.sendTelegramMessage('🔄 Continuing to monitor...');
                }
            };

            this.bearListener = async (sender, epoch, amount, event) => {
                try {
                    const message = `
🔴 BEAR BET Detected:
Address: ${sender}
Epoch: ${epoch.toString()}
Amount: ${ethers.parseEther(amount.toString())} BNB
`;

                    console.log(message);
                    // await this.sendTelegramMessage(message);

                    if (sender.toLowerCase() === process.env.TARGET_ADDRESS?.toLowerCase()) {
                        await this.sendTelegramMessage('🎯 Target address matched!');
                        await this.sendTelegramMessage(message);
                        try {
                            await this.placeBearBet(epoch, BigInt(amount) / BigInt(10));
                            await this.sendTelegramMessage('✅ Bet Bear placed, waiting for next transaction...');
                        } catch (error) {
                            await this.sendTelegramMessage(`❌ Error placing bear bet: ${error.message}`);
                            await this.sendTelegramMessage('🔄 Continuing to monitor for next transaction...');
                        }
                    }
                } catch (error) {
                    console.error('Error in bear listener:', error);
                    await this.sendTelegramMessage(`Error in bear listener: ${error.message}`);
                    await this.sendTelegramMessage('🔄 Continuing to monitor...');
                }
            };

            // Add event listeners
            this.listenerContract.on("BetBull", this.bullListener);
            this.listenerContract.on("BetBear", this.bearListener);
            await this.sendTelegramMessage('🔄 Event listeners set up and waiting for transactions...');

            console.log('✅ WebSocket connections established');
            await this.sendTelegramMessage('✅ WebSocket connections established\n👀 Monitoring PancakeSwap Prediction events...');

            this.monitorConnection();

        } catch (error) {
            this.isRunning = false;
            const errorMsg = `Setup error: ${error.message}`;
            console.error(errorMsg);
            await this.sendTelegramMessage(errorMsg);
            if (this.isRunning) {
                setTimeout(() => this.start(), 5000);
            }
        }
    }

    async stop() {
        try {
            if (!this.isRunning) {
                return;
            }

            this.isRunning = false;
            await this.sendTelegramMessage('🛑 Bot stopping...');

            // Remove event listeners
            if (this.listenerContract) {
                this.listenerContract.removeListener("BetBull", this.bullListener);
                this.listenerContract.removeListener("BetBear", this.bearListener);
            }

            // Close WebSocket providers
            if (this.listenerProvider) {
                await this.listenerProvider.destroy();
                this.listenerProvider = null;
            }
            if (this.txProvider) {
                await this.txProvider.destroy();
                this.txProvider = null;
            }

            this.listenerContract = null;
            this.txContract = null;
            this.wallet = null;
            await this.sendTelegramMessage('✅ Bot stopped successfully');
        } catch (error) {
            console.error('Error stopping bot:', error);
            await this.sendTelegramMessage(`Error stopping bot: ${error.message}`);
        }
    }
}

module.exports = AutoBot;