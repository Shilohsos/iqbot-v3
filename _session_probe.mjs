// One-shot session probe: connects with TELETHON_SESSION and reports who wins.
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import fs from 'fs';

const env = fs.readFileSync('/root/iqbot-v3/.env', 'utf8');
const get = (k) => { const m = env.match(new RegExp('^' + k + '=(.*)$', 'm')); return m ? m[1].trim() : ''; };
const session = get('TELETHON_SESSION');
const apiId = parseInt(get('TELEGRAM_API_ID'), 10);
const apiHash = get('TELEGRAM_API_HASH');

const client = new TelegramClient(new StringSession(session), apiId, apiHash, { connectionRetries: 1, baseLogger: undefined });
try {
    await client.connect();
    const me = await client.getMe();
    console.log('PROBE OK — session free, account:', me.username ?? me.id);
} catch (e) {
    console.log('PROBE FAILED:', e.message ?? String(e));
} finally {
    try { client.disconnect(); } catch { /* noop */ }
    process.exit(0);
}
