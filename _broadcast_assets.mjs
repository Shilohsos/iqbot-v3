import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire('/root/iqbot-v3/_broadcast_assets.mjs');
const Database = require('better-sqlite3');

const env = {};
for (const line of fs.readFileSync('/root/iqbot-v3/.env', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
}
const TOKEN = env.BOT_TOKEN;
const db = new Database('/root/iqbot-v3/iqbot-v3.db', { readonly: true });
const users = db.prepare("SELECT telegram_id FROM users WHERE approval_status='approved'").all().map(r => r.telegram_id);
db.close();
console.log(`[broadcast-assets] targets: ${users.length}`);

const TEXT = '✦ NEW ASSETS LIVE\n\nFive new pairs just joined the 10x AI board:\n\n⟡ EURCHF\n⟡ AUDJPY\n⟡ NZDUSD\n⟡ NZDJPY\n⟡ GBPCHF\n\nMore markets. More movement. The engine is already scanning them.\n\n— 10x AI 🛥️';
const KB = { inline_keyboard: [[{ text: '✦ Trade now', callback_data: 'ui:trade' }]] };

const send = (uid) => fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: uid, text: TEXT, reply_markup: KB }),
}).then(async r => {
    const j = await r.json().catch(() => ({}));
    return { uid, ok: j.ok === true, err: j.description ?? '' };
}).catch(e => ({ uid, ok: false, err: String(e) }));

let sent = 0, failed = 0;
const BATCH = 10;
for (let i = 0; i < users.length; i += BATCH) {
    const chunk = users.slice(i, i + BATCH);
    const results = await Promise.all(chunk.map(uid => send(uid)));
    for (const r of results) {
        if (r.ok) sent++; else failed++;
    }
    if ((i / BATCH) % 20 === 0) console.log(`[broadcast-assets] progress ${Math.min(i + BATCH, users.length)}/${users.length} (ok=${sent} fail=${failed})`);
    await new Promise(r => setTimeout(r, 60));
}
console.log(`[broadcast-assets] DONE ok=${sent} fail=${failed} total=${users.length}`);
