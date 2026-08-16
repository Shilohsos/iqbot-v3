// Send the guide screenshots (images Master provided) to all bot users via media group.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n')
    .filter(l => l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const TOKEN = env.BOT_TOKEN;
const IMG1 = '/root/.hermes/cache/images/img_569152e48e8d.jpg';
const IMG2 = '/root/.hermes/cache/images/img_dff858e89d4e.jpg';
const CAPTION = `✦ THE 10X COMPOUNDING GUIDE — PART ONE: THE FOUNDATION

The restart, in full.

Read it. Start the cycle.

— 10x AI 🛥️`;

const API = `https://api.telegram.org/bot${TOKEN}`;
const send = async (chatId) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const form = new FormData();
      form.append('chat_id', String(chatId));
      form.append('media', JSON.stringify([
        { type: 'photo', media: 'attach://img1' },
        { type: 'photo', media: 'attach://img2', caption: CAPTION },
      ]));
      form.append('img1', new Blob([fs.readFileSync(IMG1)], { type: 'image/jpeg' }), 'p1.jpg');
      form.append('img2', new Blob([fs.readFileSync(IMG2)], { type: 'image/jpeg' }), 'p2.jpg');
      const res = await fetch(`${API}/sendMediaGroup`, { method: 'POST', body: form });
      if (res.status === 429) {
        const r = await res.json();
        const wait = (r?.parameters?.retry_after ?? 2) * 1000;
        await new Promise(res => setTimeout(res, wait));
        continue;
      }
      return res.status === 200 ? 'ok' : `fail:${res.status}`;
    } catch (e) {
      if (attempt === 2) return 'err';
      await new Promise(res => setTimeout(res, 1500));
    }
  }
  return 'err';
};

const Database = (await import('better-sqlite3')).default;
const db = new Database(path.join(__dirname, 'iqbot-v3.db'));
db.exec('CREATE TABLE IF NOT EXISTS guide_imgs_sent (telegram_id INTEGER PRIMARY KEY, sent_at TEXT)');
const sentSet = new Set(db.prepare('SELECT telegram_id FROM guide_imgs_sent').all().map(r => r.telegram_id));
const users = db.prepare("SELECT telegram_id FROM users WHERE approval_status IN ('approved','pending') AND telegram_id != ?").all(1615652240)
  .filter(u => !sentSet.has(u.telegram_id));

let ok = 0, fail = 0;
const CHUNK = 50;
for (let i = 0; i < users.length; i += CHUNK) {
  const chunk = users.slice(i, i + CHUNK);
  const results = await Promise.all(chunk.map(async u => {
    const r = await send(u.telegram_id);
    if (r === 'ok') db.prepare('INSERT OR IGNORE INTO guide_imgs_sent (telegram_id, sent_at) VALUES (?, ?)').run(u.telegram_id, new Date().toISOString());
    return r;
  }));
  ok += results.filter(r => r === 'ok').length;
  fail += results.filter(r => r !== 'ok').length;
  console.log(`progress ${Math.min(i + CHUNK, users.length)}/${users.length} ok=${ok} fail=${fail} skipped=${sentSet.size}`);
}
console.log(`DONE ok=${ok} fail=${fail} total=${users.length} skipped=${sentSet.size}`);
