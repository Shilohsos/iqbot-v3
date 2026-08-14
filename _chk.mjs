import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const db = require('better-sqlite3')('/root/iqbot-v3/iqbot-v3.db');
import { sdkPool } from '/root/iqbot-v3/dist/sdk-pool.js';
const uid = 6622587977;
const row = db.prepare('SELECT ssid FROM users WHERE telegram_id = ?').get(uid);
if (!row || !row.ssid) { console.log('No SSID'); process.exit(1); }
try {
    const sdk = await sdkPool.get(uid, row.ssid);
    const bal = await sdk.balances();
    for (const b of bal.getBalances()) console.log(b.type, b.amount, b.currency);
    sdkPool.release(uid);
} catch (e) {
    console.log('Error:', e.message);
}
process.exit(0);
