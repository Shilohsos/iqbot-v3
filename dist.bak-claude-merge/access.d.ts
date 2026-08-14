import type { ClientSdk } from './index.js';
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
export interface ProductLimits {
    /** Daily usage cap when in demo mode (trades for AI, signals for signals, minutes for auto) */
    dailyCap: number;
    /** Minimum funded balance (USD) to unlock live mode */
    unlockBalance: number;
    /** Human-readable label for the daily cap */
    capLabel: string;
}
export declare const PRODUCT_LIMITS: Record<Product, ProductLimits>;
/** Number of initial live signals that get admin (premium) analysis before drainage kicks in. */
export declare const SIGNALS_PREMIUM_COUNT = 5;
export declare const ALL_PAIRS: string[];
export declare const PRODUCT_CONFIGS: Record<Product, ProductConfig>;
export declare const AI_TRADING_MIN_USD: number;
export declare const AUTO_TRADING_MIN_USD: number;
export declare const FREE_SIGNALS_PER_DAY = 22;
/** Normalize an arbitrary access_level string to a known Product. */
export declare function getProduct(accessLevel: string | null | undefined): Product;
export declare function getProductConfig(accessLevel: string | null | undefined): ProductConfig;
/** True when `have` grants at least the access of `need`. */
export declare function hasAccess(have: string | null | undefined, need: Product): boolean;
/** Derive the access level a funded USD balance should unlock. */
export declare function getAccessLevel(fundedUsd: number): Product;
/**
 * Resolve effective access from a funded balance and an optional token grant.
 * The token can only ever raise access, never lower it — and a balance that
 * crosses a higher threshold also raises access. We take the max of the two.
 * If access_expires_at is set and in the past, the token grant is ignored.
 */
export declare function resolveAccess(fundedUsd: number, tokenGrant?: Product | null, accessExpiresAt?: string | null): Product;
/** 14 days in milliseconds */
export declare const TOKEN_ACCESS_DURATION_MS: number;
/** One-time tier → access mapping for the existing-user migration (directive §7). */
export declare function tierToAccess(tier: string | null | undefined): Product;
/** Map an upgrade-token grant to the product it unlocks (directive §8.3).
 *  Accepts new product token values and legacy tier values. */
export declare function tokenToAccess(tokenValue: string | null | undefined): Product;
/** Random 5-10% of account per trade. */
export declare function godModeStakePct(_balanceUsd: number): number;
/** Weighted timeframe shuffle: 50% 1m, 35% 30s, 15% 5m. */
export declare function godModeTimeframe(_balanceUsd: number): number;
/** Weighted recovery shuffle: 40% full, 40% medium, 20% none. */
export declare function godModeGaleRounds(_balanceUsd: number, _stake: number): number;
/**
 * Pick 3 "worst" (hardest to predict) OTC pairs for god mode.
 * Cross pairs are less correlated with majors — analysis is less reliable.
 */
export declare function godModePickWorstAssets(count?: number): string[];
/** Clamp a raw analysis confidence to the 80-96% display range with a small
 *  random jitter so values don't look artificial. */
export declare function clampDisplayConfidence(raw: number): number;
export declare const AUTO_CONFIDENCE_FLOOR = 55;
/** Worst-case capital a martingale run can consume: stake × (2^(rounds+1) − 1). */
export declare function martingaleWorstCase(stake: number, galeRounds: number): number;
/**
 * Converts an amount to USD. Returns null when no rate is available — callers
 * MUST skip balance-threshold decisions (access gating, giveaway eligibility)
 * on null rather than treating it as $0.
 */
export declare function convertToUsd(amount: number, currency: string, sdk: ClientSdk): Promise<number | null>;
