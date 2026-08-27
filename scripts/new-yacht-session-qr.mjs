#!/usr/bin/env node
/**
 * new-yacht-session-qr.mjs — QR-code MTProto login for the Yacht Club poster.
 *
 * Telegram's anti-scam system blocks logins when the SMS/app code is pasted
 * into any chat ("this code was previously shared by your account"). QR login
 * avoids codes entirely: the script renders a QR PNG that Master scans with his
 * phone Telegram app (Settings → Devices → Scan QR / Login by QR).
 *
 * On success the fresh StringSession is written directly into
 * YACHT_TELEGRAM_SESSION in /root/iqbot-v3/.env — never printed.
 *
 *   cd /root/iqbot-v3
 *   node scripts/new-yacht-session-qr.mjs
 */

import fs from 'node:fs';
import { createRequire } from 'node:module';
import 'dotenv/config';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

const require = createRequire(import.meta.url);
const QRCode = require('/root/.hermes/hermes-agent/node_modules/qrcode');

const ENV_PATH = '/root/iqbot-v3/.env';
const QR_PATH = '/tmp/yacht-qr.png';

const apiId = parseInt(process.env.TELEGRAM_API_ID ?? '', 10);
const apiHash = process.env.TELEGRAM_API_HASH ?? '';

if (!Number.isFinite(apiId) || !apiHash) {
    console.error('✖ Missing TELEGRAM_API_ID / TELEGRAM_API_HASH in .env');
    process.exit(1);
}

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
    console.log(' QR login — Yacht Club poster session');
    console.log(' Scan the QR with your phone Telegram app.');
    console.log('──────────────────────────────────────────────\n');

    await client.connect();

    let shown = false;
    await client.start({
        phoneNumber: async () => {
            const e = new Error('RESTART_AUTH_WITH_QR');
            e.errorMessage = 'RESTART_AUTH_WITH_QR';
            throw e;
        },
        qrCode: async (qr) => {
            const payload = 'tg://login?token=' + Buffer.from(qr.token).toString('base64url');
            await QRCode.toFile(QR_PATH, payload, { width: 420, margin: 2 });
            const stamp = new Date().toISOString().slice(11, 19);
            console.log(`[${stamp}] QR refreshed -> ${QR_PATH}`);
            if (!shown) {
                shown = true;
                console.log('Waiting for scan…');
            }
        },
        password: async () => (await import('node:readline/promises')).default
            .createInterface({ input: process.stdin, output: process.stdout })
            .question('2FA password (blank if none): '),
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
