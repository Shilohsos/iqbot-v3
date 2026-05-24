import type { Telegram } from 'telegraf';
import { getGiveawayEvent, getGiveawayEvents, getActiveGiveaways, type GiveawayEventInput, type GiveawayEvent } from './db.js';
export type { GiveawayEventInput, GiveawayEvent };
export { getGiveawayEvents, getActiveGiveaways, getGiveawayEvent };
export interface ParticipateResult {
    success: boolean;
    message: string;
    alreadyIn?: boolean;
    replyMarkup?: {
        inline_keyboard: Array<Array<{
            text: string;
            callback_data: string;
        } | {
            text: string;
            url: string;
        }>>;
    };
}
export declare function createGiveawayEvent(input: GiveawayEventInput): number;
export declare function activateGiveaway(giveawayId: number): Promise<void>;
export declare function participate(giveawayId: number, telegramId: number): Promise<ParticipateResult>;
export declare function recordTrade(telegramId: number, isMartingaleRecovery?: boolean): void;
export declare function selectWinners(giveawayId: number): Array<{
    telegram_id: number;
    participantId: number;
}>;
export declare function queueParticipantUpdate(giveawayId: number, participantId: number, telegramId: number, type: string, text: string): void;
export declare function sendMotivationalMessages(giveawayId: number): void;
export declare function activatePromoCode(giveawayId: number): Promise<void>;
export declare function activateMarathon(giveawayId: number): Promise<void>;
export declare function claimPromoCode(giveawayId: number, telegramId: number): Promise<{
    success: boolean;
    code?: string;
    message: string;
    replyMarkup?: ParticipateResult['replyMarkup'];
}>;
export declare function getMarathonLeaderboard(giveawayId: number): Array<{
    telegram_id: number;
    trade_count: number;
    rank: number;
}>;
export declare function checkMarathonDeadlines(telegram: Telegram): Promise<void>;
export declare function processUpdateQueue(telegram: Telegram): Promise<void>;
export declare function processNotificationsQueue(telegram: Telegram): Promise<void>;
