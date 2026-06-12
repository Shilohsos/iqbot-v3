import { ClientSdk, SsidAuthMethod } from './dist/index.js';
import database from 'better-sqlite3';

const db = database('./iqbot-v3.db');

// Users who traded in last 48h AND have real balance > 0 OR show signs of having funded
const rows = db.prepare(`
  SELECT DISTINCT u.telegram_id, u.iq_user_id, u.username, u.tier, u.balance_cache, u.ssid 
  FROM users u 
  INNER JOIN trades t ON t.telegram_id = u.telegram_id 
  WHERE t.created_at > datetime('now', '-48 hours')
  AND u.ssid IS NOT NULL AND u.ssid != ''
  AND u.ssid_valid = 1
  ORDER BY u.telegram_id
`).all() as any[];

console.log(`Total users with SSID and trades in 48h: ${rows.length}`);

async function checkUser(row: any): Promise<string> {
  const start = Date.now();
  try {
    const sdk = await ClientSdk.create('wss://ws.iqoption.com/echo/websocket', 4, new SsidAuthMethod(row.ssid), { host: 'iqoption.com' });
    const balances = await sdk.balances();
    const all = balances.getBalances();
    const real = all.find((b: any) => b.type === 'real');
    const demo = all.find((b: any) => b.type === 'demo');
    const profile = (sdk as any).userProfile;
    const actualUserId = profile?.userId;
    await sdk.shutdown();
    
    const elapsed = (Date.now() - start) / 1000;
    const iqIdMatch = row.iq_user_id == actualUserId ? 'MATCH' : 'MISMATCH';
    const realAmt = real?.amount ?? 0;
    const demoAmt = demo?.amount ?? 0;
    const currency = real?.currency ?? 'USD';
    
    // Only report users with non-zero real balance or ID mismatch
    if (realAmt > 0 || iqIdMatch === 'MISMATCH') {
      return `${row.telegram_id}|${row.username || '--'}|${row.iq_user_id || 'NONE'}|${actualUserId || 'NONE'}|${iqIdMatch}|${currency}|${realAmt}|${demoAmt}|${row.tier}|${elapsed.toFixed(1)}s`;
    }
    return null; // skip demo-only with matching IDs
  } catch (err: any) {
    return `${row.telegram_id}|${row.username || '--'}|${row.iq_user_id || 'NONE'}|ERROR|FAIL|${err.message?.substring(0, 60) || 'unknown'}`;
  }
}

(async () => {
  const results: string[] = [];
  const header = 'TelegramID|Username|DB_iqID|SDK_iqID|Match|Currency|RealAmt|DemoAmt|Tier|Time';
  results.push(header);
  
  // Process in batches of 3 with delay
  for (let i = 0; i < rows.length; i += 3) {
    const batch = rows.slice(i, Math.min(i + 3, rows.length));
    const batchResults = await Promise.all(batch.map(r => checkUser(r)));
    for (const r of batchResults) {
      if (r) results.push(r);
    }
    if (i + 3 < rows.length) await new Promise(r => setTimeout(r, 1000));
    if (i % 15 === 0) console.log(`Progress: ${Math.min(i+3, rows.length)}/${rows.length}`);
  }
  
  console.log('\n=== RESULTS ===');
  console.log(results.join('\n'));
  console.log('\n=== DONE ===');
  db.close();
})();
