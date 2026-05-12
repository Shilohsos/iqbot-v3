# Issue 31: Trade result not reported — waitForResult websocket subscription misses position close

## Symptom
After trading, the bot shows "Trade 1|Step 1|🟡 $X.XX → in flight" permanently. The trade actually executes and closes on IQ Option (visible in portfolio with win/loss amount), but the bot never sends the result message.

## Root Cause
**File:** `src/trade.ts`, function `waitForResult()` (lines 130-168)

The function relies **solely** on a websocket subscription (`positions.subscribeOnUpdatePosition(callback)`) to detect when a trade position closes. For fast Blitz trades (1m), this can miss the event:

1. `blitzOptions.buy()` buys the option → returns `option.id`
2. `positions.getOpenedPositions()` checks for the position — but it may not be there yet (async gap)
3. `positions.subscribeOnUpdatePosition(callback)` subscribes for future updates
4. Trade opens and closes within 60 seconds
5. Position-closed event fires via websocket, but the callback needs `externalId` to match — and `externalId` was never set because step 2 missed it
6. Without `externalId`, the callback can't match the position → result never returned
7. After 150s timeout, TIMEOUT is returned — but the user already sees the trade completed on IQ Option

## Proof
- User screenshot: trade shows in IQ Option portfolio (EUR/USD OTC +$18.70) ✅
- Same trade in Telegram: still shows "in flight" ❌
- No error message was ever sent — the subscription simply never matched

## Fix Required
Add a polling fallback in `waitForResult()` that periodically scans opened positions every 5 seconds. This catches cases where the real-time subscription misses the close event.

Specifically, the `waitForResult` function needs:
1. A `setInterval` polling timer every 5 seconds
2. On each poll: re-scan `positions.getOpenedPositions()` for `orderIds.includes(optionId)` to capture `externalId` if subscription missed it
3. On each poll: check if any matched position has `status === 'closed'` and return the result
4. Clear both the timeout timer AND the poll interval when a result is found

## Additional context: `analyzePair` timeout
The error log also shows `TimeoutError: Promise timed out after 90000 milliseconds` from the SDK's `p-timeout` wrapper. This happens in `analyzePair()` which creates its own SDK connection via `createSdk()`. The 90-second timeout may be from `sdk.turboOptions()` or other SDK calls. When this timeout fires inside the `pair:` handler, the `catch` at line 793 handles it and sends "Analysis failed". This is separate from the trade result issue but worth reviewing whether the SDK timeout configuration can be adjusted.

## Acceptance Criteria
- [ ] Trade result arrives even when websocket subscription misses the close event
- [ ] Polling fallback catches all positions within 5 seconds of close
- [ ] No more "in flight" messages stuck permanently
- [ ] Both subscription path AND polling path clean up properly (no double resolution, no memory leaks)
- [ ] Test: place a 1m Blitz trade, confirm result message appears within 2 minutes
