# DIRECTIVE: Reuse SDK Connection Across Analysis + Trade Execution

## Problem

Every action creates its own fresh WebSocket connection to IQ Option:

1. `analyzePair()` → `createSdk()` + `sdk.shutdown()` — one connection
2. Each martingale round → `executeTrade()` → `ClientSdk.create()` + `sdk.shutdown()` — 2-6 more connections

Each connection takes **60-194 seconds** to establish. If a martingale has 3 rounds, that's 3-10 minutes of just connecting. The 120s timeout we added fires before the connection succeeds, killing the trade.

## Root Cause

When the SDK pool was reverted (due to concurrent connection conflicts), every operation went back to fresh connections. The analysis and trade execution now use separate connections when they could share one.

## Solution

Create **one SDK connection at the start of the trade session** and reuse it for:
1. Analysis (candle fetch + compute)
2. All martingale rounds (buy + wait for result)

Shut it down once at the end.

---

## Changes Required

### 1. `src/analysis.ts` — Add `analyzePairWithSdk` function

Add a new function that accepts a pre-connected SDK instead of creating its own:

```typescript
/**
 * Analyze a pair using an already-connected SDK instance.
 * Same logic as analyzePair() but caller owns the SDK lifecycle.
 */
export async function analyzePairWithSdk(
    sdk: ClientSdk,
    pair: string,
    timeframeSec: number,
    tier = 'NEWBIE'
): Promise<AnalysisResult> {
    const turboOptions = await sdk.turboOptions();
    const normTicker = (s: string) => s.toUpperCase().replace(/^front\./i, '').replace(/[-/\s]/g, '');
    const normalizedInput = normTicker(pair);
    const active = turboOptions.getActives().find(a =>
        normTicker(a.ticker) === normalizedInput ||
        normTicker(a.localizationKey) === normalizedInput
    );
    if (!active) throw new Error(`Unknown pair: ${pair}`);

    const candlesFacade = await sdk.candles();
    const history = await candlesFacade.getCandles(active.id, timeframeSec, { count: 50 });

    if (history.length < 35) throw new Error('Not enough data for analysis');

    const closes = history.map(c => c.close);

    // ——— identical analysis logic from here down ———
    // (copy the existing NEWBIE/PRO analysis logic, minus createSdk/shutdown)

    // ─── Indicator 1: RSI(14) ─────────────────────────────────────────────
    const rsi = computeRSI(closes, 14);
    const rsiBullish = rsi > 50;

    // ─── Indicator 2: EMA9 / EMA21 crossover ──────────────────────────────
    const ema9  = computeEMA(closes, 9);
    const ema21 = computeEMA(closes, 21);
    const emaBullish = ema9 > ema21;

    if ((tier ?? 'NEWBIE').toUpperCase() !== 'PRO') {
        const bullishScore = (rsiBullish ? 50 : 0) + (emaBullish ? 50 : 0);
        const direction: 'call' | 'put' = bullishScore >= 50 ? 'call' : 'put';
        const sentiment = bullishScore >= 50 ? 'BULLISH' : 'BEARISH';
        const crossStr = emaBullish ? 'EMA9 > EMA21' : 'EMA9 < EMA21';
        const reason = `${sentiment} (+${bullishScore}%) | RSI ${rsi.toFixed(1)}, ${crossStr}`;
        return { direction, confidence: bullishScore, reason };
    }

    // PRO path
    const { macd, signal: macdSignal } = computeMACD(closes, 12, 26, 9);
    const { mid, lower } = computeBollinger(closes, 20, 2);
    const lastClose = closes[closes.length - 1];

    const macdBull  = macd > macdSignal;
    const bollBull  = lastClose < lower || lastClose > mid;

    const votes     = [rsiBullish, emaBullish, macdBull, bollBull].filter(Boolean).length;
    const confidence = votes / 4 * 100;
    const direction: 'call' | 'put' = confidence >= 75 ? 'call' : 'put';
    const signals = [
        `RSI ${rsi.toFixed(1)} ${rsiBullish ? '▲' : '▼'}`,
        `EMA ${emaBullish ? '▲' : '▼'}`,
        `MACD ${macdBull ? '▲' : '▼'}`,
        `BB ${bollBull ? '▲' : '▼'}`,
    ].join(' | ');
    const reason = `${direction === 'call' ? 'BULLISH' : 'BEARISH'} (${votes}/4) | ${signals}`;
    return { direction, confidence, reason };
}
```

Also add `ClientSdk` to the import at line 1:
```typescript
import { createSdk } from './trade.js';
// becomes:
import { createSdk } from './trade.js';
import type { ClientSdk } from './index.js';
```

### 2. `src/bot.ts` — Restructure pair handler to reuse SDK

**In the pair handler (around line 858-945), restructure to:**

1. Create ONE SDK connection at the start
2. Use `analyzePairWithSdk` instead of `analyzePair`
3. Pass the SDK to `runMartingale` (which passes it to `executeTradeWithSdk`)
4. Shutdown SDK when done

```typescript
bot.action(/^pair:(.+)$/, async ctx => {
    // ... existing setup code (lines 859-886) unchanged ...

    // Create ONE SDK connection — shared across analysis + all martingale rounds
    let sdk;
    try {
        sdk = await Promise.race([
            createSdk(ssid),
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('Connection timed out')), 120_000)
            ),
        ]);
    } catch {
        // clean up L7 image etc.
        await ctx.reply('❌ Could not connect to IQ Option. Try again.');
        return;
    }

    try {
        const analysisUser = getUser(ctx.from!.id);
        const analysisTier = (analysisUser?.tier ?? 'NEWBIE').toUpperCase();

        // Use the shared SDK for analysis
        analysis = await analyzePairWithSdk(sdk, pair, timeframe, analysisTier);

        // ... existing result display (lines 903-940) ...

        // Pass the SDK to martingale
        await runMartingale(ctx, ssid, pair, analysis.direction, amount, timeframe, 
            mode === 'live' ? 'live' : 'demo', martingaleRounds, preTradeMessageIds, sdk);
    } finally {
        await sdk.shutdown();
    }
});
```

### 3. `src/bot.ts` — Update `runMartingale` to accept and reuse SDK

Add an optional `sdk` parameter to `runMartingale` at line 530:

```typescript
async function runMartingale(
    ctx: Context,
    ssid: string,
    pair: string,
    direction: 'call' | 'put',
    amount: number,
    timeframeSec = 60,
    balanceType: 'demo' | 'live' = 'demo',
    martingaleRounds?: number,
    preTradeMessageIds: number[] = [],
    existingSdk?: ClientSdk,  // ← ADD THIS
): Promise<void> {
```

Then in the trade loop (line 585-587), use `executeTradeWithSdk` when a shared SDK is available:

```typescript
// Replace line 587:
result = await withTimeout(executeTrade(ssid, roundTrade), roundTimeoutMs, 'trade');

// With conditional:
if (existingSdk) {
    result = await withTimeout(executeTradeWithSdk(existingSdk, roundTrade), roundTimeoutMs, 'trade');
} else {
    result = await withTimeout(executeTrade(ssid, roundTrade), roundTimeoutMs, 'trade');
}
```

Also add `executeTradeWithSdk` and `ClientSdk` to the `runMartingale` imports if not already there.

### 4. Update imports

**In `bot.ts`**, add to the existing import from `./trade.js`:
```typescript
import { executeTrade, executeTradeWithSdk, createSdk, type TradeRequest, type TradeResult } from './trade.js';
```

**In `bot.ts`**, add to the existing import from `./analysis.js`:
```typescript
import { analyzePair, analyzePairWithSdk, type AnalysisResult } from './analysis.js';
```

**In `bot.ts`**, add `ClientSdk` type import:
```typescript
import type { ClientSdk } from './index.js';
```

---

## Result

**Before (per trade session):**
- Connection #1: analysis (60-194s)
- Connection #2: round 1 (60-194s)
- Connection #3: round 2 (60-194s, if martingale)
- Connection #4: round 3 (60-194s, if martingale)
- Total: 4-8 minutes of just connecting

**After (per trade session):**
- Connection #1: shared for analysis + all rounds
- SDK stays alive for the full session (~2-5 minutes)
- Total: 1 connection, ~60-120s

## Acceptance Criteria

- [ ] Pair analysis succeeds using the shared SDK
- [ ] All martingale rounds execute on the same SDK
- [ ] No "authentication is failed" errors (the concurrency issue was with MULTIPLE SSIDs on one SDK, not one SSID on one SDK)
- [ ] Trade completes in under 3 minutes total (vs 4-8 minutes before)
- [ ] `npx tsc --noEmit false` passes
- [ ] PM2 restart → bot comes up clean
