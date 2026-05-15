import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
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
    return { found: false, data: null };
}
