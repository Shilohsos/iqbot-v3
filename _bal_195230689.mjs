import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const db = require('better-sqlite3')('./iqbot-v3.db');
import { sdkPool } from './dist/sdk-pool.js';
const row = db.prepare('SELECT ssid, cred FROM users WHERE iq_user_id = ?').get(195230689);
console.log('ssid_len:', row.ssid ? row.ssid.length : 0, 'cred:', row.cred ? 'set' : 'none');
const sdk = await sdkPool.get(195230689, row.ssid);
try {
  const bal = await sdk.balances();
  for (const b of bal.getBalances()) console.log('balance:', b.type, b.amount, b.currency);
} catch (e) {
  console.log('SDK error:', e.message);
}
sdkPool.release(195230689);
process.exit(0);
