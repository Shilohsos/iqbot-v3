import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { db } from './db.js';
// Singleton client — stays connected across multiple checks.
let _client = null;
async function getClient() {
    if (_client?.connected)
        return _client;
    const sessionString = process.env.TELETHON_SESSION ?? '';
    const apiId = parseInt(process.env.TELEGRAM_API_ID ?? '', 10);
    const apiHash = process.env.TELEGRAM_API_HASH ?? '';
    if (!sessionString || isNaN(apiId) || !apiHash) {
        throw new Error('Missing env: TELETHON_SESSION, TELEGRAM_API_ID, or TELEGRAM_API_HASH');
    }
    _client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
        connectionRetries: 3,
        baseLogger: undefined,
    });
    await Promise.race([
        _client.connect(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('GramJS connect timeout')), 15_000)),
    ]);
    return _client;
}
/**
 * Search the affiliate tracking channel for a given IQ Option User ID.
 * Throws if required env vars are missing or the Telegram session is invalid.
 */
export async function checkAffiliate(iqUserId) {
    const channelId = process.env.AFFILIATE_CHANNEL_ID ?? '';
    const limit = parseInt(process.env.AFFILIATE_SCAN_LIMIT ?? '200', 10);
    if (!channelId)
        throw new Error('AFFILIATE_CHANNEL_ID not set');
    const client = await getClient();
    const userIdStr = String(iqUserId);
    const messages = await Promise.race([
        client.getMessages(channelId, { limit }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('GramJS getMessages timeout')), 15_000)),
    ]);
    for (const msg of messages) {
        if (msg.text?.includes(userIdStr)) {
            return {
                found: true,
                data: {
                    message: msg.text,
                    date: new Date(msg.date * 1000).toISOString(),
                },
            };
        }
    }

    // Fallback: the channel scan window (last N messages) may have scrolled past
    // this ID's events. Consult lead_events history — if the ID was ever tracked
    // (FTD/redep from the affiliate channel), treat it as verified.
    try {
        const hist = db.prepare(`SELECT event_type, amount, event_date, channel_msg_id
             FROM lead_events
             WHERE iq_user_id = ?
             ORDER BY event_date DESC
             LIMIT 1`).get(iqUserId);
        if (hist) {
            return {
                found: true,
                data: {
                    message: `[history] ${hist.event_type} ${hist.amount} on ${hist.event_date} (msg ${hist.channel_msg_id ?? 'n/a'})`,
                    date: hist.event_date,
                },
            };
        }
    }
    catch {
        // lead_events table may not exist in every deployment — channel scan is the primary check.
    }

    return { found: false, data: null };
}
