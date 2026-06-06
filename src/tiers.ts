import type { ClientSdk } from './index.js';
import { logger } from './logger.js';

export interface TierConfig {
    label: string;
    pairs: string[];
    analyzerTier: 'DEMO' | 'PRO' | 'MASTER';
    maxConcurrentTrades: number;
    allowedTimeframes: number[];
    allowedGaleOptions: number[];
    galeCanDisable: boolean;
    defaultGaleRounds: number;
    canViewLeaderboard: boolean;
    canParticipateGiveaway: boolean;
    demoUpsellEnabled: boolean;
}

export const TIER_CONFIGS: Record<string, TierConfig> = {
    DEMO: {
        label: 'Demo Trader',
        pairs: ['EURUSD-OTC', 'GBPUSD-OTC'],
        analyzerTier: 'DEMO',
        maxConcurrentTrades: 1,
        allowedTimeframes: [300],
        allowedGaleOptions: [3, 6],
        galeCanDisable: false,
        defaultGaleRounds: 6,
        canViewLeaderboard: false,
        canParticipateGiveaway: false,
        demoUpsellEnabled: true,
    },
    PRO: {
        label: 'Pro Trader',
        pairs: ['EURUSD-OTC', 'GBPUSD-OTC', 'EURJPY-OTC', 'GBPJPY-OTC'],
        analyzerTier: 'PRO',
        maxConcurrentTrades: 2,
        allowedTimeframes: [60, 300],
        allowedGaleOptions: [3, 6],
        galeCanDisable: false,
        defaultGaleRounds: 6,
        canViewLeaderboard: true,
        canParticipateGiveaway: true,
        demoUpsellEnabled: false,
    },
    MASTER: {
        label: 'Master Trader',
        pairs: ['EURUSD-OTC', 'GBPUSD-OTC', 'EURJPY-OTC', 'GBPJPY-OTC', 'AUDUSD-OTC', 'USDCAD-OTC', 'EURGBP-OTC', 'USDCHF-OTC'],
        analyzerTier: 'MASTER',
        maxConcurrentTrades: 5,
        allowedTimeframes: [30, 60, 300],
        allowedGaleOptions: [0, 3, 6],
        galeCanDisable: true,
        defaultGaleRounds: 6,
        canViewLeaderboard: true,
        canParticipateGiveaway: true,
        demoUpsellEnabled: false,
    },
    ADMIN: {
        label: 'Admin',
        pairs: ['EURUSD-OTC', 'GBPUSD-OTC', 'EURJPY-OTC', 'GBPJPY-OTC', 'AUDUSD-OTC', 'USDCAD-OTC', 'EURGBP-OTC', 'USDCHF-OTC'],
        analyzerTier: 'MASTER',
        maxConcurrentTrades: 10,
        allowedTimeframes: [30, 60, 300],
        allowedGaleOptions: [3],
        galeCanDisable: true,
        defaultGaleRounds: 3,
        canViewLeaderboard: true,
        canParticipateGiveaway: false,
        demoUpsellEnabled: false,
    },
};

export function getTierConfig(tier: string | null | undefined): TierConfig {
    const key = (tier ?? 'DEMO').toUpperCase();
    return TIER_CONFIGS[key] ?? TIER_CONFIGS.DEMO;
}

export function normalizeTier(tier: string | null | undefined): 'DEMO' | 'PRO' | 'MASTER' {
    const key = (tier ?? 'DEMO').toUpperCase();
    if (key === 'PRO') return 'PRO';
    if (key === 'MASTER') return 'MASTER';
    return 'DEMO';
}

const rateCache = new Map<string, { rate: number; expires: number }>();

// Fallback rates for currencies the SDK may not support
// Approximate — fine for tier promotion thresholds; updated periodically
const FALLBACK_RATES: Record<string, number> = {
    NGN: 0.00067,   // ~₦1,500 = $1
    KES: 0.0077,    // ~KES 130 = $1
    GHS: 0.069,     // ~GHS 14.5 = $1
    ZAR: 0.054,     // ~ZAR 18.5 = $1
    INR: 0.012,     // ~INR 83 = $1
    IDR: 0.000062,  // ~IDR 16,000 = $1
    BRL: 0.19,      // ~BRL 5.3 = $1
};

export async function convertToUsd(amount: number, currency: string, sdk: ClientSdk): Promise<number> {
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
        logger.warn('tiers', `currency conversion via SDK failed for ${currency}, trying fallback`);
    }

    const fallbackRate = FALLBACK_RATES[currency.toUpperCase()];
    if (fallbackRate && fallbackRate > 0) {
        logger.info('tiers', `using fallback rate for ${currency}: ${fallbackRate}`);
        return amount * fallbackRate;
    }

    logger.warn('tiers', `no conversion rate available for ${currency}, returning 0`);
    return 0;
}

export function autoPromoteTier(telegramId: number, realBalance: number, currentTier: string): string | null {
    // Determine correct tier from balance alone
    let targetTier: string;
    if (realBalance >= 50) {
        targetTier = 'MASTER';
    } else if (realBalance >= 10) {
        targetTier = 'PRO';
    } else {
        targetTier = 'DEMO';
    }

    // No change needed
    if (targetTier === currentTier) return null;

    return targetTier;
}
