const { getAutoBot } = require('./startbot');

async function handler(ctx) {
    try {
        const autoBot = getAutoBot();
        if (!autoBot || !autoBot.isRunning) {
            await ctx.reply('❌ Bot is not running');
            return;
        }

        await autoBot.stop();
        await ctx.reply('✅ Bot stopped successfully');
    } catch (error) {
        console.error('Error stopping bot:', error);
        await ctx.reply(`❌ Error stopping bot: ${error.message}`);
    }
}

module.exports = handler;
