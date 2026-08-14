interface Notifier {
    sendMessage(chatId: number, text: string, extra?: unknown): Promise<{
        message_id: number;
    }>;
    editMessageText(chatId: number, msgId: number, inlineId: undefined, text: string, extra?: unknown): Promise<unknown>;
}
export declare function setSwarmNotifier(n: Notifier): void;
interface SwarmSession {
    id: number;
    telegram_id: number;
    starting_capital: number;
    gale_rounds: number;
    duration_min: number;
    started_at: number;
    ends_at: number;
    status: 'running' | 'completed' | 'expired';
    status_msg_id: number | null;
    total_trades: number;
    total_pnl: number;
    currency: string;
}
export declare function initSwarmDb(): void;
export declare function startSwarm(telegramId: number, startingCapital: number, galeRounds: number, durationMin: number, currency?: string): Promise<{
    ok: boolean;
    error?: string;
}>;
export declare function getSwarmSession(telegramId: number): SwarmSession | null;
export declare function stopSwarm(telegramId: number): boolean;
export declare function getSwarmStats(telegramId: number): {
    trades: number;
    pnl: number;
    remaining_min: number;
} | null;
export {};
