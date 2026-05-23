export const TIER_CONFIGS = {
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
export function getTierConfig(tier) {
    const key = (tier ?? 'DEMO').toUpperCase();
    return TIER_CONFIGS[key] ?? TIER_CONFIGS.DEMO;
}
export function normalizeTier(tier) {
    const key = (tier ?? 'DEMO').toUpperCase();
    if (key === 'PRO')
        return 'PRO';
    if (key === 'MASTER')
        return 'MASTER';
    return 'DEMO';
}
