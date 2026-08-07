// Upgrade-token reset sweep (DIRECTIVE-UPGRADE-TOKEN-SYSTEM.md).
//
// Grandfathered ai_trading/auto_trading users keep access through the reset
// window regardless of balance (see resolveAccess's `grandfather` param in
// access.ts). Once `upgrade_token_reset_date` has passed, this sweep re-checks
// every such user's cached funded balance against the (raised) product minimum
// and downgrades anyone below it to `signals` — the same write path a normal
// balance-driven downgrade uses (setUserFundedBalance), so there is one source
// of truth for "how a user loses access".
//
// Self-disabling: once a full pass completes on/after the reset date, the
// sweep marks itself done in `config` and never runs again. Batched + cursor
// resumable so a bot restart mid-pass just picks up where it left off.

import { logger } from './logger.js';
import { db, getConfig, setConfig, setUserFundedBalance } from './db.js';
import { PRODUCT_LIMITS, getProduct, isGrandfatherWindowActive } from './access.js';

export const UPGRADE_TOKEN_RESET_DATE_KEY = 'upgrade_token_reset_date';
const SWEEP_DONE_KEY = 'upgrade_token_sweep_done';
const SWEEP_CURSOR_KEY = 'upgrade_token_sweep_cursor';
const BATCH_SIZE = 100;

interface SweepCandidate {
    telegram_id: number;
    access_level: string;
    funded_balance_usd: number | null;
}

function getSweepBatch(afterTelegramId: number, limit: number): SweepCandidate[] {
    return db.prepare(`
        SELECT telegram_id, access_level, funded_balance_usd
        FROM users
        WHERE access_level IN ('ai_trading', 'auto_trading')
          AND telegram_id > ?
        ORDER BY telegram_id
        LIMIT ?
    `).all(afterTelegramId, limit) as SweepCandidate[];
}

/**
 * One sweep tick — call at boot and hourly. No-op once self-disabled, and
 * no-op while the grandfather window is still open (so an unchanged or
 * later-pushed reset date never fires early).
 */
export function runUpgradeTokenSweep(): void {
    if (getConfig(SWEEP_DONE_KEY) === '1') return;

    const resetDate = getConfig(UPGRADE_TOKEN_RESET_DATE_KEY);
    if (isGrandfatherWindowActive(resetDate)) return;

    const cursor = Number(getConfig(SWEEP_CURSOR_KEY) ?? '0') || 0;
    const batch = getSweepBatch(cursor, BATCH_SIZE);

    if (batch.length === 0) {
        setConfig(SWEEP_DONE_KEY, '1');
        setConfig(SWEEP_CURSOR_KEY, '0');
        logger.info('upgrade-token', 'reset sweep complete — self-disabled');
        return;
    }

    let downgraded = 0;
    for (const u of batch) {
        const product = getProduct(u.access_level);
        const threshold = PRODUCT_LIMITS[product].unlockBalance;
        const balance = u.funded_balance_usd ?? 0;
        if (balance < threshold) {
            // Same write path syncAccessFromBalance uses for a balance-driven
            // downgrade — single source of truth, no user notification.
            setUserFundedBalance(u.telegram_id, balance, 'signals', null);
            logger.info('upgrade-token', `user ${u.telegram_id} downgraded → signals (balance $${balance.toFixed(2)} < $${threshold})`);
            downgraded++;
        }
    }

    setConfig(SWEEP_CURSOR_KEY, String(batch[batch.length - 1].telegram_id));
    logger.info('upgrade-token', `sweep tick: ${downgraded}/${batch.length} downgraded (cursor → ${batch[batch.length - 1].telegram_id})`);
}
