interface Notifier {
    sendMessage(chatId: number, text: string, extra?: unknown): Promise<{
        message_id: number;
    }>;
    editMessageText(chatId: number, msgId: number, inlineId: undefined, text: string, extra?: unknown): Promise<unknown>;
    /** Re-login with stored creds and return the fresh SSID, or null on failure.
     *  Injected from bot.ts (which owns autoReconnect/loginAndCaptureSsid). */
    reconnect(telegramId: number): Promise<string | null>;
}
export declare function initAutoEngine(n: Notifier): void;
export declare const autoEngine: {
    isRunning(telegramId: number): boolean;
    getDemoMinutes(telegramId: number): number;
    /** Start (or restart) the engine for a user whose session row is already 'running'. */
    start(telegramId: number, mode?: 'demo' | 'live'): boolean;
    /** Graceful stop — finishes the current run, then the loop exits. */
    stop(telegramId: number): void;
    pause(telegramId: number): void;
    /** Resume a paused session from where it left off. */
    resume(telegramId: number): boolean;
    /** Rehydrate every 'running' session after a process restart (directive §5.5/E). */
    restoreAll(): Promise<void>;
};
export {};
