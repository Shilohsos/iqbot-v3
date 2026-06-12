// Error propagation stress test
// Tests what errors actually surface through the bot's error handling
import 'dotenv/config';
import Database from 'better-sqlite3';
import { WS_URL } from '../src/protocol.js';

const sdkModule = await import(new URL('../dist/index.js', import.meta.url).pathname);
const { ClientSdk, SsidAuthMethod } = sdkModule;
const PLATFORM_ID = parseInt(process.env.PLATFORM_ID || '15', 10);
const IQ_HOST = process.env.IQ_HOST || 'https://iqoption.com';

const db = new Database(new URL('../iqbot-v3.db', import.meta.url).pathname);

// Import bot's friendlyError
import { friendlyError, FriendlyErrors } from '../src/errors.js';

console.log(`\n=== ERROR PROPAGATION TEST ===`);
console.log(`\nFriendlyErrors map keys (${Object.keys(FriendlyErrors).length}):`);
for (const [key, msg] of Object.entries(FriendlyErrors)) {
    console.log(`  "${key}" → "${msg}"`);
}

console.log(`\n--- TEST 1: Invalid SSID ---`);
try {
    const s = await ClientSdk.create(WS_URL, PLATFORM_ID, new SsidAuthMethod('INVALID_SSID_HERE'), { host: IQ_HOST });
    console.log('  ❌ Expected error but got SDK');
    await s.shutdown();
} catch (err: any) {
    const msg = err?.message ?? String(err);
    const friendly = friendlyError(err, '⚠️ Could not analyze market. Please try again.');
    console.log(`  Raw error: ${msg}`);
    console.log(`  Friendly: ${friendly}`);
    console.log(`  Type: ${err?.constructor?.name ?? typeof err}`);
    console.log(`  Has known keys: ${Object.keys(FriendlyErrors).some(k => msg.includes(k))}`);
}

console.log(`\n--- TEST 2: Expired SSID (try one from DB where ssid_valid=0) ---`);
const expired = db.prepare("SELECT ssid, telegram_id FROM users WHERE ssid IS NOT NULL AND ssid_valid = 0 LIMIT 1").get() as any;
db.close();

if (expired) {
    console.log(`  Testing with user ${expired.telegram_id} (ssid_valid=0)`);
    try {
        const s = await ClientSdk.create(WS_URL, PLATFORM_ID, new SsidAuthMethod(expired.ssid), { host: IQ_HOST });
        console.log('  ✅ SDK connected (ssid might still be valid)');
        try {
            const bal = await s.balances();
            const bals = bal.getBalances();
            console.log(`  Balances: ${JSON.stringify(bals.slice(0, 2))}`);
        } catch (balErr: any) {
            console.log(`  ❌ Balance fetch failed: ${balErr.message}`);
        }
        await s.shutdown();
    } catch (err: any) {
        const msg = err?.message ?? String(err);
        const friendly = friendlyError(err, '⚠️ Could not analyze market. Please try again.');
        console.log(`  ❌ SDK create failed`);
        console.log(`  Raw: ${msg}`);
        console.log(`  Friendly: ${friendly}`);
    }
} else {
    console.log('  No expired SSIDs found in DB');
}

console.log(`\n--- TEST 3: Simulate known errors through friendlyError ---`);
const testErrors = [
    'Unknown pair: EURUSD-OTC',
    'SDK connection timed out',
    'Connection timed out after 30s',
    'Not connected to server',
    'Session expired',
    'Insufficient balance for trade',
    'fetch failed',
    'ConnectTimeoutError: Connect Timeout Error',
    'ConnectTimeout: Connection refused',
    'TypeError: fetch failed (attempted address: iqoption.com:443)',
    'market is closed',
    'Not enough data for analysis',
    'User authentication failed',
    'Some random unknown error',
];

for (const errMsg of testErrors) {
    const err = new Error(errMsg);
    const friendly = friendlyError(err, '⚠️ Fallback: generic error');
    console.log(`  "${errMsg}" → "${friendly}"`);
}

console.log(`\n--- TEST 4: Verify errors.ts after Claude's fix ---`);
const hasConnectTimeout = Object.keys(FriendlyErrors).some(k => k.includes('ConnectTimeout'));
const hasFetchFailed = Object.keys(FriendlyErrors).some(k => k.includes('fetch failed'));
console.log(`  ConnectTimeoutError mapped: ${hasConnectTimeout}`);
console.log(`  fetch failed mapped: ${hasFetchFailed}`);
console.log(`  All keys: ${Object.keys(FriendlyErrors).join(', ')}`);

console.log(`\n=== DONE ===`);
