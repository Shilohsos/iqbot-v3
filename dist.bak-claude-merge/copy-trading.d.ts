interface Notifier {
    sendMessage(chatId: number, text: string, extra?: unknown): Promise<{
        message_id: number;
    }>;
}
export declare function setCopyNotifier(n: Notifier): void;
export declare function initCopyDb(): void;
interface CopyConfig {
    trading_active: number;
    assets: string[];
    timeframe: number;
    gale_rounds: number;
}
export declare function getCopyConfig(): CopyConfig;
export declare function updateCopyConfig(updates: Partial<CopyConfig>): void;
export declare function startCopying(telegramId: number, copyAmount: number): Promise<{
    ok: boolean;
    error?: string;
}>;
export declare function stopCopying(telegramId: number): void;
export declare function getCopyStatus(telegramId: number): {
    copying: boolean;
    amount: number;
};
export declare function getConnectedCopyUsers(): {
    telegram_id: number;
    copy_amount: number;
}[];
export declare function adminToggleTrading(on: boolean): void;
export declare function adminSetAssets(assets: string[]): void;
export declare function adminSetTimeframe(timeframe: number): void;
export declare function adminSetGaleRounds(gale: number): void;
export {};
