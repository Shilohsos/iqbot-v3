// Fetch live balances of all active traders today
import { ClientSdk, SsidAuthMethod, BalanceType } from './index.js';
import { WS_URL, PLATFORM_ID, IQ_HOST } from './protocol.js';
import Database from 'better-sqlite3';
import * as path from 'path';

const db = new Database(path.join(process.cwd(), 'iqbot-v3.db'));

interface Trader {
    telegram_id: number;
    ssid: string;
    username?: string | null;
    iq_user_id?: number | null;
}

const traders = db.prepare(`
    SELECT DISTINCT u.telegram_id, u.ssid, u.username, u.iq_user_id
    FROM trades t
    JOIN users u ON u.telegram_id = t.telegram_id
    WHERE date(t.created_at) = date('now')
      AND u.ssid IS NOT NULL AND u.ssid != ''
    ORDER BY u.telegram_id
`).all() as Trader[];

console.log(`Found ${traders.length} traders with SSIDs today.\n`);

const results: Array<{ id: number; username: string; iqId: number | null; demo: string; real: string; ssidValid: boolean }> = [];

for (const t of traders) {
    try {
        const sdk = await ClientSdk.create(WS_URL, PLATFORM_ID, new SsidAuthMethod(t.ssid), { host: IQ_HOST });
        try {
            const balances = await sdk.balances();
            const all = balances.getBalances();
            const demo = all.find(b => b.type === BalanceType.Demo);
            const real = all.find(b => b.type === BalanceType.Real) ?? all.find(b => b.type === undefined);
            results.push({
                id: t.telegram_id,
                username: t.username || '?',
                iqId: t.iq_user_id ?? null,
                demo: demo ? `${demo.amount.toFixed(2)} ${demo.currency || 'USD'}` : '—',
                real: real ? `${real.amount.toFixed(2)} ${real.currency || 'USD'}` : '—',
                ssidValid: true,
            });
        } finally {
            await sdk.shutdown();
        }
    } catch (err: any) {
        results.push({
            id: t.telegram_id,
            username: t.username || '?',
            iqId: t.iq_user_id ?? null,
            demo: '—',
            real: '—',
            ssidValid: false,
        });
    }
}

// Print results
console.log('ID | Username | IQ ID | Demo | Real | SSID');
console.log('—'.repeat(80));
for (const r of results) {
    const ssidStatus = r.ssidValid ? '✓' : '✗';
    console.log(`${r.id} | ${r.username.padEnd(20)} | ${String(r.iqId || '—').padEnd(9)} | ${r.demo.padEnd(15)} | ${r.real.padEnd(15)} | ${ssidStatus}`);
}

const withReal = results.filter(r => r.real !== '—' && !r.real.startsWith('0.00'));
console.log(`\n--- Funded traders: ${withReal.length} ---`);
for (const r of withReal) {
    console.log(`${r.id} | ${r.username} | ${r.iqId || '—'} | ${r.real}`);
}
