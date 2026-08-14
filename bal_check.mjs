import { sdkPool } from './dist/sdk-pool.js';
import Database from 'better-sqlite3';

const db = new Database('./iqbot-v3.db');
const row = db.prepare('SELECT ssid FROM users WHERE telegram_id = 6132539974').get();
if (!row) { console.log('User not found'); process.exit(0); }
if (!row.ssid) { console.log('No SSID'); process.exit(0); }

const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT')), 12000));

(async () => {
  try {
    const sdk = await Promise.race([sdkPool.get(6132539974, row.ssid), timeout]);
    await sdk.changeBalance(1);
    await new Promise(r => setTimeout(r, 2000));
    const real = await sdk.getBalance();
    console.log('REAL:', JSON.stringify(real));
    sdkPool.release(6132539974);
  } catch(e) {
    console.log('ERROR:', e.message);
    try { sdkPool.release(6132539974); } catch {}
    process.exit(1);
  }
  process.exit(0);
})();
