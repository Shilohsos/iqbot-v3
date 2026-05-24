import { getEnabledAutoMessages, getInactiveTraderIds, markBroadcastSent } from './db.js';
const BROADCAST_INTERVAL_MS = 30 * 60 * 1000; // every 30 minutes
const INACTIVE_HOURS = 2;
const RATE_LIMIT_MS = 50;
let messageIndex = 0;
export function startAutoBroadcast(bot) {
    setInterval(async () => {
        try {
            const messages = getEnabledAutoMessages();
            if (messages.length === 0)
                return;
            const msg = messages[messageIndex % messages.length];
            messageIndex++;
            const targets = getInactiveTraderIds(INACTIVE_HOURS);
            if (targets.length === 0)
                return;
            const batchSize = Math.max(1, Math.floor(targets.length * 0.3));
            const shuffled = [...targets].sort(() => Math.random() - 0.5).slice(0, batchSize);
            let sent = 0;
            for (const tid of shuffled) {
                try {
                    if (msg.image_file_id) {
                        await bot.telegram.sendPhoto(tid, msg.image_file_id, {
                            caption: msg.content,
                            reply_markup: { inline_keyboard: [[{ text: 'Trade Now 👇', callback_data: 'ui:trade' }]] },
                        });
                    }
                    else {
                        await bot.telegram.sendMessage(tid, msg.content, {
                            reply_markup: { inline_keyboard: [[{ text: 'Trade Now 👇', callback_data: 'ui:trade' }]] },
                        });
                    }
                    sent++;
                }
                catch {
                    // user blocked or unavailable
                }
                await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
            }
            if (sent > 0) {
                markBroadcastSent(msg.id, sent);
                console.log(`[auto-broadcast] msg#${msg.id} sent to ${sent}/${shuffled.length} targets`);
            }
        }
        catch (err) {
            console.error('[auto-broadcast] interval error:', err instanceof Error ? err.message : err);
        }
    }, BROADCAST_INTERVAL_MS);
    console.log('[auto-broadcast] started (30min interval, 2h idle threshold)');
}
