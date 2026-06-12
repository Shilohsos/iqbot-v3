/**
 * IQ Option Login Flow Test
 * Tests:
 * 1. Get valid SSID from DB
 * 2. Create SDK via ClientSdk.create()
 * 3. Fetch real balance via Balances facade
 * 4. Get profile via UserProfile
 * 5. Report timings
 */

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;

// Load .env manually (avoid dotenv dependency issues)
function loadEnv(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
        }
        process.env[key] = val;
    }
}

loadEnv(path.join(ROOT, '.env'));

// Import SDK from dist
const require = createRequire(import.meta.url);
const { ClientSdk, SsidAuthMethod, BalanceType } = require(path.join(ROOT, 'dist/index.js'));

// Config
const WS_URL = process.env.IQ_WS_URL ?? 'wss://ws.iqoption.com/echo/websocket';
const PLATFORM_ID = parseInt(process.env.PLATFORM_ID ?? '15', 10);
const IQ_HOST = process.env.IQ_HOST ?? 'https://iqoption.com';
const DB_PATH = path.join(ROOT, 'iqbot-v3.db');

console.log('=== IQ Option Login Flow Test ===\n');
console.log(`WS_URL: ${WS_URL}`);
console.log(`PLATFORM_ID: ${PLATFORM_ID}`);
console.log(`IQ_HOST: ${IQ_HOST}`);
console.log(`DB_PATH: ${DB_PATH}`);
console.log('');

// Helper to format timing
function elapsed(start) {
    const ms = Date.now() - start;
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
}

async function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function main() {
    // --- Step 1: Get valid SSID from DB ---
    console.log('--- Step 1: Fetch valid SSID from DB ---');
    const step1 = Date.now();
    let ssid = null;
    let userRow = null;
    let db;
    try {
        // Try better-sqlite3 first
        db = require('better-sqlite3')(DB_PATH);
        userRow = db.prepare('SELECT telegram_id, ssid, email, balance_cache FROM users WHERE ssid_valid = 1 AND ssid IS NOT NULL LIMIT 1').get();
        if (!userRow) {
            throw new Error('No valid SSID found in DB');
        }
        console.log(`  User: telegram_id=${userRow.telegram_id}, email=${userRow.email || '(no email)'}`);
        console.log(`  SSID: ${userRow.ssid.substring(0, 10)}...${userRow.ssid.slice(-5)}`);
        console.log(`  Cached balance: ${userRow.balance_cache || '(none)'}`);
        ssid = userRow.ssid;
        db.close();
        console.log(`  Step 1 done: ${elapsed(step1)}\n`);
    } catch (err) {
        console.error(`  DB Error: ${err.message}`);
        console.log(`  Step 1 failed: ${elapsed(step1)}\n`);
        process.exit(1);
    }

    // --- Step 2: Create SDK via ClientSdk.create() ---
    console.log('--- Step 2: Create SDK (connect + authenticate via WS) ---');
    const step2 = Date.now();
    let sdk;
    try {
        sdk = await ClientSdk.create(
            WS_URL,
            PLATFORM_ID,
            new SsidAuthMethod(ssid),
            { host: IQ_HOST }
        );
        console.log(`  SDK created successfully`);
        console.log(`  UserProfile: userId=${sdk.userProfile.userId}, name=${sdk.userProfile.firstName} ${sdk.userProfile.lastName}`);
        console.log(`  Step 2 done: ${elapsed(step2)}\n`);
    } catch (err) {
        console.error(`  SDK creation failed:`, err.message);
        if (err.stack) console.error(err.stack.split('\n').slice(0, 5).join('\n'));
        console.log(`  Step 2 failed: ${elapsed(step2)}\n`);
        process.exit(1);
    }

    // --- Step 3: Fetch balance via Balances facade ---
    console.log('--- Step 3: Fetch real balances ---');
    const step3 = Date.now();
    try {
        const balances = await sdk.balances();
        const allBalances = balances.getBalances();
        console.log(`  Got ${allBalances.length} balance(s):`);
        for (const b of allBalances) {
            const type = b.type ?? 'unknown';
            const isDemo = type === 'demo' || type === 'practice';
            if (isDemo) {
                console.log(`    [DEMO]  id=${b.id}, amount=${b.amount}, currency=${b.currency}, type=${type}`);
            } else {
                console.log(`    [REAL]  id=${b.id}, amount=${b.amount}, currency=${b.currency}, type=${type}`);
            }
        }
        // Find demo balance specifically
        const demoBal = allBalances.find(b => b.type === BalanceType.Demo);
        if (demoBal) {
            console.log(`  >> DEMO Balance: ${demoBal.amount} ${demoBal.currency}`);
        } else {
            console.log(`  >> No demo balance found`);
        }
        const realBal = allBalances.find(b => b.type === BalanceType.Real);
        if (realBal) {
            console.log(`  >> REAL Balance: ${realBal.amount} ${realBal.currency}`);
        }
        console.log(`  Step 3 done: ${elapsed(step3)}\n`);
    } catch (err) {
        console.error(`  Balance fetch failed:`, err.message);
        console.log(`  Step 3 failed: ${elapsed(step3)}\n`);
    }

    // --- Step 4: Try to get balance via REST API ---
    console.log('--- Step 4: SDK profile/info check ---');
    const step4 = Date.now();
    try {
        // userProfile is already fetched during SDK creation - it's available as sdk.userProfile
        console.log(`  User ID: ${sdk.userProfile.userId}`);
        console.log(`  Name: ${sdk.userProfile.firstName} ${sdk.userProfile.lastName}`);
        console.log(`  Step 4 done: ${elapsed(step4)}\n`);
    } catch (err) {
        console.error(`  Profile check failed:`, err.message);
        console.log(`  Step 4 failed: ${elapsed(step4)}\n`);
    }

    // --- Step 5: Test with another SSID from DB ---
    console.log('--- Step 5: Test with second SSID ---');
    const step5 = Date.now();
    try {
        const db2 = require('better-sqlite3')(DB_PATH);
        const userRow2 = db2.prepare('SELECT telegram_id, ssid, email, balance_cache FROM users WHERE ssid_valid = 1 AND ssid IS NOT NULL AND telegram_id != ? LIMIT 1').get(userRow.telegram_id);
        db2.close();
        if (userRow2) {
            console.log(`  User: telegram_id=${userRow2.telegram_id}, email=${userRow2.email || '(no email)'}`);
            const sdk2 = await ClientSdk.create(
                WS_URL,
                PLATFORM_ID,
                new SsidAuthMethod(userRow2.ssid),
                { host: IQ_HOST }
            );
            console.log(`  SDK2 created: userId=${sdk2.userProfile.userId}`);
            const bal2 = await sdk2.balances();
            const all2 = bal2.getBalances();
            for (const b of all2) {
                console.log(`    [${b.type ?? 'unknown'}] id=${b.id}, amount=${b.amount}, currency=${b.currency}`);
            }
            await sdk2.shutdown();
            console.log(`  SDK2 shut down`);
        } else {
            console.log(`  No second user found, skipping`);
        }
        console.log(`  Step 5 done: ${elapsed(step5)}\n`);
    } catch (err) {
        console.error(`  Second user test failed:`, err.message);
        console.log(`  Step 5 failed: ${elapsed(step5)}\n`);
    }

    // --- Step 6: Shutdown ---
    console.log('--- Cleanup: Shutdown SDK ---');
    await sdk.shutdown();
    console.log('SDK shut down successfully');
    console.log('\n=== TEST COMPLETE ===');
}

main().catch(err => {
    console.error('FATAL:', err);
    process.exit(1);
});
