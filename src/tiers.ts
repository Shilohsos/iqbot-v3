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
        if (!rate || rate <= 0) return amount;
        rateCache.set(currency, { rate, expires: Date.now() + 3_600_000 });
        return amount * rate;
    } catch {
        logger.warn('tiers', `currency conversion failed for ${currency}, treating as USD`);
        return amount;
    }
}

export function autoPromoteTier(telegramId: number, realBalance: number, currentTier: string): string | null {
    // User is already MASTER — no promotion needed
    if (currentTier === 'MASTER') return null;

    // $50+ → MASTER (if not already)
    if (realBalance >= 50) return 'MASTER';

    // $10+ → PRO (only if currently DEMO)
    if (realBalance >= 10 && currentTier === 'DEMO') return 'PRO';

    return null;
}
