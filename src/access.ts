// Product-based access model — replaces the DEMO/PRO/MASTER tier system.
//
// Users get one of three products based on their funded USD balance:
//   signals      — analysis display only (no execution), 30/day cap when unfunded
//   ai_trading   — current semi-auto trading system (unlocked at $30 funded)
//   auto_trading — full autonomous trading engine (unlocked at $100 funded)
//
// Upgrade tokens override the balance check (see token_tier:AI_TRADING / AUTO_TRADING).

export type Product = 'signals' | 'ai_trading' | 'auto_trading';

export interface ProductConfig {
    label: string;
    maxConcurrentTrades: number;
    allowedTimeframes: number[];
    allowedGaleOptions: number[];
    galeCanDisable: boolean;
    defaultGaleRounds: number;
    pairs: string[];
}

// The full OTC pair list — all pairs are available to every product now that
// tier-based pair gating is gone. Kept here as the single source of truth.
export const ALL_PAIRS = [
    'EURUSD-OTC', 'GBPUSD-OTC', 'EURJPY-OTC', 'GBPJPY-OTC',
    'AUDUSD-OTC', 'USDCAD-OTC', 'EURGBP-OTC', 'USDCHF-OTC',
];

export const PRODUCT_CONFIGS: Record<Product, ProductConfig> = {
    signals: {
        label: 'Signals',
        maxConcurrentTrades: 0, // signals don't trade
        allowedTimeframes: [30, 60, 300],
        allowedGaleOptions: [0, 3, 6],
        galeCanDisable: true,
        defaultGaleRounds: 6,
        pairs: ALL_PAIRS,
    },
    ai_trading: {
        label: 'AI Trading',
        maxConcurrentTrades: 5,
        allowedTimeframes: [30, 60, 300],
        allowedGaleOptions: [0, 3, 6],
        galeCanDisable: true,
        defaultGaleRounds: 6,
        pairs: ALL_PAIRS,
    },
    auto_trading: {
        label: 'Auto Trading',
        maxConcurrentTrades: 1, // engine keeps 1 position open at a time
        allowedTimeframes: [30, 60, 300],
        allowedGaleOptions: [0, 3, 6],
        galeCanDisable: true,
        defaultGaleRounds: 6,
        pairs: ALL_PAIRS,
    },
};

// Funded-balance thresholds (USD) that unlock each product.
export const AI_TRADING_MIN_USD = 30;
export const AUTO_TRADING_MIN_USD = 100;

// Daily signal cap for users with no funded balance.
export const FREE_SIGNALS_PER_DAY = 30;

const RANK: Record<Product, number> = { signals: 0, ai_trading: 1, auto_trading: 2 };

/** Normalize an arbitrary access_level string to a known Product. */
export function getProduct(accessLevel: string | null | undefined): Product {
    const key = accessLevel?.toLowerCase() ?? 'signals';
    if (key === 'auto_trading' || key === 'ai_trading') return key as Product;
    return 'signals';
}

export function getProductConfig(accessLevel: string | null | undefined): ProductConfig {
    return PRODUCT_CONFIGS[getProduct(accessLevel)];
}

/** True when `have` grants at least the access of `need`. */
export function hasAccess(have: string | null | undefined, need: Product): boolean {
    return RANK[getProduct(have)] >= RANK[need];
}

/** Derive the access level a funded USD balance should unlock. */
export function getAccessLevel(fundedUsd: number): Product {
    if (fundedUsd >= AUTO_TRADING_MIN_USD) return 'auto_trading';
    if (fundedUsd >= AI_TRADING_MIN_USD) return 'ai_trading';
    return 'signals';
}

/**
 * Resolve effective access from a funded balance and an optional token grant.
 * The token can only ever raise access, never lower it — and a balance that
 * crosses a higher threshold also raises access. We take the max of the two.
 */
export function resolveAccess(fundedUsd: number, tokenGrant?: Product | null): Product {
    const fromBalance = getAccessLevel(fundedUsd);
    if (!tokenGrant) return fromBalance;
    return RANK[tokenGrant] > RANK[fromBalance] ? tokenGrant : fromBalance;
}

/** One-time tier → access mapping for the existing-user migration (directive §7). */
export function tierToAccess(tier: string | null | undefined): Product {
    const key = (tier ?? '').toUpperCase();
    if (key === 'PRO' || key === 'MASTER' || key === 'ADMIN') return 'ai_trading';
    return 'signals';
}

// ── Auto God Mode sizing (directive §6, grounded in account size) ──────────────

/** Percentage of real balance to stake per trade — smaller accounts trade more
 *  aggressively for faster compounding, bigger accounts get conservative. */
export function godModeStakePct(balanceUsd: number): number {
    if (balanceUsd <= 50) return 0.05;
    if (balanceUsd <= 500) return 0.03;
    return 0.02;
}

/** Recommended timeframe (seconds) by account size — smaller = faster cycles. */
export function godModeTimeframe(balanceUsd: number): number {
    if (balanceUsd <= 50) return 30;
    if (balanceUsd <= 500) return 60;
    return 300;
}

/** Worst-case capital a martingale run can consume: stake × (2^(rounds+1) − 1). */
export function martingaleWorstCase(stake: number, galeRounds: number): number {
    return stake * (Math.pow(2, galeRounds + 1) - 1);
}

/** Highest gale-rounds option the balance can survive a full losing run of. */
export function godModeGaleRounds(balanceUsd: number, stake: number): number {
    for (const rounds of [6, 3]) {
        if (martingaleWorstCase(stake, rounds) <= balanceUsd) return rounds;
    }
    return 0;
}

// Minimum analysis confidence before the auto engine will open a trade.
export const AUTO_CONFIDENCE_FLOOR = 55;
