#!/usr/bin/env node
/**
 * new-yacht-session.mjs — one-time MTProto login for the Yacht Club poster.
 *
 * Logs in as Master's real Telegram account (+234 808 629 3670) and writes the
 * fresh StringSession into YACHT_TELEGRAM_SESSION in /root/iqbot-v3/.env.
 *
 * RUN THIS YOURSELF (with Wizard) — interactive: needs the login code Telegram
 * sends to the account, and possibly the 2FA password.
 *
 *   cd /root/iqbot-v3
 *   node scripts/new-yacht-session.mjs
 *
 * Uses TELEGRAM_API_ID / TELEGRAM_API_HASH from .env — the SAME app pair the
 * engine will use (a session minted with one api_id cannot be used with another).
 *
 * ── Security ────────────────────────────────────────────────────────────────
 * The session string is a FULL CREDENTIAL for this Telegram account. It is
 * written directly into .env — never printed, never pasted into chat.
 */

import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import fs from 'node:fs';
import 'dotenv/config';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

const ENV_PATH = '/root/iqbot-v3/.env';
const PHONE = '+2348086293670';

const apiId = parseInt(process.env.TELEGRAM_API_ID ?? '', 10);
const apiHash = process.env.TELEGRAM_API_HASH ?? '';

if (!Number.isFinite(apiId) || !apiHash) {
    console.error('✖ Missing TELEGRAM_API_ID / TELEGRAM_API_HASH in .env');
    process.exit(1);
}

const rl = readline.createInterface({ input, output });
const ask = (q) => rl.question(q);

async function main() {
    const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
        connectionRetries: 3,
        baseLogger: undefined,
        deviceModel: 'Desktop',
        appVersion: '5.10.2',
        systemVersion: 'Linux 6.8',
        langCode: 'en',
    });

    console.log('\n──────────────────────────────────────────────');
    console.log(' Telegram session generator — Yacht Club poster');
    console.log(`  account: ${PHONE}`);
    console.log('──────────────────────────────────────────────');
    console.log(' You will be asked for: login code → 2FA (if set).\n');

    await client.start({
        phoneNumber: PHONE,
        password: async () => (await ask('2FA password (blank if none): ')).trim(),
        phoneCode: async () => (await ask('Login code Telegram just sent you: ')).trim(),
        onError: (err) => { console.error('  … login error:', err?.message ?? err); },
    });

    const session = client.session.save();
    const me = await client.getMe();
    const who = me?.username ? `@${me.username}` : (me?.firstName ?? 'unknown');
    if (!session) {
        console.error('✖ login did not produce a session');
        process.exit(1);
    }

    // Write into .env — replace or append YACHT_TELEGRAM_SESSION.
    let env = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
    const re = /^YACHT_TELEGRAM_SESSION=.*$/m;
    const line = `YACHT_TELEGRAM_SESSION=${session}`;
    env = re.test(env) ? env.replace(re, line) : env.replace(/\s*$/, '\n') + line + '\n';
    fs.writeFileSync(ENV_PATH, env, { mode: 0o600 });

    console.log('\n✅ YACHT_TELEGRAM_SESSION written to .env (600 perms).');
    console.log(`   Logged in as: ${who}`);
    console.log('   Next: pm2 restart iqbot-v3-bot --update-env, then /yacht status.');
    try { await client.disconnect(); } catch { /* best-effort */ }
    process.exit(0);
}

main().catch((e) => {
    console.error(`✖ ${e.message}`);
    process.exit(1);
});
