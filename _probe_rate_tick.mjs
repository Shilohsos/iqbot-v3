import 'dotenv/config';
import { createSdk } from './dist/trade.js';
import { db, getAdminSsid } from './dist/db.js';

const withTimeout = (p, ms, label) => Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timed out`)), ms)),
]);

const ssid = getAdminSsid() || process.env.IQ_SSID;
console.log('using admin ssid (len):', ssid?.length);
const sdk = await withTimeout(createSdk(ssid), 45_000, 'createSdk');
try {
    const blitz = await withTimeout(sdk.blitzOptions(), 20_000, 'blitzOptions');
    const active = (blitz.getActives() || []).find(a => (a.ticker || '').replace(/-OTC$/i, '') === 'EURUSD' || (a.localizationKey || '') === 'EURUSD-OTC');
    if (!active) { console.log('EURUSD-OTC not in actives:', blitz.getActives().map(a => a.ticker || a.localizationKey).slice(0, 12)); process.exit(1); }
    console.log('active found id=', active.id, 'ticker=', active.ticker, 'loc=', active.localizationKey);

    // Sample the rate every ~4s for ~150s
    const samples = [];
    const t0 = Date.now();
    for (let i = 0; i < 36; i++) {
        try {
            await withTimeout(blitz.refreshActives?.(), 10_000, 'refreshActives').catch(() => {});
            const a = (blitz.getActives() || []).find(x => x.id === active.id);
            const rate = a ? a.profitPercent() : -1;
            samples.push({ t: Date.now() - t0, rate });
            console.log(`t+${String(Date.now() - t0).padStart(5)}ms rate=${rate} suspended=${a?.isSuspended}`);
        } catch (e) {
            console.log(`t+${String(Date.now() - t0).padStart(5)}ms ERR ${e.message}`);
        }
        await new Promise(r => setTimeout(r, 4000));
    }
    // analyze change frequency
    let changes = 0;
    const deltas = [];
    for (let i = 1; i < samples.length; i++) {
        if (samples[i].rate !== samples[i - 1].rate) {
            changes++;
            deltas.push({ at: samples[i].t, from: samples[i - 1].rate, to: samples[i].rate, sinceLast: samples[i].t - samples[i - 1].t });
        }
    }
    console.log('=== SUMMARY ===');
    console.log('samples:', samples.length, '| rate changes:', changes);
    console.log('rates seen:', [...new Set(samples.map(s => s.rate))]);
    console.log('first:', samples[0]?.rate, 'last:', samples[samples.length - 1]?.rate);
    if (deltas.length) console.log('change points:', JSON.stringify(deltas));
    else console.log('NO rate change in window');
} finally {
    await sdk.shutdown().catch(() => {});
    process.exit(0);
}
