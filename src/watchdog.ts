// Update-starvation watchdog (DIRECTIVE-UPDATE-STARVATION-WATCHDOG.md).
//
// Silent-death recovery: on 2026-08-08 the Telegram update poller froze while
// heartbeats kept firing — the process looked healthy for ~30min with 80
// updates queued server-side. This watchdog detects exactly that state and
// exits(1) so PM2 autorestarts.
//
// Exit condition (the ONLY one): Telegram reports pending_update_count > 0
// while this process has not consumed a single update for 3 minutes. Quiet
// periods (pending=0) never trigger, and getWebhookInfo failures only skip the
// tick — an API error is never a reason to restart.
//
// bot.ts wires this with one import + one startUpdateWatchdog(bot) call placed
// IMMEDIATELY after bot construction, so the consumption tracker is the first
// middleware in the chain — ahead of every early-return gate (maintenance,
// ui_disabled, non-private guard). A later registration would stamp only
// updates that survive those gates and could go stale while the poller is
// perfectly alive.

import { logger } from './logger.js';

/** No consumption for this long WHILE updates are queued → starvation. */
const STARVATION_MS = 180_000;
/** Health poll cadence. */
const POLL_MS = 30_000;
/** Cap a single getWebhookInfo call so a hung HTTP request can't stack ticks. */
const API_TIMEOUT_MS = 15_000;
/** Healthy-state log spacing — at most one line per 5 minutes, never spam. */
const HEALTHY_LOG_MS = 5 * 60_000;

let lastConsumedAt = Date.now();
let lastHealthyLogAt = 0;
let tickBusy = false;
let started = false;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
        p,
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${label} timed out`)), ms)),
    ]);
}

/**
 * Start the update-starvation watchdog on a Telegraf bot instance.
 * Registers the consumption-tracking middleware (must be the chain's first)
 * and arms the 30s health poll.
 */
export function startUpdateWatchdog(bot: any): void {
    if (started) return; // idempotent — a second call must not double the interval
    started = true;

    // Fires on EVERY update type the poller hands us — the definitive
    // "bot is processing" signal.
    bot.use((_ctx: any, next: any) => {
        lastConsumedAt = Date.now();
        return next();
    });

    setInterval(() => {
        if (tickBusy) return;
        tickBusy = true;
        void (async () => {
            try {
                const info: any = await withTimeout(bot.telegram.getWebhookInfo(), API_TIMEOUT_MS, 'getWebhookInfo');
                const pending = Number(info?.pending_update_count ?? 0);
                const staleMs = Date.now() - lastConsumedAt;

                if (pending > 0 && staleMs > STARVATION_MS) {
                    logger.error('watchdog', `UPDATE-STARVATION pending=${pending} lastConsumed=${Math.round(staleMs / 1000)}s ago — forcing restart`);
                    process.exit(1);
                }
                if (pending > 0) {
                    logger.warn('watchdog', `updates queuing: pending=${pending} lastConsumed=${Math.round(staleMs / 1000)}s ago (threshold ${STARVATION_MS / 1000}s)`);
                    return;
                }
                if (Date.now() - lastHealthyLogAt >= HEALTHY_LOG_MS) {
                    lastHealthyLogAt = Date.now();
                    logger.info('watchdog', `healthy: pending=0 lastConsumed=${Math.round(staleMs / 1000)}s ago`);
                }
            } catch (e) {
                // API/network error — never a restart reason; skip this tick.
                logger.warn('watchdog', `getWebhookInfo failed (skipping tick): ${e instanceof Error ? e.message : e}`);
            } finally {
                tickBusy = false;
            }
        })();
    }, POLL_MS);

    logger.info('watchdog', `update-starvation watchdog armed (poll ${POLL_MS / 1000}s, threshold ${STARVATION_MS / 1000}s)`);
}
