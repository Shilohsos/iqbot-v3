/**
 * Marathon V2 — Live tracking marathon system.
 * Admin sets requirements (min balance, min trades, min growth).
 * Users click Marathon button → SDK balance check → registered/tracked.
 */
import type { Telegram } from 'telegraf';
/** Get a user's live IQ Option real balance in USD via SDK. */
export declare function getUserLiveBalanceUsd(telegramId: number): Promise<number | null>;
/** Admin creates a marathon: sets requirements + broadcasts to all approved users. */
export declare function startMarathonBroadcast(giveawayId: number, minBalanceUsd: number, minTrades: number, minGrowth: number, telegram: Telegram): Promise<void>;
/** User clicks Join Marathon → SDK balance check → register or redirect to fund. */
export declare function handleMarathonJoin(telegramId: number, configId: number): Promise<{
    message: string;
    markup?: any;
}>;
/** Marathon tracking loop — runs periodically (60s). Checks balance, trades, growth, sends push messages. */
export declare function tickMarathonTracking(telegram: Telegram): Promise<void>;
/** Get marathon leaderboard for display. */
export declare function getMarathonV2Leaderboard(configId: number): {
    telegram_id: number;
    trades_done: number;
    growth_multiplier: number;
    current_balance_usd: number;
    rank: number;
}[];
/** End marathon — mark config as ended. */
export declare function endMarathon(configId: number): void;
