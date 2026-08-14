import { createRequire } from 'module';
const require = createRequire('/root/iqbot-v3/_probe_bot_a.mjs');
const Database = require('better-sqlite3');
const db = new Database('/root/iqbot-v3/iqbot-v3.db', { readonly: true });

const testUser = db.prepare("SELECT value FROM config WHERE key='test_user'").get();
console.log('test_user row:', testUser);
const featuresPaused = db.prepare("SELECT value FROM config WHERE key='features_paused'").get();
console.log('features_paused:', featuresPaused);
const mg = db.prepare("SELECT value FROM config WHERE key='maintenance_gate'").get();
console.log('maintenance_gate:', mg);

const c = db.prepare(`SELECT u.telegram_id AS telegram_id, u.ssid AS ssid, u.funded_balance_usd AS funded_balance_usd
    FROM users u WHERE u.approval_status='approved' AND u.telegram_id=? AND u.telegram_id != ?`).get(6622587977, 1615652240);
console.log('candidate:', c);

const last = db.prepare('SELECT MAX(created_at) AS ts FROM trades WHERE telegram_id=?').get(6622587977);
console.log('last trade:', last);
const cutoff = new Date(Date.now() - 60 * 60_000).toISOString().slice(0, 19).replace('T', ' ');
const recent = db.prepare('SELECT MAX(created_at) AS ts FROM trades WHERE telegram_id=? AND created_at >= ?').get(6622587977, cutoff);
console.log('cutoff:', cutoff, '| tradedRecently row:', recent);

const checkin = db.prepare('SELECT sent_at, window FROM checkin_sent WHERE telegram_id=? ORDER BY sent_at DESC LIMIT 2').all(6622587977);
console.log('last checkins:', checkin);
db.close();
