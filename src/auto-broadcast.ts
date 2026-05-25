import { Telegraf } from 'telegraf';
import {
    getEnabledAutoMessages, getInactiveTraderIds, markBroadcastSent,
    getTestUserId, getNextBroadcastAt, saveNextBroadcastAt,
} from './db.js';

const INACTIVE_HOURS = 2;
const RATE_LIMIT_MS  = 50;

function getRandomIntervalMs(): number {
    const minHours = 2;
    const maxHours = 6;
    return (minHours + Math.random() * (maxHours - minHours)) * 60 * 60 * 1000;
}

const lastBroadcastMsgIds = new Map<number, number>();
let messageIndex = 0;

async function fireBroadcast(bot: Telegraf): Promise<void> {
    const messages = getEnabledAutoMessages().filter(m => m.image_file_id != null);
    if (messages.length === 0) {
        console.log('[auto-broadcast] skipped — no messages with images yet');
        return;
    }

    const msg = messages[messageIndex % messages.length];
    messageIndex++;

    const testUserId = getTestUserId();
    let targets: number[];
    if (testUserId) {
        console.log(`[test-mode] sending only to test user ${testUserId}`);
        targets = [testUserId];
    } else {
        const inactive = getInactiveTraderIds(INACTIVE_HOURS);
        if (inactive.length === 0) {
            console.log('[auto-broadcast] skipped — no inactive targets');
            return;
        }
        targets = inactive;
    }

    let sent = 0;
    for (const tid of targets) {
        try {
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
        console.log(`[auto-broadcast] msg#${msg.id} sent to ${sent}/${targets.length} targets`);
    }
}

function scheduleNext(bot: Telegraf, delayMs: number): void {
    const nextAt = new Date(Date.now() + delayMs);
    saveNextBroadcastAt(nextAt.toISOString());
    console.log(`[auto-broadcast] next broadcast in ${(delayMs / 3_600_000).toFixed(1)}h`);

    setTimeout(async () => {
        try {
            await fireBroadcast(bot);
        } catch (err) {
            console.error('[auto-broadcast] error:', err instanceof Error ? err.message : err);
        }
        scheduleNext(bot, getRandomIntervalMs());
    }, delayMs);
}

export function startAutoBroadcast(bot: Telegraf): void {
    const saved = getNextBroadcastAt();
    if (saved) {
        const msUntil = new Date(saved).getTime() - Date.now();
        if (msUntil > 0) {
            console.log(`[auto-broadcast] resuming — fires in ${(msUntil / 3_600_000).toFixed(1)}h`);
            setTimeout(async () => {
                try {
                    await fireBroadcast(bot);
                } catch (err) {
                    console.error('[auto-broadcast] error:', err instanceof Error ? err.message : err);
                }
                scheduleNext(bot, getRandomIntervalMs());
            }, msUntil);
        } else {
            console.log('[auto-broadcast] past due — firing in 30s grace period');
            setTimeout(async () => {
                try {
                    await fireBroadcast(bot);
                } catch (err) {
                    console.error('[auto-broadcast] error:', err instanceof Error ? err.message : err);
                }
                scheduleNext(bot, getRandomIntervalMs());
            }, 30_000);
        }
    } else {
        scheduleNext(bot, getRandomIntervalMs());
    }
    console.log('[auto-broadcast] started (2-6h random interval, image-gated, DB-persisted)');
}
