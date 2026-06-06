# Directive: Fix Admin Analysis to Match User Timeframe

**Authority:** Master Ferdinand Shiloh Hart  
**From:** Wizard  
**Date:** 2026-06-06

IMPORTANT: Merge master first before implementing.

---

## Problem

Admin analysis (`adminAnalyze`) ignores the user's selected timeframe and always analyzes 5m+1m+30s. This causes admin and users to get different signals on the same pair — admin can lose while users win.

## Fix

Remove the separate `admin-analysis.ts` file entirely. Admin uses the same `runAnalysis()` engine as PRO/MASTER users, but with two differences:

1. **70 candles** instead of 35
2. **Full 6-indicator** analysis (same as current `analyzeTimeframe()`)

### Changes

**1. Delete `src/admin-analysis.ts`** — no longer needed.

**2. Update `src/bot.ts`** — Change admin trade execution (around line 1458-1469) to call `runAnalysis()` directly with the selected timeframe and 70 candles:

```typescript
if (isAdmin) {
    const candlesFacade = await sdk.candles();
    const blitzOptions = await sdk.blitzOptions();
    const norm = (s: string) => s.toUpperCase().replace(/^front\./i, '').replace(/[-\/\s]/g, '');
    const normalizedPair = norm(pair);
    const active = blitzOptions.getActives().find(
        a => norm(a.ticker) === normalizedPair || norm(a.localizationKey) === normalizedPair
    );
    if (!active) throw new Error(`Unknown pair: ${pair}`);
    const history = await candlesFacade.getCandles(active.id, timeframe, { count: 70 }) as Candle[];
    if (history.length < 30) throw new Error('Not enough data');
    analysis = runAdminAnalysis(history);
} else {
    // existing user analysis path unchanged
}
```

**3. Create a lightweight `runAdminAnalysis()` function** — move the 6-indicator voting engine from `admin-analysis.ts` into a new function. This can live at the bottom of `bot.ts` or in a new small file. It takes candle data and returns `{ direction, confidence, reason }`. Same logic as `analyzeTimeframe()` but without multi-TF orchestration.

Place it in a new function in `bot.ts`:

```typescript
interface AdminCandle { close: number; max: number; min: number; }

function runAdminAnalysis(candles: AdminCandle[]): { direction: 'call' | 'put'; confidence: number; reason: string } {
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.max);
    const lows = candles.map(c => c.min);
    const lastClose = closes[closes.length - 1];

    const rsi = computeRSI(closes, 14);
    const rsiBull = rsi > 58, rsiBear = rsi < 42;

    const ema9 = computeEMA(closes, 9);
    const ema21 = computeEMA(closes, 21);
    const ema50 = computeEMA(closes, 50);
    const ema200 = computeEMA(closes, 200);
    const emaBull = ema9 > ema21, emaBear = ema9 < ema21;
    const emaStrongBull = ema50 > ema200, emaStrongBear = ema50 < ema200;

    const { macd, signal: macdSig, histogram } = computeMACDFull(closes, 12, 26, 9);
    const macdBull = macd > macdSig && histogram > 0;
    const macdBear = macd < macdSig && histogram < 0;

    const { mid, upper, lower } = computeBollingerFull(closes, 20, 2);
    const bbBull = lastClose > mid && lastClose < upper;
    const bbBear = lastClose < mid && lastClose > lower;

    const { k, d } = computeStochastic(highs, lows, closes, 14);
    const stochBull = k > d && k > 20;
    const stochBear = k < d && k < 80;

    const atr = computeATR(highs, lows, closes, 14);
    const avgPrice = closes.reduce((s, v) => s + v, 0) / closes.length;
    const hasVolatility = avgPrice > 0 && (atr / avgPrice) * 100 > 0.03;

    let bullVotes = 0, bearVotes = 0;
    if (rsiBull) bullVotes++; else if (rsiBear) bearVotes++;
    if (emaBull && emaStrongBull) bullVotes += 2; else if (emaBear && emaStrongBear) bearVotes += 2;
    else if (emaBull) bullVotes++; else if (emaBear) bearVotes++;
    if (macdBull) bullVotes++; else if (macdBear) bearVotes++;
    if (bbBull) bullVotes++; else if (bbBear) bearVotes++;
    if (stochBull) bullVotes++; else if (stochBear) bearVotes++;
    if (hasVolatility) { if (bullVotes >= bearVotes) bullVotes++; else bearVotes++; }

    const totalVotes = bullVotes + bearVotes;
    const direction: 'call' | 'put' = bullVotes >= bearVotes ? 'call' : 'put';
    const confidence = totalVotes > 0 ? Math.round((Math.max(bullVotes, bearVotes) / totalVotes) * 100) : 65;

    return { direction, confidence: Math.max(confidence, 65), reason: `${direction === 'call' ? 'BULLISH' : 'BEARISH'} (${confidence}%)` };
}
```

**4. Import helper functions** — `computeRSI`, `computeEMA`, `computeMACDFull`, `computeBollingerFull`, `computeStochastic`, `computeATR` — these already exist in `admin-analysis.ts`. Move them to a shared utils file or inline in `bot.ts`.

**5. Update imports in `src/bot.ts`** — Remove import of `adminAnalyze` and `AdminAnalysisResult`. Add import of the helper functions if moved separately.

## Key Result

Admin and user now analyze the **same timeframe** on the **same pair** with the **same candles** — just admin gets 70 candles + 6 indicators vs user's 35 candles + 4 indicators. Signals should agree on direction almost always, but admin has sharper conviction.

No more admin losing while user wins on the same pair.
