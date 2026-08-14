import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire('/root/iqbot-v3/_resend_i.mjs');
const Database = require('better-sqlite3');

const env = {};
for (const line of fs.readFileSync('/root/iqbot-v3/.env', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
}
const TOKEN = env.BOT_TOKEN;
const db = new Database('/root/iqbot-v3/iqbot-v3.db', { readonly: false });
const UID = 6622587977;

// Cancel-out: delete the previous nudge (B) so only this one shows.
const prior = db.prepare('SELECT message_id FROM bot_a_sent WHERE telegram_id=?').get(UID);
if (prior?.message_id) {
    await fetch(`https://api.telegram.org/bot${TOKEN}/deleteMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: UID, message_id: prior.message_id }),
    }).then(r => r.json()).then(j => console.log('deleted prior:', j.ok)).catch(() => {});
}

const caption = '✦ TOP PICK — GBPJPY-OTC\n\nConfidence: 92%\n\nThe engine\u2019s strongest read right now.\n\nTrade it \u2500';
const kb = { inline_keyboard: [[{ text: '✦ Trade Now', callback_data: 'ui:trade' }]] };

const form = new FormData();
form.append('chat_id', String(UID));
form.append('photo', new Blob([fs.readFileSync('/root/iqbot-v3/assets/bot-a/i-top-pick.jpg')], { type: 'image/jpeg' }), 'i-top-pick.jpg');
form.append('caption', caption);
form.append('reply_markup', JSON.stringify(kb));

const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendPhoto`, { method: 'POST', body: form });
const j = await res.json();
console.log('sent:', j.ok, j.ok ? `msg_id=${j.result.message_id}` : j.description?.slice(0, 80));

if (j.ok) {
    db.prepare(`INSERT INTO bot_a_sent (telegram_id, message_id, last_archetype, sent_count, sent_date, last_sent_at)
        VALUES (?, ?, 'I', COALESCE((SELECT sent_count+1 FROM bot_a_sent WHERE telegram_id=?), 1), ?, datetime('now'))
        ON CONFLICT(telegram_id) DO UPDATE SET message_id=excluded.message_id, last_archetype='I',
        sent_count=excluded.sent_count, last_sent_at=excluded.last_sent_at`).run(UID, j.result.message_id, UID, new Date(Date.now() + 3_600_000).toISOString().slice(0, 10));
    console.log('bot_a_sent updated (last_archetype=I)');
}
db.close();
