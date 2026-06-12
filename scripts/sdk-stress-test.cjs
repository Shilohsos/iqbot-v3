// SDK stress test — CJS version using built dist
// Run: node scripts/sdk-stress-test.cjs
require('dotenv').config({ path: __dirname + '/../.env' });

const { ClientSdk, SsidAuthMethod } = require('@quadcode-tech/client-sdk-js');
const Database = require('better-sqlite3');

const WS_URL = process.env.IQ_WS_URL || 'wss://ws.iqoption.com/echo/websocket';
const PLATFORM_ID = parseInt(process.env.PLATFORM_ID || '15', 10);
const IQ_HOST = process.env.IQ_HOST || 'https://iqoption.com';

// Get a valid SSID from DB
const db = new Database(__dirname + '/../iqbot-v3.db');
const row = db.prepare("SELECT ssid, telegram_id FROM users WHERE ssid IS NOT NULL AND ssid_valid = 1 ORDER BY RANDOM() LIMIT 1").get();
db.close();

if (!row) { console.log('NO_VALID_SSID'); process.exit(1); }

const SSID = row.ssid;
const UID = row.telegram_id;
console.log(`Using SSID for user ${UID}`);

async function measure(label, fn, timeout = 30_000) {
    const start = Date.now();
    try {
        const result = await Promise.race([
            fn(),
            new Promise((_, reject) => setTimeout(() => reject(new Error(`TIMEOUT after ${timeout}ms`)), timeout))
        ]);
        const elapsed = Date.now() - start;
        console.log(`  ✅ ${label}: ${elapsed}ms`);
        return result;
    } catch (err) {
        const elapsed = Date.now() - start;
        console.log(`  ❌ ${label}: ${elapsed}ms — ${err?.message ?? err}`);
        throw err;
    }
}

async function main() {
    process.stdout.write(`\n=== SDK Configuration ===\n`);
    process.stdout.write(`WS_URL: ${WS_URL}\n`);
    process.stdout.write(`PLATFORM_ID: ${PLATFORM_ID}\n`);
    process.stdout.write(`IQ_HOST: ${IQ_HOST}\n`);

    // --- TEST 1: Create SDK ---
    process.stdout.write(`\n--- TEST 1: createSdk ---\n`);
    const sdk = await measure('createSdk', () =>
        ClientSdk.create(WS_URL, PLATFORM_ID, new SsidAuthMethod(SSID), { host: IQ_HOST })
    );

    // --- TEST 2: blitzOptions ---
    process.stdout.write(`\n--- TEST 2: blitzOptions ---\n`);
    const blitz = await measure('blitzOptions.getActives()', async () => {
        const opts = await sdk.blitzOptions();
        return opts.getActives();
    });
    process.stdout.write(`  blitz actives: ${blitz.length} pairs\n`);
    if (blitz.length > 0) {
        process.stdout.write(`  Sample: ${blitz.slice(0, 3).map(a => a.ticker).join(', ')}\n`);
    }

    // --- TEST 3: turboOptions ---
    process.stdout.write(`\n--- TEST 3: turboOptions ---\n`);
    const turbo = await measure('turboOptions.getActives()', async () => {
        const opts = await sdk.turboOptions();
        return opts.getActives();
    });
    process.stdout.write(`  turbo actives: ${turbo.length} pairs\n`);
    if (turbo.length > 0) {
        process.stdout.write(`  Sample: ${turbo.slice(0, 3).map(a => a.ticker).join(', ')}\n`);
    }

    // --- TEST 4: Candles (1m) ---
    process.stdout.write(`\n--- TEST 4: getCandles (1m, 200 count) ---\n`);
    const candlesFacade = await measure('candles()', () => sdk.candles());

    if (turbo.length > 0) {
        const firstActive = turbo[0];
        process.stdout.write(`  Fetching candles for active ${firstActive.id} (${firstActive.ticker})\n`);
        const candles = await measure('getCandles(1m, 200)', () =>
            candlesFacade.getCandles(firstActive.id, 60, { count: 200 })
        );
        process.stdout.write(`  Candle count: ${candles.length}\n`);
        if (candles.length > 0) {
            const last = candles[candles.length - 1];
            process.stdout.write(`  Last candle: open=${last.open}, close=${last.close}\n`);
        }
    }

    // --- TEST 5: Candles (5m, 35 count) ---
    if (blitz.length > 0) {
        process.stdout.write(`\n--- TEST 5: getCandles (5m, 35 count) ---\n`);
        const blitzActive = blitz[0];
        process.stdout.write(`  Fetching candles for active ${blitzActive.id} (${blitzActive.ticker})\n`);
        const candles = await measure('getCandles(5m, 35)', () =>
            candlesFacade.getCandles(blitzActive.id, 300, { count: 35 })
        );
        process.stdout.write(`  Candle count: ${candles.length}\n`);
    }

    // --- TEST 6: Parallel SDK creation (stress) ---
    process.stdout.write(`\n--- TEST 6: Parallel SDK creation (5x) ---\n`);
    const promises = Array.from({ length: 5 }, async (_, i) => {
        const start = Date.now();
        try {
            const s = await ClientSdk.create(WS_URL, PLATFORM_ID, new SsidAuthMethod(SSID), { host: IQ_HOST });
            await s.shutdown();
            return { idx: i, elapsed: Date.now() - start, status: 'OK' };
        } catch (err) {
            return { idx: i, elapsed: Date.now() - start, status: `FAIL: ${err.message}` };
        }
    });
    const results = await Promise.all(promises);
    for (const r of results) {
        process.stdout.write(`  [${r.idx}] ${r.status} (${r.elapsed}ms)\n`);
    }

    // --- TEST 7: SDK create/destroy loop (10x) ---
    process.stdout.write(`\n--- TEST 7: SDK create/destroy loop (10x) ---\n`);
    let failCount = 0;
    for (let i = 0; i < 10; i++) {
        try {
            const s = await ClientSdk.create(WS_URL, PLATFORM_ID, new SsidAuthMethod(SSID), { host: IQ_HOST });
            await s.shutdown();
            process.stdout.write('.');
        } catch (err) {
            process.stdout.write('x');
            failCount++;
        }
    }
    process.stdout.write(`\n  Failures: ${failCount}/10\n`);

    // --- TEST 8: Balance fetch ---
    process.stdout.write(`\n--- TEST 8: Balance fetch (raw HTTP) ---\n`);
    try {
        const fetch = globalThis.fetch || (await import('node-fetch')).default;
        const resp = await fetch('https://iqoption.com/api/users/balance', {
            headers: { 'User-Agent': 'quadcode-client-sdk-js/1.3.21' }
        });
        const text = await resp.text();
        process.stdout.write(`  HTTP ${resp.status}: ${text.slice(0, 100)}\n`);
    } catch (err) {
        process.stdout.write(`  HTTP fetch FAILED: ${err.message}\n`);
    }

    // Cleanup
    await sdk.shutdown();
    process.stdout.write(`\n=== SDK STRESS TEST COMPLETE ===\n`);
}

main().catch(err => {
    console.error(`\nFATAL: ${err.message}`);
    process.exit(1);
});
