#!/usr/bin/env node
/**
 * new-sales-session.mjs — one-time interactive MTProto login.
 *
 * Prints a FRESH TELETHON_SESSION string for the operator to paste into .env.
 * This is the permanent fix when the current auth key is burnt (persistent
 * AUTH_KEY_DUPLICATED even with every consumer stopped).
 *
 * RUN THIS YOURSELF — the bot must never run it. It requires a phone number,
 * a login code Telegram sends you, and possibly your 2FA password.
 *
 *   cd /root/iqbot-v3
 *   node scripts/new-sales-session.mjs
 *
 * Uses TELEGRAM_API_ID / TELEGRAM_API_HASH from .env (or the environment).
 * THE SAME APP PAIR MUST BE USED BY EVERY CONSUMER — a session minted with one
 * api_id cannot be used with another; that mismatch produces its own confusing
 * auth errors.
 *
 * ── After it prints the session ───────────────────────────────────────────────
 *  1. Copy the single-line value.
 *  2. Put it in .env on BOTH VPSs (81.0.219.89 and 173.249.16.116):
 *        TELETHON_SESSION=<new value>
 *  3. Restart the consumers (operator-approved):
 *        pm2 restart sales-bot iqbot-v3-bot     # 81.0.219.89
 *        pm2 restart augustus-bot olaoluwa-bot  # 173.249.16.116
 *  4. Confirm: pm2 logs sales-bot --lines 50   → "[sales-leads] scanner started"
 *              then a scan with no AUTH_KEY_DUPLICATED.
 *
 * ── Security ────────────────────────────────────────────────────────────────
 * The printed string is a FULL CREDENTIAL for this Telegram account. Anyone
 * holding it can act as the account. Never commit it, never paste it into a
 * chat/issue, and rotate it if it is ever exposed. This script prints it to the
 * terminal only — it writes no file and sends it nowhere.
 *
 * ── Ownership reminder ──────────────────────────────────────────────────────
 * One auth key = ONE live connection. A brand-new session does NOT let four
 * bots connect at once; it only clears a burnt key. The sales bot still owns the
 * session and every other consumer must stay connect-per-check. If you want
 * genuine concurrency, mint a SEPARATE session per bot (run this script once per
 * bot, from a different Telegram account or the same one — each login yields an
 * independent auth key).
 */

import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import 'dotenv/config';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

const apiId = parseInt(process.env.TELEGRAM_API_ID ?? '', 10);
const apiHash = process.env.TELEGRAM_API_HASH ?? '';

if (!Number.isFinite(apiId) || !apiHash) {
    console.error('\n✖ Missing TELEGRAM_API_ID / TELEGRAM_API_HASH.');
    console.error('  Put them in .env (same values every bot uses) or export them, then re-run.\n');
    process.exit(1);
}

const rl = readline.createInterface({ input, output });
const ask = (q) => rl.question(q);

console.log('\n─────────────────────────────────────────────────────────────');
console.log(' Telegram session generator — sales bot');
console.log(`  api_id: ${apiId}   api_hash: ${apiHash.slice(0, 4)}…${apiHash.slice(-4)}`);
console.log('─────────────────────────────────────────────────────────────');
console.log(' You will be asked for: phone number → login code → 2FA (if set).\n');

const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
    connectionRetries: 3,
    baseLogger: undefined,
});

try {
    await client.start({
        phoneNumber: async () => (await ask('Phone number (international, e.g. +2348012345678): ')).trim(),
        password: async () => (await ask('2FA password (blank if none): ')).trim(),
        phoneCode: async () => (await ask('Login code Telegram just sent you: ')).trim(),
        onError: (err) => { console.error('  … login error:', err?.message ?? err); },
    });

    const session = client.session.save();
    const me = await client.getMe();
    const who = me?.username ? `@${me.username}` : (me?.firstName ?? 'unknown');

    console.log('\n✔ Logged in as ' + who);
    console.log('\n─────────────── NEW TELETHON_SESSION (copy the line below) ───────────────\n');
    console.log(session);
    console.log('\n──────────────────────────────────────────────────────────────────────────');
    console.log('\nNext steps:');
    console.log('  1. Paste into .env on BOTH VPSs:  TELETHON_SESSION=<the line above>');
    console.log('  2. pm2 restart sales-bot iqbot-v3-bot        # 81.0.219.89');
    console.log('     pm2 restart augustus-bot olaoluwa-bot     # 173.249.16.116');
    console.log('  3. pm2 logs sales-bot --lines 50   → expect "[sales-leads] scanner started"');
    console.log('\n⚠ This string is a full account credential. Do not commit or share it.\n');
} catch (err) {
    console.error('\n✖ Login failed:', err?.message ?? err);
    console.error('  Nothing was changed. Re-run to try again.\n');
    process.exitCode = 1;
} finally {
    // Always hand the session back — leaving this connected would itself
    // AUTH_KEY_DUPLICATED the bots you are about to restart.
    try { await client.disconnect(); } catch { /* best-effort */ }
    try { await client.destroy(); } catch { /* best-effort */ }
    rl.close();
    // GramJS can keep handles open; exit explicitly so the script never hangs.
    setTimeout(() => process.exit(process.exitCode ?? 0), 250).unref();
}
