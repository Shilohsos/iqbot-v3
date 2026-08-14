import type { Context } from 'telegraf';
type Btn = {
    text: string;
    callback_data: string;
} | {
    text: string;
    url: string;
};
export declare function sendTemplate(ctx: Context, key: string, extraKeyboard?: {
    inline_keyboard: Btn[][];
}, overrideMessage?: string): Promise<void>;
/** Called after IQ Option User ID verified. Advances to email step. */
export declare function handleUserIdVerified(ctx: Context, telegramId: number): Promise<void>;
/** Called on User ID verify failure. */
export declare function handleUserIdFailed(ctx: Context, telegramId: number, attempt: number): Promise<void>;
/** After email collected. Advances to password step. */
export declare function handleEmailCollected(ctx: Context, telegramId: number): Promise<void>;
/** Called after successful login. Marks connected. */
export declare function handleConnected(ctx: Context, telegramId: number, balanceText?: string): Promise<void>;
export {};
