import { Telegraf } from 'telegraf';
import { insertFunnelEvent, getRecentlyApprovedUsers, userHasActivity } from './db.js';
import { onboardKeyboard } from './ui/user.js';

const CHANNEL_ID    = parseInt(process.env.CHANNEL_ID ?? '-1002766084283', 10);
const ASSETS_DIR    = process.env.ASSETS_DIR ?? '/root/iqbot-v3/assets';
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

            await sendOnboarding(ctx.telegram, userId);
        } catch (err) {
            console.error(`[channel] failed to approve user ${userId}:`, err instanceof Error ? err.message : err);
        }
    });
}

/**
 * Send the same onboarding flow that /start triggers for new/unconnected users.
 * This is the full funnel experience — brand intro → account connection choice.
 */
async function sendOnboarding(telegram: Telegraf['telegram'], userId: number): Promise<void> {
    try {
        // L1 — Welcome brand intro
        try { await telegram.sendPhoto(userId, { source: `${ASSETS_DIR}/L1.png` }); } catch {}
        await telegram.sendMessage(userId,
            `I'm 10x Special Bot.\n\n` +
            `The smartest semi auto-trading bot for IQ Option OTC pairs.\n\n` +
            `I scan markets. I read signals. I place trades.\n` +
            `You sit back and watch the wins land.`
        );

        // L3 — Link Your Account
        try { await telegram.sendPhoto(userId, { source: `${ASSETS_DIR}/L3.png` }); } catch {}
        await telegram.sendMessage(userId,
            `Connect your IQ Option account.\n\n` +
            `Free signup · 60 seconds · Linked instantly.\n` +
            `Bot trades on your account. Money stays yours.\n\n` +
            `Pick what fits 👇`,
            { reply_markup: onboardKeyboard() }
        );

        console.log(`[channel] onboarding sent to ${userId}`);
        insertFunnelEvent('channel_welcome_sent', JSON.stringify({ telegram_id: userId }));
    } catch (err) {
        console.error(`[channel] failed to send onboarding to ${userId}:`, err instanceof Error ? err.message : err);
    }
}

export function startWelcomeFollowUp(bot: Telegraf): void {
    const sentFollowUps = new Set<number>();

    setInterval(async () => {
        try {
            const pending = getRecentlyApprovedUsers(20);
            for (const user of pending) {
                if (sentFollowUps.has(user.telegram_id)) continue;
                if (userHasActivity(user.telegram_id)) {
                    sentFollowUps.add(user.telegram_id);
                    continue;
                }
                try {
                    await bot.telegram.sendMessage(
                        user.telegram_id,
                        `👋 *Still there?*\n\nWe noticed you haven't started trading yet.\n\n` +
                        `The bot is online and signals are firing right now.\n\n` +
                        `Tap below to begin 👇`,
                        {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                inline_keyboard: [[
                                    { text: '🔗 Connect IQ Option', callback_data: 'ui:trade' },
                                    { text: '👤 Contact Admin', url: process.env.ADMIN_CONTACT_LINK ?? 'https://t.me/shiloh_is_10xing' },
                                ]],
                            },
                        }
                    );
                    sentFollowUps.add(user.telegram_id);
                    insertFunnelEvent('channel_followup_sent', JSON.stringify({ telegram_id: user.telegram_id }));
                } catch {
                    // User may have blocked the bot
                    sentFollowUps.add(user.telegram_id);
                }
            }
            // Keep set bounded; drop the oldest half rather than clearing
            // entirely, so users we've already messaged don't get spammed again.
            if (sentFollowUps.size > 10_000) {
                const keep = Array.from(sentFollowUps).slice(5_000);
                sentFollowUps.clear();
                for (const id of keep) sentFollowUps.add(id);
            }
        } catch (err) {
            console.error('[channel] follow-up error:', err instanceof Error ? err.message : err);
        }
    }, 5 * 60 * 1000);
}
