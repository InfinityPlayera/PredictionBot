const { getAutoBot } = require('./startbot');

const claimHandler = async (ctx) => {
    try {
        const autoBot = getAutoBot();
        
        if (!autoBot || !autoBot.isRunning) {
            await ctx.reply('Bot is not running!');
            return;
        }

        await ctx.reply('Claiming rewards...');
        await autoBot.claimRewards();
    } catch (error) {
        await ctx.reply(`Error claiming rewards: ${error.message}`);
    }
};

module.exports = claimHandler;
