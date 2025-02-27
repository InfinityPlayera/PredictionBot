const Prediction = require('./prediction');
const analyzeTx = require('./autoBet');

class PredictionBot {
    constructor() {
        this.prediction = new Prediction();
        this.isRunning = false;
        this.betCommand = [1, 0, 0, 1, 0, 0, 1, 0, 1, 0]; // 1 for Bull, 0 for Bear
        this.step = 0;
        this.betAmount = '10000000000000000'; // 0.01 BNB in wei
        this.pendingClaims = new Set();
        this.pendingClaimsStartTime = new Map(); // Added to track when claims were added
        this.lastProcessedEpoch = 0;
        this.log = "";
    }

    async start() {
        this.isRunning = true;
        console.log('Starting bot...');
        
        try {
            // Check genesis status
            const genesisStatus = await this.prediction.checkGenesisStatus();

            while (this.isRunning) {
                try {
                    // Get current round state
                    const currentTimestamp = Math.floor(Date.now() / 1000);
                    const currentRound = await this.prediction.getCurrentRoundState();
                    
                    const isBettable = currentRound && 
                        currentRound.startTimestamp !== 0 &&
                        currentRound.lockTimestamp !== 0 &&
                        currentTimestamp > currentRound.startTimestamp &&
                        currentTimestamp < currentRound.lockTimestamp;

                    this.log = `Current Round:', ${{
                        epoch: currentRound?.epoch,
                        isBettable: isBettable,
                        timestamp: currentTimestamp
                    }}`;

                    // Check if round is bettable
                    if (isBettable && this.lastProcessedEpoch !== currentRound.epoch) {
                        await this.placeBet(currentRound.epoch);
                        this.lastProcessedEpoch = currentRound.epoch;
                    }

                    // Try to claim previous rounds
                    await this.processPendingClaims();

                    // Wait before next check (250 seconds)
                    await this.sleep(250000);
                } catch (error) {
                    console.error('Error in main loop:', error);
                    await this.sleep(60000); // 1 minute delay on error
                }
            }
        } catch (error) {
            console.error('Fatal error:', error);
            this.stop();
        }
    }
    
    async placeBet(epoch) {
        try {
            const position = this.betCommand[this.step % this.betCommand.length];
            
            if (position === 1) {
                await this.prediction.placeBullBet(epoch, this.betAmount);
                this.log += `Placed BULL bet on epoch ${epoch}`;
            } else {
                await this.prediction.placeBearBet(epoch, this.betAmount);
                this.log += `Placed BEAR bet on epoch ${epoch}`;
            }

            // Add epoch to pending claims with timestamp
            this.pendingClaims.add(epoch);
            this.pendingClaimsStartTime.set(epoch, Math.floor(Date.now() / 1000));
            this.step++;

        } catch (error) {
            console.error(`Error placing bet for epoch ${epoch}:`, error);
            throw error;
        }
    }

    async processPendingClaims() {
        try {
            const currentTimestamp = Math.floor(Date.now() / 1000);
            
            // Check each pending claim
            for (const epoch of this.pendingClaims) {
                try {
                    const round = await this.prediction.getRoundData(epoch);
                    this.log += round;
                    if (round) {
                        // Check if round is finished (closeTimestamp has passed)
                        if (currentTimestamp > round.closeTimestamp) {
                            // Check if round is claimable
                            const isClaimable = await this.prediction.claimable(epoch, this.prediction.wallet.address);
                            const isrefundable = await this.prediction.refundable(epoch, this.prediction.wallet.address);
                            if (isClaimable || isrefundable) {
                                try {
                                    // Attempt to claim
                                    await this.prediction.claim([...epoch]);
                                    this.log += `Successfully claimed rewards for epoch ${epoch}`;
                                } catch (claimError) {
                                    console.error(`Error claiming rewards for epoch ${epoch}:`, claimError);
                                }
                            }
                            
                            // Remove from pending claims since round is finished
                            this.pendingClaims.delete(epoch);
                            this.pendingClaimsStartTime.delete(epoch);
                        }
                    } else {
                        // If round data doesn't exist and it's been more than 5 minutes
                        const trackingStartTime = this.pendingClaimsStartTime.get(epoch);
                        if (trackingStartTime && currentTimestamp > trackingStartTime + 300) {
                            this.pendingClaims.delete(epoch);
                            this.pendingClaimsStartTime.delete(epoch);
                        }
                    }
                } catch (error) {
                    console.error(`Error checking claim for epoch ${epoch}:`, error);
                }
            }
        } catch (error) {
            console.error('Error processing pending claims:', error);
            return [];
        }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    stop() {
        console.log('Stopping bot...');
        this.isRunning = false;
    }
}

module.exports = PredictionBot;
