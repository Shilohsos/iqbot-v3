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
export declare const TIER_CONFIGS: Record<string, TierConfig>;
export declare function getTierConfig(tier: string | null | undefined): TierConfig;
export declare function normalizeTier(tier: string | null | undefined): 'DEMO' | 'PRO' | 'MASTER';
