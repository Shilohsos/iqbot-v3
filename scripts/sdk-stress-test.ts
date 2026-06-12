// SDK stress test
// Run from project root: npx tsx scripts/sdk-stress-test.ts
import 'dotenv/config';
import Database from 'better-sqlite3';
import { WS_URL } from '../src/protocol.js';

// The SDK IS the project. Import from dist/index.js
const sdkModule = await import(new URL('../dist/index.js', import.meta.url).pathname);

const PLATFORM_ID = parseInt(process.env.PLATFORM_ID || '15', 10);
const IQ_HOST = process.env.IQ_HOST || 'https://iqoption.com';

// Get a valid SSID from DB
const db = new Database(new URL('../iqbot-v3.db', import.meta.url).pathname);
const row = db.prepare("SELECT ssid, telegram_id FROM users WHERE ssid IS NOT NULL AND ssid_valid = 1 ORDER BY RANDOM() LIMIT 1").get() as any;
db.close();

if (!row) { console.log('NO_VALID_SSID'); process.exit(1); }
const SSID = row.ssid;
const UID = row.telegram_id;
console.log(`Using SSID for user ${UID}`);

const { ClientSdk, SsidAuthMethod } = sdkModule;

async function measure(label: string, fn: () => Promise<any>, timeout = 30_000) {
    const start = Date.now();
    try {
        const result = await Promise.race([
            fn(),
            new Promise<any>((_, reject) => setTimeout(() => reject(new Error(`TIMEOUT after ${timeout}ms`)), timeout))
        ]);
        const elapsed = Date.now() - start;
        console.log(`  ✅ ${label}: ${elapsed}ms`);
        return result;
    } catch (err: any) {
        const elapsed = Date.now() - start;
        console.log(`  ❌ ${label}: ${elapsed}ms — ${err?.message ?? err}`);
        throw err;
    }
}

async function main() {
    console.log(`\n=== SDK CONFIGURATION ===`);
    console.log(`WS_URL: ${WS_URL}`);
    console.log(`PLATFORM_ID: ${PLATFORM_ID}`);
    console.log(`IQ_HOST: ${IQ_HOST}`);

    // --- TEST 1: Create SDK ---
    console.log(`\n--- TEST 1: createSdk ---`);
    const sdk = await measure('createSdk', () =>
        ClientSdk.create(WS_URL, PLATFORM_ID, new SsidAuthMethod(SSID), { host: IQ_HOST })
    );

    // --- TEST 2: blitzOptions ---
    console.log(`\n--- TEST 2: blitzOptions ---`);
    const blitz = await measure('blitzOptions.getActives()', async () => {
        const opts = await sdk.blitzOptions();
        return opts.getActives();
    });
    console.log(`  blitz actives: ${blitz.length} pairs`);
    if (blitz.length > 0) {
        console.log(`  Sample: ${blitz.slice(0, 3).map((a: any) => a.ticker).join(', ')}`);
    }

    // --- TEST 3: turboOptions ---
    console.log(`\n--- TEST 3: turboOptions ---`);
    const turbo = await measure('turboOptions.getActives()', async () => {
        const opts = await sdk.turboOptions();
        return opts.getActives();
    });
    console.log(`  turbo actives: ${turbo.length} pairs`);
    if (turbo.length > 0) {
        console.log(`  Sample: ${turbo.slice(0, 3).map((a: any) => a.ticker).join(', ')}`);
    }

    // --- TEST 4: Candles (1m, 200 count) ---
    console.log(`\n--- TEST 4: getCandles (1m x 200) ---`);
    const candlesFacade = await measure('sdk.candles()', () => sdk.candles());
    if (turbo.length > 0) {
        const firstActive = turbo[0];
        console.log(`  Active: id=${firstActive.id} ticker=${firstActive.ticker}`);
        const candles = await measure('getCandles(60s, 200)', () =>
            candlesFacade.getCandles(firstActive.id, 60, { count: 200 })
        );
        console.log(`  Candle count: ${candles.length}`);
        if (candles.length > 0) {
            const last = candles[candles.length - 1];
            console.log(`  Last: open=${last.open} close=${last.close}`);
        }
    }

    // --- TEST 5: Candles (5m, 35 count) ---
    if (blitz.length > 0) {
        console.log(`\n--- TEST 5: getCandles (5m x 35) ---`);
        const ba = blitz[0];
        console.log(`  Active: id=${ba.id} ticker=${ba.ticker}`);
        const candles = await measure('getCandles(300s, 35)', () =>
            candlesFacade.getCandles(ba.id, 300, { count: 35 })
        );
        console.log(`  Candle count: ${candles.length}`);
    }

    // --- TEST 6: Parallel SDK creation stress ---
    console.log(`\n--- TEST 6: Parallel SDK creation (5x) ---`);
    const promises = Array.from({ length: 5 }, async (_, i) => {
        const start = Date.now();
        try {
            const s = await ClientSdk.create(WS_URL, PLATFORM_ID, new SsidAuthMethod(SSID), { host: IQ_HOST });
            await s.shutdown();
            return { idx: i, elapsed: Date.now() - start, status: 'OK' };
        } catch (err: any) {
            return { idx: i, elapsed: Date.now() - start, status: `FAIL: ${err.message}` };
        }
    });
    const results = await Promise.all(promises);
    for (const r of results) {
        console.log(`  [${r.idx}] ${r.status} (${r.elapsed}ms)`);
    }

    // --- TEST 7: Create/destroy loop ---
    console.log(`\n--- TEST 7: create/destroy loop (10x) ---`);
    let failCount = 0;
    for (let i = 0; i < 10; i++) {
        try {
            const s = await ClientSdk.create(WS_URL, PLATFORM_ID, new SsidAuthMethod(SSID), { host: IQ_HOST });
            await s.shutdown();
            process.stdout.write('.');
        } catch (err: any) {
            process.stdout.write('x');
            failCount++;
        }
    }
    console.log(`\n  Failures: ${failCount}/10`);

    // --- TEST 8: Balance fetch via direct HTTP ---
    console.log(`\n--- TEST 8: Balance fetch (direct HTTP) ---`);
    try {
        const resp = await fetch('https://iqoption.com/api/users/balance', {
            headers: { 'User-Agent': 'quadcode-client-sdk-js/1.3.21' }
        });
        const text = await resp.text();
        console.log(`  HTTP ${resp.status}: ${text.slice(0, 100)}`);
    } catch (err: any) {
        console.log(`  FAILED: ${err.message}`);
    }

    // --- TEST 9: Auth login direct vs proxy ---
    console.log(`\n--- TEST 9: Auth login (direct vs proxy) ---`);
    const LOGIN_PROXY_URL = process.env.LOGIN_PROXY_URL;
    for (const label of ['DIRECT', 'VIA_PROXY']) {
        try {
            const opts: any = {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'User-Agent': 'quadcode-client-sdk-js/1.3.21' },
                body: JSON.stringify({ identifier: 'test@test.com', password: 'wrong' }),
            };
            if (label === 'VIA_PROXY' && LOGIN_PROXY_URL) {
                const { ProxyAgent } = await import('undici');
                opts.dispatcher = new ProxyAgent(LOGIN_PROXY_URL);
            }
            const start = Date.now();
            const resp = await fetch('https://auth.iqoption.com/api/v2/login', opts);
            const elapsed = Date.now() - start;
            const text = await resp.text();
            console.log(`  ${label}: HTTP ${resp.status} (${elapsed}ms) — ${text.slice(0, 60)}`);
        } catch (err: any) {
            console.log(`  ${label}: FAILED — ${err.message}`);
        }
    }

    await sdk.shutdown();
    console.log(`\n=== DONE ===`);
}

main().catch(err => {
    console.error(`\nFATAL: ${err.message}`);
    process.exit(1);
});
