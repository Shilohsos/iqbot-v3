import { Telegraf } from 'telegraf';
import {
    getEnabledAutoMessages, getBroadcastTargetIds, markBroadcastSent,
    getTestUserId, getNextBroadcastAt, saveNextBroadcastAt,
    getMessageIndex, saveMessageIndex,
    getLastBroadcastMsgId, saveLastBroadcastMsgId,
    getConfig, getUser,
} from './db.js';
import { resolveUsername } from './pidgin.js';

const RATE_LIMIT_MS = 50;
const INTERVAL_MS   = 3_600_000; // 1 hour
const NAME_CACHE_TTL = 10 * 60 * 1000; // 10 min

const nameCache = new Map<number, { name: string; expires: number }>();

async function resolveName(bot: Telegraf, telegramId: number): Promise<string> {
    const cached = nameCache.get(telegramId);
    if (cached && cached.expires > Date.now()) return cached.name;
    try {
        const chat = await bot.telegram.getChat(telegramId);
        const name = (chat as any).first_name ?? 'there';
        nameCache.set(telegramId, { name, expires: Date.now() + NAME_CACHE_TTL });
        return name;
    } catch {
        return 'there';
    }
}

async function fireBroadcast(bot: Telegraf): Promise<void> {
    if (getConfig('features_paused') === '1') {
        console.log('[auto-broadcast] skipped — features_paused');
        return;
    }
    const messages = getEnabledAutoMessages().filter(m => m.image_file_id != null);
    if (messages.length === 0) {
        console.log('[auto-broadcast] skipped — no messages with images yet');
        return;
    }

    const cooldownRaw = getConfig('manual_broadcast_cooldown');
    if (cooldownRaw) {
        const cooldownUntil = new Date(cooldownRaw).getTime();
        if (Date.now() < cooldownUntil) {
            console.log('[auto-broadcast] skipped — manual broadcast cooldown active');
            return;
        }
    }

    const idx = getMessageIndex();
    const msg = messages[idx % messages.length];
    saveMessageIndex(idx + 1);

    const testUserId = getTestUserId();
    let targets: number[];
    if (testUserId) {
        targets = [testUserId];
    } else {
        targets = getBroadcastTargetIds()
            .filter(id => id > 0)
            .filter(tid => {
                const u = getUser(tid);
                if (!u) return false;
                return (u.funded_balance_usd ?? 0) > 0
                    || u.access_level === 'ai_trading'
                    || u.access_level === 'auto_trading';
            });
        if (targets.length === 0) {
            console.log('[auto-broadcast] skipped — no eligible users');
            return;
        }
    }

    let sent = 0;
    for (const tid of targets) {
        try {
            const prevMsgId = getLastBroadcastMsgId(tid);
            if (prevMsgId) {
                try { await bot.telegram.deleteMessage(tid, prevMsgId); } catch {}
            }

            const name = await resolveName(bot, tid);
            const personalized = resolveUsername(msg.content, name);

            const sentMsg = await bot.telegram.sendPhoto(tid, msg.image_file_id!, {
                caption: personalized,
                reply_markup: { inline_keyboard: [[{ text: 'Trade Now', callback_data: 'ui:trade_menu' }]] },
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
        console.log('[auto-broadcast] sent to ' + sent + '/' + targets.length);
    }
}

function scheduleNext(bot: Telegraf): void {
    const nextAt = new Date(Date.now() + INTERVAL_MS);
    saveNextBroadcastAt(nextAt.toISOString());
    console.log('[auto-broadcast] next broadcast in 1.0h');

    setTimeout(async () => {
        try { await fireBroadcast(bot); } catch {}
        scheduleNext(bot);
    }, INTERVAL_MS);
}

export function startAutoBroadcast(bot: Telegraf): void {
    const saved = getNextBroadcastAt();
    if (saved) {
        const msUntil = new Date(saved).getTime() - Date.now();
        if (msUntil > 0) {
            setTimeout(async () => {
                try { await fireBroadcast(bot); } catch {}
                scheduleNext(bot);
            }, msUntil);
        } else {
            setTimeout(async () => {
                try { await fireBroadcast(bot); } catch {}
                scheduleNext(bot);
            }, 30_000);
        }
    } else {
        scheduleNext(bot);
    }
    console.log('[auto-broadcast] started (1h, segment-gated, @username support)');
}
