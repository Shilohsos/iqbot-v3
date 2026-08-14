import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire('/root/iqbot-v3/_resend_archetype.mjs');
const Database = require('better-sqlite3');

const KEY = process.argv[2]?.toUpperCase() ?? 'A';
const env = {};
for (const line of fs.readFileSync('/root/iqbot-v3/.env', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
}
const TOKEN = env.BOT_TOKEN;
const db = new Database('/root/iqbot-v3/iqbot-v3.db', { readonly: false });
const UID = 6622587977;

const tpl = db.prepare('SELECT copy, buttons, image_file FROM bot_a_templates WHERE key=?').get(KEY);
if (!tpl) { console.log('NO TEMPLATE for key ' + KEY); process.exit(1); }

// Placeholder resolution (mirrors the engine).
const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const pool = (k) => { const r = db.prepare('SELECT items FROM bot_a_pools WHERE key=?').get(k); try { const p = JSON.parse(r?.items ?? '[]'); return p.length ? p : null; } catch { return null; } };
const names = pool('names') ?? ['a member'];
const amounts = pool('amounts') ?? ['+$350'];
// No-repeat bag: cycle the shuffled pool; reshuffle only when exhausted.
const bags = new Map();
function pickNoRepeat(poolKey, items) {
    if (items.length === 1) return items[0];
    let st = bags.get(poolKey);
    if (!st) { st = { bag: [...items].sort(() => Math.random() - 0.5), idx: 0 }; bags.set(poolKey, st); }
    const v = st.bag[st.idx];
    st.idx = (st.idx + 1) % st.bag.length;
    if (st.idx === 0) st.bag = [...items].sort(() => Math.random() - 0.5);
    return v;
}
const PAIRS = ['EURUSD', 'GBPUSD', 'AUDUSD', 'USDCAD', 'GBPJPY', 'EURCHF', 'AUDJPY', 'NZDUSD', 'NZDJPY', 'GBPCHF'];
const TFS = ['30s', '1m', '2m'];
const last = db.prepare('SELECT MAX(created_at) AS ts FROM trades WHERE telegram_id=?').get(UID);
const days = last?.ts ? Math.min(9, Math.max(1, Math.floor((Date.now() - Date.parse(last.ts)) / 86_400_000))) : 9;

const caption = tpl.copy
    .replace(/\{confidence\}/g, () => String(randInt(80, 97)))
    .replace(/\{countdown\}/g, () => String(randInt(2, 5)))
    .replace(/\{pair\}/g, () => `${pick(PAIRS)}-OTC`)
    .replace(/\{tf\}/g, () => pick(TFS))
    .replace(/\{gale\}/g, () => String(randInt(2, 4)))
    .replace(/\{days\}/g, () => String(days))
    .replace(/\{name\}/g, () => pickNoRepeat('names', names))
    .replace(/\{amount\}/g, () => pickNoRepeat('amounts', amounts))
    .replace(/\{spot\}/g, () => resolveSpot('spots', 'promo_private', 'spot_private'))
    .replace(/\{autospot\}/g, () => resolveSpot('autospots', 'promo_auto', 'spot_autopilot'))
    .replace(/\{count\}/g, () => String(randInt(15, 40)))
    .replace(/\{goal\}/g, () => pick(['50', '100', '150']))
    .replace(/\{progress\}/g, () => String(randInt(20, 60)));

function resolveSpot(poolKey, prefix, dailyKey) {
    const today = new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);
    const row = db.prepare('SELECT date, value FROM bot_a_daily WHERE key = ?').get(dailyKey);
    let spot;
    if (row && row.date === today && row.value) spot = row.value;
    else {
        const sp = db.prepare('SELECT items FROM bot_a_pools WHERE key = ?').get(poolKey);
        let arr = [];
        try { arr = JSON.parse(sp?.items ?? '[]'); } catch {}
        spot = arr.length ? arr[Math.floor(Math.random() * arr.length)] : '$20';
        db.prepare('INSERT INTO bot_a_daily (key, date, value) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET date=excluded.date, value=excluded.value').run(dailyKey, today, spot);
    }
    const exp = db.prepare('SELECT value FROM config WHERE key = ?').get(`${prefix}_expires`);
    if (!exp?.value || new Date(exp.value) <= new Date()) {
        const hours = [2, 3, 4, 6][Math.floor(Math.random() * 4)];
        const iso = new Date(Date.now() + hours * 3_600_000).toISOString();
        db.prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(`${prefix}_expires`, iso);
        db.prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(`${prefix}_duration`, `${hours} hour${hours > 1 ? 's' : ''}`);
    }
    db.prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(`${prefix}_spot`, spot.replace('$', ''));
    return spot;
}

let kb;
try {
    const parsed = JSON.parse(tpl.buttons);
    const rows = (Array.isArray(parsed) && Array.isArray(parsed[0]) ? parsed : [parsed]).map(row => row.map(b => b.url ? { text: b.text, url: b.url } : { text: b.text, callback_data: b.callback }));
    kb = { inline_keyboard: rows };
} catch { kb = undefined; }

// Cancel-out: delete the previous nudge.
const prior = db.prepare('SELECT message_id FROM bot_a_sent WHERE telegram_id=?').get(UID);
if (prior?.message_id) {
    await fetch(`https://api.telegram.org/bot${TOKEN}/deleteMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: UID, message_id: prior.message_id }),
    }).then(r => r.json()).then(j => console.log('deleted prior:', j.ok)).catch(() => {});
}

const form = new FormData();
form.append('chat_id', String(UID));
form.append('photo', new Blob([fs.readFileSync(`/root/iqbot-v3/assets/bot-a/${tpl.image_file}`)], { type: 'image/jpeg' }), tpl.image_file);
form.append('caption', caption);
if (kb) form.append('reply_markup', JSON.stringify(kb));

const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendPhoto`, { method: 'POST', body: form });
const j = await res.json();
console.log('sent:', j.ok, j.ok ? `msg_id=${j.result.message_id}` : j.description?.slice(0, 80));

if (j.ok) {
    db.prepare(`INSERT INTO bot_a_sent (telegram_id, message_id, last_archetype, sent_count, sent_date, last_sent_at)
        VALUES (?, ?, ?, COALESCE((SELECT sent_count+1 FROM bot_a_sent WHERE telegram_id=?), 1), ?, datetime('now'))
        ON CONFLICT(telegram_id) DO UPDATE SET message_id=excluded.message_id, last_archetype=excluded.last_archetype,
        sent_count=excluded.sent_count, last_sent_at=excluded.last_sent_at`).run(UID, j.result.message_id, KEY, UID, new Date(Date.now() + 3_600_000).toISOString().slice(0, 10));
    console.log(`bot_a_sent updated (last_archetype=${KEY})`);
}
db.close();
