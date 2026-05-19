# DIRECTIVE: Remove handlerTimeout — It's Breaking In-Flight Trades

## Problem

`handlerTimeout` is killing trade execution handlers mid-flight. The handler chain for a pair callback does:

```
answerCbQuery() → analyzePair (SDK connect + WS + candles + compute) → runMartingale (SDK connect + WS + buy + waitForResult)
```

For a 1m trade, `waitForResult` waits `targetSize + 90` = 150 seconds. Even with the 30s increase, the handler is killed while the trade is still executing on IQ Option. This:

1. Corrupts `wizardSessions` — user can't start a new trade
2. Leaves the trade running blind on IQ Option (no UI updates)
3. Causes "Session expired" / "Request timed out" errors on subsequent attempts

## Fix

### `src/bot.ts` — Remove `handlerTimeout` entirely

**Find and delete line 2318** (the line with `(bot as any).options.handlerTimeout = 30_000;`):

```typescript
// DELETE this line entirely:
(bot as any).options.handlerTimeout = 30_000;
```

### `src/bot.ts` — Update `bot.catch` timeout message

The timeout message we added is still useful as a safety net. Keep it but make it more specific:

```typescript
// Lines 2308-2313 — the handler already looks correct, no change needed
if (msg.includes('timed out')) {
    ctx.reply(
        '⏳ *Request timed out*...'
    ).catch(() => {});
}
```

### `src/bot.ts` — Add session cleanup on timeout

When a timeout occurs during a trade, the `wizardSessions` for that user may be stale. Add a cleanup:

```typescript
// In the bot.catch handler, after the timeout reply (around line 2312), add:
if (ctx.from?.id) {
    wizardSessions.delete(ctx.chat!.id);
    activeTradeSessions.delete(ctx.from!.id);
}
```

But `wizardSessions` and `activeTradeSessions` are module-level Maps — they need to be accessible from the catch handler. They already are (defined at module scope). Add this right after the timeout reply to reset the user's session state.

## Rationale

`handlerTimeout` in Telegraf v4 sets a timeout on the middleware chain. When it fires:

- The handler promise is rejected
- `bot.catch()` fires
- The underlying async operations (SDK WS, trade execution) CONTINUE in the background
- But the bot loses the ability to update the Telegram UI

For short operations (reply to button press, show keyboard), handlerTimeout is fine. For trade execution which naturally takes 30-150+ seconds, it's destructive.

The slow-handler middleware (already added in the last commit) will still log any handler taking >3s — that's sufficient for debugging without breaking trades.

## Alternative: Increase to 600s

If you prefer keeping a safety net (e.g., to catch truly stuck handlers), set it to 600_000 (10 minutes) instead of removing it. This covers:
- 30s option: ~120s (30 + 90)
- 1m option: ~150s (60 + 90)
- 5m option: ~390s (300 + 90)

600s gives comfortable margin.

## Acceptance Criteria

- [ ] Users can complete a full trade (amount → timeframe → pair → analysis → execute → wait for result → see WIN/LOSS) without timeout
- [ ] After a trade completes, the UI updates correctly with the result
- [ ] Subsequent trades work without "session expired" errors
- [ ] Slow handlers (>3s) are still logged for debugging
- [ ] `npx tsc --noEmit false` passes
- [ ] PM2 restart → bot comes up clean
