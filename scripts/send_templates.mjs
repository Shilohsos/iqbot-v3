import { createRequire } from 'module';
import Database from 'better-sqlite3';

const require = createRequire(import.meta.url);
const TOKEN = process.env.BOT_TOKEN;
const SHARA = 6622587977;
const API = `https://api.telegram.org/bot${TOKEN}`;

const db = new Database('/root/iqbot-v3/iqbot-v3.db');
const rows = db.prepare(`SELECT key, category, message, button_text, button_url FROM templates ORDER BY category, key`).all();

async function sendOne(row) {
    const label = `[${row.category}]`;
    const text = `${label} ${row.key}\n\n${row.message}`;

    const btn = row.button_text && row.button_url
        ? { inline_keyboard: [[{ text: row.button_text, url: row.button_url }]] }
        : undefined;

    const body = {
        chat_id: SHARA,
        text,
        parse_mode: 'Markdown',
    };
    if (btn) body.reply_markup = btn;

    try {
        const res = await fetch(`${API}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await res.json();
        if (data.ok) {
            return { ok: true };
        }
        // Retry without markdown
        delete body.parse_mode;
        const res2 = await fetch(`${API}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data2 = await res2.json();
        return { ok: data2.ok, desc: data2.description };
    } catch (e) {
        return { ok: false, desc: e.message };
    }
}

console.log(`Sending ${rows.length} templates to Shara (${SHARA})...\n`);
let sent = 0, failed = 0;

for (const row of rows) {
    const result = await sendOne(row);
    if (result.ok) {
        console.log(`  OK: ${row.key}`);
        sent++;
    } else {
        console.log(`  FAIL: ${row.key} — ${result.desc}`);
        failed++;
    }
    await new Promise(r => setTimeout(r, 300));
}

console.log(`\nDone: ${sent} sent, ${failed} failed`);
db.close();
