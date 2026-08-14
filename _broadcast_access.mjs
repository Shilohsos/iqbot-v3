import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
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
console.log(`[broadcast] targets: ${users.length}`);

const TEXT = '✦ ACCESS UPDATE — THE ENTRY JUST GOT CLOSER\n\nPrivate Trader — now unlocked at just $50 funded.\nAutopilot — now unlocked at just $200 funded.\n\nFund your account today and connect — your access opens immediately.\n\nSend your User ID to @shiloh_is_10xing once funded.\n\n— 10x AI 🛥️';
const KB = { inline_keyboard: [[{ text: '✦ Fund now', url: 'https://iqoption.com/pwa/payments/deposit' }]] };

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
        if (r.ok) sent++; else { failed++; console.log(`[broadcast] fail ${r.uid}: ${r.err.slice(0, 80)}`); }
    }
    if ((i / BATCH) % 20 === 0) console.log(`[broadcast] progress ${Math.min(i + BATCH, users.length)}/${users.length} (ok=${sent} fail=${failed})`);
    await new Promise(r => setTimeout(r, 60));
}
console.log(`[broadcast] DONE ok=${sent} fail=${failed} total=${users.length}`);
