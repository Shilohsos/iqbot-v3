import type { ClientSdk } from './index.js';
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
/**
 * Converts an amount to USD. Returns null when no rate is available — callers
 * MUST skip balance-threshold decisions (tier promotion/demotion, giveaway
 * eligibility) on null rather than treating it as $0.
 */
export declare function convertToUsd(amount: number, currency: string, sdk: ClientSdk): Promise<number | null>;
export declare function autoPromoteTier(telegramId: number, realBalance: number, currentTier: string): string | null;
