// One-shot broadcast of the Compounding Guide teaser to ALL bot users.
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

const TEXT = `✦ THE 10X COMPOUNDING GUIDE IS LIVE

This is the restart you've been waiting for.

If you've lost money trading, you know exactly how this story usually goes. Same mistakes. Same result.

This guide changes the story.

· Start small — $10, $50, $500
· The compounding method that protects every dollar
· One goal, one cycle — nothing leaves the account until it lands
· The routine that gives you the absolute best start

Everything you lost, you can rebuild — the right way this time.

Get your copy 👇
@shiloh_is_10xing

— 10x AI 🛥️`;

const API = `https://api.telegram.org/bot${TOKEN}`;
const send = async (chatId) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${API}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: TEXT }),
      });
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

// All users who can receive: approved + pending (bot-a loop targets both).
const Database = (await import('better-sqlite3')).default;
const db = new Database(path.join(__dirname, 'iqbot-v3.db'));
const users = db.prepare("SELECT telegram_id FROM users WHERE approval_status IN ('approved','pending') AND telegram_id != ?").all(1615652240);

let ok = 0, fail = 0;
const CHUNK = 100;
for (let i = 0; i < users.length; i += CHUNK) {
  const chunk = users.slice(i, i + CHUNK);
  const results = await Promise.all(chunk.map(u => send(u.telegram_id)));
  ok += results.filter(r => r === 'ok').length;
  fail += results.filter(r => r !== 'ok').length;
  console.log(`progress ${Math.min(i + CHUNK, users.length)}/${users.length} ok=${ok} fail=${fail}`);
}
console.log(`DONE ok=${ok} fail=${fail} total=${users.length}`);
