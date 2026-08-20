#!/usr/bin/env tsx
// sales-bot-entry.ts — Entry point for the sales lead tracking bot
// Usage: tsx sales-bot-entry.ts
// PM2: pm2 start sales-bot-entry.ts --name sales-bot --interpreter tsx

import 'dotenv/config';
// One Telegram session PER BOT (2026-08-20): the sales scanner gets its own
// auth key via SALES_TELETHON_SESSION (set in .env). Without this override
// both local bots would share the main TELETHON_SESSION and burn the key
// with AUTH_KEY_DUPLICATED churn (happened twice — Aug 17 & Aug 20).
if (process.env.SALES_TELETHON_SESSION) {
    process.env.TELETHON_SESSION = process.env.SALES_TELETHON_SESSION;
}
import { createSalesBot } from './src/sales-bot.js';

const SALES_BOT_TOKEN = '6461943886:AAECqdFjZUdcQtmvw2NB076IylQuEn0t6CQ';

async function main() {
    console.log('[sales-bot] Starting sales lead tracker...');

    // Scanner is owned by startLeadScanner() in src/sales-bot.ts (backoff,
    // cursor resume, >60min admin alert). No separate loop here — a second
    // loop would double-scan and bypass the outage alerting.

    // Launch the bot
    const bot = createSalesBot(SALES_BOT_TOKEN);

    // Wait 3s to let any previous polling connection time out
    await new Promise(r => setTimeout(r, 3_000));

    async function ensurePolling(): Promise<void> {
        const retryDelay = 5_000;
        while (true) {
            try {
                await bot.launch();
                break;
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                if (msg.includes('409') || msg.includes('Conflict')) {
                    console.warn(`[sales-bot] 409 Conflict — retrying in ${retryDelay}ms`);
                    await new Promise(r => setTimeout(r, retryDelay));
                    continue;
                }
                throw err;
            }
        }
    }

    ensurePolling().catch(err => {
        console.error('[sales-bot] Fatal:', err);
        process.exit(1);
    });

    console.log('[sales-bot] Sales lead tracker running ✅');

    // Graceful shutdown
    function shutdown(signal: string): void {
        console.log(`[sales-bot] ${signal} received — shutting down`);
        bot.stop(signal);
        process.exit(0);
    }
    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch(err => {
    console.error('[sales-bot] Fatal startup error:', err);
    process.exit(1);
});
