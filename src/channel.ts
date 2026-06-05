import { Telegraf } from 'telegraf';
import { insertFunnelEvent } from './db.js';

const CHANNEL_ID    = parseInt(process.env.CHANNEL_ID ?? '-1002766084283', 10);
const META_TRACK_URL = process.env.META_TRACK_URL ?? 'http://localhost:8766/track';

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

            // Fire Meta CompleteRegistration — tells Meta this ad click became a channel join
            const lang: string = (req.from as any)?.language_code ?? '';
            const eventId = `cr_${userId}_${Date.now()}`;
            fetch(META_TRACK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    event_name: 'CompleteRegistration',
                    event_source_url: 'https://t.me/10xpremium',
                    event_id: eventId,
                    custom_data: { source: 'telegram_channel', telegram_id: userId, language_code: lang },
                    skip_ip: true,
                }),
            }).then(() => {
                console.log(`[meta] CompleteRegistration sent for user ${userId}`);
            }).catch((err: unknown) => {
                console.error(`[meta] failed to send join event for ${userId}:`, err);
            });

            // Send simple welcome with Start Bot button
            const botUsername = process.env.BOT_USERNAME ?? 'Shiloh10xbot';
            await ctx.telegram.sendMessage(userId,
                'Welcome to 10x Special Bot 💜\n\n' +
                'Tap the button below to start and connect your IQ Option account.',
                {
                    reply_markup: {
                        inline_keyboard: [[
                            { text: '🚀 Start Bot', url: `https://t.me/${botUsername}?start` },
                        ]],
                    },
                }
            );
            insertFunnelEvent('channel_welcome_sent', JSON.stringify({ telegram_id: userId }));
        } catch (err) {
            console.error(`[channel] failed to approve user ${userId}:`, err instanceof Error ? err.message : err);
        }
    });
}
