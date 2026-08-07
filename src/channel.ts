import { Telegraf } from 'telegraf';
import { insertFunnelEvent } from './db.js';

const CHANNEL_ID    = parseInt(process.env.CHANNEL_ID ?? '-1002766084283', 10);

export function setupChannelHandlers(bot: Telegraf): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    bot.on('chat_join_request', async (ctx: any) => {
        const req = ctx.chatJoinRequest;
        if (!req) return;

        const chatId: number = req.chat?.id;
        const userId: number = req.from?.id;
        if (!chatId || !userId) return;

        if (chatId !== CHANNEL_ID) return;

        insertFunnelEvent('channel_join_requested', JSON.stringify({ telegram_id: userId }));

        try {
            await ctx.telegram.approveChatJoinRequest(chatId, userId);
            console.log(`[channel] auto-approved user ${userId}`);
            insertFunnelEvent('channel_join_approved', JSON.stringify({ telegram_id: userId }));
        } catch (err) {
            console.error(`[channel] failed to approve user ${userId}:`, err instanceof Error ? err.message : err);
        }
    });
}
