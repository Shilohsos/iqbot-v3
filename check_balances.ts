#!/usr/bin/env tsx
/**
 * Check all active users' IQ Option account balances via live SDK.
 * Usage: tsx check_balances.ts
 */
import { createSdk } from './dist/trade.js';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
    const env = fs.readFileSync(envPath, 'utf-8');
    for (const line of env.split('\n')) {
        const m = line.match(/^([^#=]+)="?(.+?)"?\s*$/);
        if (m) process.env[m[1].trim()] = m[2].replace(/^"|"$/g, '');
    }
}

const DB_PATH = path.join(__dirname, 'iqbot-v3.db');
const db = new Database(DB_PATH);

interface UserRecord {
    telegram_id: number;
    username: string | null;
    iq_user_id: number | null;
    email: string | null;
    tier: string;
    ssid: string | null;
    ssid_valid: number | null;
    currency: string | null;
    trade_count: number;
    last_trade: string;
    cred: string | null;
}

interface BalanceResult {
    telegram_id: number;
    username: string | null;
    email: string | null;
    tier: string;
    db_iq_user_id: number | null;
    sdk_user_id: number | null;
    demo_amount: number | null;
    demo_currency: string | null;
    real_amount: number | null;
    real_currency: string | null;
    error: string | null;
    user_id_match: boolean;
    has_cred: boolean;
}

async function main() {
    // Get users who traded in last 48h
    const users = db.prepare(`
        SELECT u.telegram_id, u.username, u.iq_user_id, u.email, u.tier, u.ssid, u.ssid_valid, u.currency, u.cred,
               COUNT(t.id) as trade_count,
               MAX(t.created_at) as last_trade
        FROM trades t
        JOIN users u ON u.telegram_id = t.telegram_id
        WHERE t.created_at >= datetime('now', '-48 hours')
        GROUP BY t.telegram_id
        ORDER BY last_trade DESC
    `).all() as UserRecord[];

    console.log(`Found ${users.length} users who traded in last 48h`);
    console.log('Checking live balances via SDK (10s timeout each)...\n');

    const results: BalanceResult[] = [];
    let successCount = 0;
    let failCount = 0;
    const TIMEOUT_MS = 10_000;

    for (const user of users) {
        const result: BalanceResult = {
            telegram_id: user.telegram_id,
            username: user.username,
            email: user.email,
            tier: user.tier,
            db_iq_user_id: user.iq_user_id,
            sdk_user_id: null,
            demo_amount: null,
            demo_currency: null,
            real_amount: null,
            real_currency: null,
            error: null,
            user_id_match: false,
            has_cred: !!user.cred,
        };

        // Skip if no SSID
        if (!user.ssid) {
            result.error = 'no_ssid';
            results.push(result);
            process.stdout.write('─');
            continue;
        }

        try {
            const sdk: any = await createSdk(user.ssid);
            await new Promise(r => setTimeout(r, 800));

            const balancePromise = sdk.balances();
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('balance_timeout')), TIMEOUT_MS)
            );
            const balancesObj = await Promise.race([balancePromise, timeoutPromise]) as any;
            const balances = balancesObj.getBalances() as any[];

            // Get user ID from userProfile (more reliable than balance.userId)
            if ((sdk as any).userProfile?.userId) {
                result.sdk_user_id = (sdk as any).userProfile.userId;
            } else if (balances.length > 0 && balances[0].userId) {
                result.sdk_user_id = balances[0].userId;
            }
            if (result.sdk_user_id) {
                result.user_id_match = result.db_iq_user_id === result.sdk_user_id;
            }

            for (const b of balances) {
                if (b.type === 'demo') {
                    result.demo_amount = b.amount;
                    result.demo_currency = b.currency;
                } else if (b.type === 'real') {
                    result.real_amount = b.amount;
                    result.real_currency = b.currency;
                }
            }

            try { await sdk.shutdown(); } catch {}
            successCount++;
            process.stdout.write('.');
        } catch (err: any) {
            const msg = err?.message || String(err);
            result.error = msg.length > 150 ? msg.substring(0, 150) + '...' : msg;
            failCount++;
            process.stdout.write('x');
        }

        results.push(result);
    }

    process.stdout.write('\n\n');

    // Save results
    const outputPath = path.join(__dirname, 'balance_check_results.json');
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));

    // --- ANALYSIS ---
    const userIdMismatches = results.filter(r => r.db_iq_user_id && r.sdk_user_id && !r.user_id_match);
    const noDbId = results.filter(r => !r.db_iq_user_id);
    const fundedAccounts = results.filter(r => r.real_amount !== null && r.real_amount > 0);
    const zeroReal = results.filter(r => r.real_amount !== null && r.real_amount === 0);
    const noRealInfo = results.filter(r => r.real_amount === null);

    const summary = {
        total: users.length,
        connected: successCount,
        failed: failCount,
        funded_accounts: fundedAccounts.map(r => ({
            tg: r.telegram_id,
            name: r.username,
            email: r.email,
            tier: r.tier,
            real: `${r.real_currency} ${r.real_amount?.toFixed(2)}`,
            demo: `${r.demo_currency} ${r.demo_amount?.toFixed(2)}`,
            user_id_match: r.user_id_match,
            db_id: r.db_iq_user_id,
            sdk_id: r.sdk_user_id,
        })),
        zero_real_balance: zeroReal.length,
        user_id_mismatches: userIdMismatches.map(r => ({
            tg: r.telegram_id,
            name: r.username,
            db_id: r.db_iq_user_id,
            sdk_id: r.sdk_user_id,
        })),
    };

    console.log('╔══════════════════════════════════════╗');
    console.log('║        BALANCE CHECK RESULTS          ║');
    console.log('╚══════════════════════════════════════╝');
    console.log(`   Total active users:   ${users.length}`);
    console.log(`   SDK connected:        ${successCount}`);
    console.log(`   Failed/timeout:       ${failCount}`);
    console.log(`   Funded (real > 0):    ${fundedAccounts.length}`);
    console.log(`   Zero real balance:    ${zeroReal.length}`);
    console.log(`   No real info:         ${noRealInfo.length}`);
    console.log(`   User ID mismatches:   ${userIdMismatches.length}`);
    console.log();

    if (fundedAccounts.length > 0) {
        console.log('━━━ FUNDED ACCOUNTS (real_balance > 0) ━━━');
        for (const r of fundedAccounts) {
            const matchStr = r.user_id_match ? '✓' : `✗ (DB:${r.db_iq_user_id}→SDK:${r.sdk_user_id})`;
            console.log(` ${r.tier} | @${r.username || '—'} | ${r.email || '—'}`);
            console.log(`   💰 Real: ${r.real_currency} ${r.real_amount?.toFixed(2)} | Demo: ${r.demo_currency} ${r.demo_amount?.toFixed(2)}`);
            console.log(`   🆔 IDs match: ${matchStr}`);
            console.log();
        }
    }

    if (userIdMismatches.length > 0) {
        console.log('━━━ USER ID MISMATCHES ━━━');
        for (const r of userIdMismatches) {
            console.log(` @${r.username || r.telegram_id} | DB:${r.db_iq_user_id} → SDK:${r.sdk_user_id}`);
        }
        console.log();
    }

    console.log(`Full JSON: ${outputPath}`);
    db.close();
}

main().catch(err => {
    console.error('FATAL:', err);
    process.exit(1);
});
