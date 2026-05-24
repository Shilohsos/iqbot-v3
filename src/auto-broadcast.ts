import { Telegraf } from 'telegraf';
import { getEnabledAutoMessages, getInactiveTraderIds, markBroadcastSent } from './db.js';

const INACTIVE_HOURS = 2;
const RATE_LIMIT_MS  = 50;

function getRandomIntervalMs(): number {
    const minHours = 2;
    const maxHours = 6;
    return (minHours + Math.random() * (maxHours - minHours)) * 60 * 60 * 1000;
}

// Per-user tracking of the last auto-broadcast message sent
const lastBroadcastMsgIds = new Map<number, number>();

let messageIndex = 0;

export function startAutoBroadcast(bot: Telegraf): void {
    function scheduleNext(): void {
        const delay = getRandomIntervalMs();
        const hours = (delay / 3_600_000).toFixed(1);
        console.log(`[auto-broadcast] next broadcast in ${hours}h`);

        setTimeout(async () => {
            try {
                // Image gate: only send messages that have an uploaded image
                const messages = getEnabledAutoMessages().filter(m => m.image_file_id != null);
                if (messages.length === 0) {
                    console.log('[auto-broadcast] skipped — no messages with images yet');
                    scheduleNext();
                    return;
                }

                const msg = messages[messageIndex % messages.length];
                messageIndex++;

                const targets = getInactiveTraderIds(INACTIVE_HOURS);
                if (targets.length === 0) {
                    console.log('[auto-broadcast] skipped — no inactive targets');
                    scheduleNext();
                    return;
                }

                const batchSize = Math.max(1, Math.floor(targets.length * 0.3));
                const shuffled  = [...targets].sort(() => Math.random() - 0.5).slice(0, batchSize);

                let sent = 0;
                for (const tid of shuffled) {
                    try {
                        // Delete previous broadcast to this user before sending new one
                        const prevMsgId = lastBroadcastMsgIds.get(tid);
                        if (prevMsgId) {
                            try { await bot.telegram.deleteMessage(tid, prevMsgId); } catch {}
                        }

                        const sentMsg = await bot.telegram.sendPhoto(tid, msg.image_file_id!, {
                            caption: msg.content,
                            reply_markup: { inline_keyboard: [[{ text: 'Trade Now 👇', callback_data: 'ui:trade' }]] },
                        });
                        lastBroadcastMsgIds.set(tid, sentMsg.message_id);
                        sent++;
                    } catch {
                        // user blocked or unavailable
                    }
                    await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
                }

                if (sent > 0) {
                    markBroadcastSent(msg.id, sent);
                    console.log(`[auto-broadcast] msg#${msg.id} sent to ${sent}/${shuffled.length} targets`);
                }
            } catch (err) {
                console.error('[auto-broadcast] error:', err instanceof Error ? err.message : err);
            }

            scheduleNext();
        }, delay);
    }

    scheduleNext();
    console.log('[auto-broadcast] started (2-6h random interval, image-gated)');
}
