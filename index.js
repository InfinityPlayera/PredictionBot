// index.js
require('dotenv').config();
require('./config/database').connect();

const bot = require('./config/bot');
const { isPrivateChat } = require('./utils/validation');

const startHandler = require('./commands/start');
const { handler: startbotHandler, getAutoBot } = require('./commands/startbot');
const claimHandler = require('./commands/claim');
const stopHandler = require('./commands/stop');
const statusHandler = require('./commands/status');

bot.start(isPrivateChat, startHandler);
bot.command('startbot', isPrivateChat, startbotHandler);
bot.command('claim', isPrivateChat, claimHandler);
bot.command('stop', isPrivateChat, stopHandler);
bot.command('status', isPrivateChat, statusHandler);

// Add error handler for the bot
bot.catch((error, ctx) => {
    console.error('Bot error:', error);
    ctx.reply(`❌ An error occurred: ${error.message}`).catch(console.error);
});

bot.launch().then(() => {
    console.log('🤖 Telegram Bot successfully launched');
}).catch((error) => {
    console.error('Failed to launch bot:', error);
});

// Rest of your shutdown code remains the same
