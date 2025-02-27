// commands/status.js
const { getAutoBot } = require('./startbot');
const { ethers } = require('ethers');

async function handler(ctx) {
    try {
        const autoBot = getAutoBot();
        if (!autoBot) {
            await ctx.reply('❌ Bot instance not found');
            return;
        }

        const status = {
            isRunning: autoBot.isRunning,
            hasListenerProvider: !!autoBot.listenerProvider,
            hasTxProvider: !!autoBot.txProvider,
            hasWallet: !!autoBot.wallet,
            walletAddress: autoBot.wallet?.address || 'Not connected',
            betAmount: ethers.formatEther(autoBot.betAmount) + ' BNB',
            targetAddress: process.env.TARGET_ADDRESS || 'Not set'
        };

        const statusMessage = `
🤖 Bot Status:
Running: ${status.isRunning ? '✅' : '❌'}
Listener Connection: ${status.hasListenerProvider ? '✅' : '❌'}
Transaction Connection: ${status.hasTxProvider ? '✅' : '❌'}
Wallet Connected: ${status.hasWallet ? '✅' : '❌'}
Wallet Address: ${status.walletAddress}
Bet Amount: ${status.betAmount}
Target Address: ${status.targetAddress}`;

        await ctx.reply(statusMessage);

        // If bot is running, check contract connection
        if (status.isRunning) {
            try {
                const currentEpoch = await autoBot.txContract.currentEpoch();
                await ctx.reply(`📊 Current Epoch: ${currentEpoch}\n✅ Contract connection verified`);
            } catch (error) {
                await ctx.reply('⚠️ Warning: Cannot fetch current epoch. Contract connection might be unstable.');
            }
        }

    } catch (error) {
        console.error('Error getting bot status:', error);
        await ctx.reply(`❌ Error getting bot status: ${error.message}`);
    }
}

module.exports = handler;
