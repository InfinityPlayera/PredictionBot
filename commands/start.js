const { welcome } = require('../locales/general');

module.exports = async (ctx) => {
    await ctx.replyWithHTML(welcome, {
        parse_mode: 'HTML',
        disable_web_page_preview: true
    });
};
