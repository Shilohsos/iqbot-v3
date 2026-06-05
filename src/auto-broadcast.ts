import { Telegraf } from 'telegraf';
import {
    getEnabledAutoMessages, getBroadcastTargetIds, markBroadcastSent,
    getTestUserId, getNextBroadcastAt, saveNextBroadcastAt,
    getMessageIndex, saveMessageIndex,
    getLastBroadcastMsgId, saveLastBroadcastMsgId,
} from './db.js';

const RATE_LIMIT_MS = 50;
const INTERVAL_MS   = 3_600_000; // 1 hour

async function fireBroadcast(bot: Telegraf): Promise<void> {
    const messages = getEnabledAutoMessages().filter(m => m.image_file_id != null);
    if (messages.length === 0) {
        console.log('[auto-broadcast] skipped — no messages with images yet');
        return;
    }

    const idx = getMessageIndex();
    const msg = messages[idx % messages.length];
    saveMessageIndex(idx + 1);

    const testUserId = getTestUserId();
    let targets: number[];
    if (testUserId) {
        console.log(`[test-mode] sending only to test user ${testUserId}`);
        targets = [testUserId];
    } else {
        targets = getBroadcastTargetIds().filter(id => id > 0);
        if (targets.length === 0) {
            console.log('[auto-broadcast] skipped — no eligible users in DB');
            return;
        }
    }

    let sent = 0;
    for (const tid of targets) {
        try {
            // Delete previous broadcast message (DB-persisted — survives restarts)
            const prevMsgId = getLastBroadcastMsgId(tid);
            if (prevMsgId) {
                try { await bot.telegram.deleteMessage(tid, prevMsgId); } catch {}
            }

            const sentMsg = await bot.telegram.sendPhoto(tid, msg.image_file_id!, {
                caption: msg.content,
                reply_markup: { inline_keyboard: [[{ text: 'Trade Now 👇', callback_data: 'ui:trade' }]] },
            });
            saveLastBroadcastMsgId(tid, sentMsg.message_id);
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

function scheduleNext(bot: Telegraf): void {
    const nextAt = new Date(Date.now() + INTERVAL_MS);
    saveNextBroadcastAt(nextAt.toISOString());
    console.log('[auto-broadcast] next broadcast in 1.0h');

    setTimeout(async () => {
        try {
            await fireBroadcast(bot);
        } catch (err) {
            console.error('[auto-broadcast] error:', err instanceof Error ? err.message : err);
        }
        scheduleNext(bot);
    }, INTERVAL_MS);
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
                scheduleNext(bot);
            }, msUntil);
        } else {
            console.log('[auto-broadcast] past due — firing in 30s grace period');
            setTimeout(async () => {
                try {
                    await fireBroadcast(bot);
                } catch (err) {
                    console.error('[auto-broadcast] error:', err instanceof Error ? err.message : err);
                }
                scheduleNext(bot);
            }, 30_000);
        }
    } else {
        scheduleNext(bot);
    }
    console.log('[auto-broadcast] started (1h fixed interval, image-gated, DB-persisted, persistent auto-delete)');
}
