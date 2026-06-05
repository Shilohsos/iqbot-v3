# Fix 2 Critical Trade Bugs

---

## IMPORTANT: Merge master first

This branch is based on master. Before implementing, ensure you're on master with the latest merge.

---

## Bug 1: Confidence formula shows 0% for bearish signals

**File:** `src/analysis.ts`  
**Lines:** 59-68

**Problem:** The confidence formula only counts bullish votes. When all 4 indicators agree on a PUT direction, `bullishVotes = 0`, so confidence = 0%. The display shows "Confidence: 0%" which looks like the bot has no conviction, even though the signal is actually 100% bearish.

**Fix:** Change the formula to use `max(bullishVotes, bearishVotes) / totalVotes * 100`. Compute bearish votes explicitly (4 - bullishVotes for PRO/MASTER, 2 - bullishScore% for DEMO).

For PRO/MASTER (lines 54-68), change:

```typescript
const rsiBull  = rsi > 50;
const emaBull  = ema9 > ema21;
const macdBull = macd > macdSignal;
const bollBull = lastClose > mid && lastClose < upper;

const votes      = [rsiBull, emaBull, macdBull, bollBull].filter(Boolean).length;
const confidence = votes / 4 * 100;
const direction: 'call' | 'put' = confidence >= 75 ? 'call' : 'put';
const signals = [
    `RSI ${rsi.toFixed(1)} ${rsiBull ? '▲' : '▼'}`,
    `EMA ${emaBull ? '▲' : '▼'}`,
    `MACD ${macdBull ? '▲' : '▼'}`,
    `BB ${bollBull ? '▲' : '▼'}`,
].join(' | ');
return { direction, confidence, reason: `${direction === 'call' ? 'BULLISH' : 'BEARISH'} (${votes}/4) | ${signals}` };
```

To:

```typescript
const rsiBull  = rsi > 50;
const emaBull  = ema9 > ema21;
const macdBull = macd > macdSignal;
const bollBull = lastClose > mid && lastClose < upper;

const bullVotes   = [rsiBull, emaBull, macdBull, bollBull].filter(Boolean).length;
const bearVotes   = 4 - bullVotes;
const confidence  = Math.max(bullVotes, bearVotes) / 4 * 100;
const direction: 'call' | 'put' = bullVotes >= 3 ? 'call' : 'put';
const signals = [
    `RSI ${rsi.toFixed(1)} ${rsiBull ? '▲' : '▼'}`,
    `EMA ${emaBull ? '▲' : '▼'}`,
    `MACD ${macdBull ? '▲' : '▼'}`,
    `BB ${bollBull ? '▲' : '▼'}`,
].join(' | ');
const directionLabel = bullVotes >= 3 ? 'BULLISH' : bearVotes >= 3 ? 'BEARISH' : 'NEUTRAL';
return { direction, confidence, reason: `${directionLabel} (${Math.max(bullVotes, bearVotes)}/4) | ${signals}` };
```

For DEMO (lines 71-74), change:

```typescript
const bullishScore = (rsi > 50 ? 50 : 0) + (ema9 > ema21 ? 50 : 0);
const direction: 'call' | 'put' = bullishScore >= 50 ? 'call' : 'put';
const reason = `${bullishScore >= 50 ? 'BULLISH' : 'BEARISH'} (+${bullishScore}%) | RSI ${rsi.toFixed(1)}, ${ema9 > ema21 ? 'EMA9 > EMA21' : 'EMA9 < EMA21'}`;
return { direction, confidence: bullishScore, reason };
```

To:

```typescript
const bullScore  = (rsi > 50 ? 50 : 0) + (ema9 > ema21 ? 50 : 0);
const bearScore  = 100 - bullScore;
const confidence = Math.max(bullScore, bearScore);
const direction: 'call' | 'put' = bullScore >= 50 ? 'call' : 'put';
const label = bullScore >= 50 ? 'BULLISH' : 'BEARISH';
const reason = `${label} (${Math.round(confidence)}%) | RSI ${rsi.toFixed(1)}, ${ema9 > ema21 ? 'EMA9 > EMA21' : 'EMA9 < EMA21'}`;
return { direction, confidence, reason };
```

---

## Bug 2: executeTradeWithSdk re-throws unrecognized errors → crashes bot

executeTradeWithSdk at line 98-105 catches errors but **re-throws** anything that isn't a TimeoutError. This causes an unhandled promise rejection when the SDK throws a non-standard error type (e.g., network error, websocket disconnect, or an internal SDK error).

The evidence: PM2 logs show the bot restarted at 18:01:42 — 2 minutes into a martingale recovery round — with no error output logged.

**Fix:**

1. **`src/trade.ts` line 104** — Change `throw err` to `return errorResult(trade, String(err))` so ALL errors produce a safe ERROR result:

```typescript
} catch (err: unknown) {
    if (isTimeoutError(err)) {
        return errorResult(trade, 'IQ Option timed out');
    }
    // ANY error from the SDK should be a safe ERROR result, not a crash
    const msg = err instanceof Error ? err.message : String(err);
    return errorResult(trade, msg);
}
```

2. **`src/trade.ts`** — Export `errorResult` (currently only used internally). Change `export function executeTradeWithSdk` to ensure it's accessible. Actually `errorResult` is already defined in this file. The fix above is sufficient.

3. **`src/bot.ts` line 918** — Also ensure the outer catch never propagates. After the catch block runs and returns, add a `.catch()` on the main trade promise to swallow any remaining unhandled rejection:

Find the `tradePromise` declaration (around line 1486) and change it to:

```typescript
const tradePromise = runMartingale(ctx, ssid, pair, analysis.direction, amount, timeframe, (mode ?? 'live') as 'demo' | 'live', martingaleRounds, preTradeMessageIds, sdk)
    .catch(err => {
        logger.error('trade', `Unhandled trade error: ${err instanceof Error ? err.message : String(err)}`);
    });
```

---

## Verification

1. `npx tsc --noEmit` — must pass with zero errors
2. Run `/admin tf AUDUSD-OTC 1m` on a MASTER account — a bearish signal should show confidence > 50% instead of 0%
3. Run a trade on that signal — should execute normally (confirm by checking "in flight" → WIN/LOSS within expected time, not stuck)
