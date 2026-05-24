import { insertFunnelEvent, getRecentlyApprovedUsers, userHasActivity } from './db.js';
const CHANNEL_ID = parseInt(process.env.CHANNEL_ID ?? '-1002766084283', 10);
const ADMIN_CONTACT_LINK = process.env.ADMIN_CONTACT_LINK ?? 'https://t.me/shiloh_is_10xing';
export function setupChannelHandlers(bot) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    bot.on('chat_join_request', async (ctx) => {
        const req = ctx.chatJoinRequest;
        if (!req)
            return;
        const chatId = req.chat?.id;
        const userId = req.from?.id;
        if (!chatId || !userId)
            return;
        if (chatId !== CHANNEL_ID)
            return;
        insertFunnelEvent('channel_join_requested', JSON.stringify({ telegram_id: userId }));
        try {
            await ctx.telegram.approveChatJoinRequest(chatId, userId);
            console.log(`[channel] auto-approved user ${userId}`);
            insertFunnelEvent('channel_join_approved', JSON.stringify({ telegram_id: userId }));
            await sendWelcomeMessage(ctx.telegram, userId);
        }
        catch (err) {
            console.error(`[channel] failed to approve user ${userId}:`, err instanceof Error ? err.message : err);
        }
    });
}
async function sendWelcomeMessage(telegram, userId) {
    const welcomeText = `🎉 *Welcome to 10x Signals!*\n\n` +
        `You're now in the #1 IQ Option trading community.\n\n` +
        `The 10x bot places high-probability trades using real market analysis:\n` +
        `• RSI + EMA + MACD + Bollinger Bands\n` +
        `• Smart Recovery (martingale)\n` +
        `• Live & Demo trading\n\n` +
        `*Start trading in 60 seconds 👇*`;
    try {
        await telegram.sendMessage(userId, welcomeText, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[{ text: '🚀 Start Trading Now', callback_data: 'ui:trade' }]],
            },
        });
        console.log(`[channel] welcome message sent to ${userId}`);
        insertFunnelEvent('channel_welcome_sent', JSON.stringify({ telegram_id: userId }));
    }
    catch (err) {
        console.error(`[channel] failed to send welcome to ${userId}:`, err instanceof Error ? err.message : err);
    }
}
export function startWelcomeFollowUp(bot) {
    const sentFollowUps = new Set();
    setInterval(async () => {
        try {
            const pending = getRecentlyApprovedUsers(20);
            for (const user of pending) {
                if (sentFollowUps.has(user.telegram_id))
                    continue;
                if (userHasActivity(user.telegram_id)) {
                    sentFollowUps.add(user.telegram_id);
                    continue;
                }
                try {
                    await bot.telegram.sendMessage(user.telegram_id, `👋 *Still there?*\n\nWe noticed you haven't started trading yet.\n\n` +
                        `The bot is online and signals are firing right now.\n\n` +
                        `Tap below to begin 👇`, {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [[
                                    { text: '🔗 Connect IQ Option', callback_data: 'ui:trade' },
                                    { text: '👤 Contact Admin', url: ADMIN_CONTACT_LINK },
                                ]],
                        },
                    });
                    sentFollowUps.add(user.telegram_id);
                    insertFunnelEvent('channel_followup_sent', JSON.stringify({ telegram_id: user.telegram_id }));
                }
                catch {
                    // User may have blocked the bot
                    sentFollowUps.add(user.telegram_id);
                }
            }
            if (sentFollowUps.size > 10_000)
                sentFollowUps.clear();
        }
        catch (err) {
            console.error('[channel] follow-up error:', err instanceof Error ? err.message : err);
        }
    }, 5 * 60 * 1000);
}
