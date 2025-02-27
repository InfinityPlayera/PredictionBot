const AutoBot = require('../services/autobot');

let autoBot = null;

const startbotHandler = async (ctx) => {
    try {
        if (autoBot && autoBot.isRunning) {
            await ctx.reply('Bot is already running!');
            return;
        }

        autoBot = new AutoBot(ctx.telegram);
        await autoBot.start();
        await ctx.reply('Bot started successfully!');
    } catch (error) {
        await ctx.reply(`Error starting bot: ${error.message}`);
    }
};

module.exports = {
    handler: startbotHandler,
    getAutoBot: () => autoBot
};
