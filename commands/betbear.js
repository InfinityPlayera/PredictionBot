// commands/betbull.js
const { getAutoBot } = require('./startbot');
const { ethers } = require('ethers');

async function handler(ctx) {
    try {
        const autoBot = getAutoBot();
        if (!autoBot || !autoBot.isRunning) {
            await ctx.reply('❌ Bot is not running. Please start the bot first with /startbot');
            return;
        }

        // Extract amount from command (optional)
        const args = ctx.message.text.split(' ');
        let amount;
        
        if (args.length > 1) {
            // If amount is provided in command (e.g., /betbull 0.1)
            amount = ethers.parseEther(args[1]);
        } else {
            // Use default amount from AutoBot
            amount = autoBot.betAmount;
        }

        // Get current epoch
        const currentEpoch = await autoBot.txContract.currentEpoch();
        
        // Place the bet
        await autoBot.placeBearBet(currentEpoch, amount);
        
        await ctx.reply(`✅ Manual BEAR bet placed for epoch ${currentEpoch}\nAmount: ${ethers.formatEther(amount)} BNB`);
        
    } catch (error) {
        console.error('Error in betbear command:', error);
        await ctx.reply(`❌ Error placing bear bet: ${error.message}`);
    }
}

module.exports = handler;
