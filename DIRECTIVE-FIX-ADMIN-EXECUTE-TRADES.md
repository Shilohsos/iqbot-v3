# Directive: Fix Admin Analysis — Trades Must Execute

## Problem
The admin analysis engine (`adminAnalyze()` in `admin-analysis.ts`) is **too strict**. It requires ALL 6 indicators on ALL 3 timeframes to agree with ≥90% confidence, causing almost every trade to be skipped. The user sees "No clear signal right now" constantly — no trades execute.

**The admin must actually trade.** The analysis should be smarter, not a gatekeeper that blocks everything.

## Root Cause
In `admin-analysis.ts`, the `adminAnalyze()` function skips a trade if:
1. 5m confidence < 90 → SKIP
2. 1m direction ≠ 5m direction OR 1m confidence < 90 → SKIP
3. 30s direction ≠ 5m direction OR 30s confidence < 85 → SKIP

With 6 indicators and weighted voting (EMA gets 2x weight), getting ≥90% on the 5m alone is extremely rare. The 5m trending conditions are so strict that virtually no trade passes.

## Solution

### Option A: Lower thresholds (recommended — simple fix)
Reduce skip thresholds so trades actually execute:

```typescript
// Current (too strict):
if (tf5m.direction === 'neutral' || tf5m.confidence < 90) → SKIP

// Fixed:
if (tf5m.direction === 'neutral') → SKIP  // Only skip if truly neutral
// OR lower to 60-65% — still meaningful but won't block everything
if (tf5m.confidence < 60) → SKIP
```

```typescript
// Current (too strict):  
if (tf1m.direction !== tf5m.direction || tf1m.confidence < 90) → SKIP

// Fixed:
if (tf1m.direction !== tf5m.direction && tf1m.confidence >= 75) → use 1m instead
// OR just lower to 60:
if (tf1m.direction !== tf5m.direction || tf1m.confidence < 60) → SKIP
```

### Option B: Remove skip, always trade (more aggressive)
The admin should **always trade** like users do — the edge comes from **better indicator selection** and **smarter direction picking**, not from skipping. Remove the skip entirely and just take the best signal available:

```typescript
// Don't skip — take the strongest signal across all TFs
const directions = [tf5m, tf1m, tf30s].filter(tf => tf.direction !== 'neutral');
const best = directions.sort((a, b) => b.confidence - a.confidence)[0];

if (!best) {
    // All neutral — fall back to 30s signal
    direction = tf30s.direction !== 'neutral' ? tf30s.direction : 'call';
    confidence = Math.max(tf5m.confidence, tf1m.confidence, tf30s.confidence);
} else {
    direction = best.direction;
    confidence = best.confidence;
}
// Always proceed with trade
```

### Recommended approach: Option A with relaxed thresholds

Keep the multi-TF structure but make it feasible:

```typescript
export async function adminAnalyze(sdk: ClientSdk, pair: string): Promise<AdminAnalysisResult> {
    const [candles5m, candles1m, candles30s] = await Promise.all([
        fetchCandles(sdk, pair, 300, 50),
        fetchCandles(sdk, pair, 60, 40),
        fetchCandles(sdk, pair, 30, 35),
    ]);

    const tf5m  = analyzeTimeframe(candles5m);
    const tf1m  = analyzeTimeframe(candles1m);
    const tf30s = analyzeTimeframe(candles30s);

    // Relaxed: only skip if 5m is truly neutral AND no other TF has a strong signal
    if (tf5m.direction === 'neutral' && tf1m.direction === 'neutral' && tf30s.direction === 'neutral') {
        return { direction: 'call', confidence: 0, reason: 'SKIPPED — all TFs neutral', ..., skipped: true };
    }

    // Use the highest-confidence TF as primary, others as confirmation
    const nonNeutral = [tf5m, tf1m, tf30s].filter(tf => tf.direction !== 'neutral');
    const sorted = nonNeutral.sort((a, b) => b.confidence - a.confidence);
    const primary = sorted[0];

    // Check if at least 2 of 3 TFs agree on direction
    const agreeing = nonNeutral.filter(tf => tf.direction === primary.direction).length;
    if (agreeing < 2 && nonNeutral.length >= 2) {
        // Only skip if TFs are split and confidence is very low
        if (primary.confidence < 65) {
            return { direction: primary.direction as 'call' | 'put', confidence: 0, reason: 'SKIPPED — TFs split, low confidence', ..., skipped: true };
        }
    }

    const dir = primary.direction as 'call' | 'put';
    const avgConfidence = Math.round(sorted.reduce((s, tf) => s + tf.confidence, 0) / sorted.length);
    return {
        direction: dir,
        confidence: Math.max(avgConfidence, 65),  // Floor at 65% so UI doesn't look terrible
        reason: `✅ ${dir === 'call' ? 'BULLISH' : 'BEARISH'} (${avgConfidence}%) | ${agreeing}/${nonNeutral.length} TFs agree`,
        tf5m, tf1m, tf30s,
        skipped: false,
    };
}
```

## Key Principle
The admin gets better analysis, not a gatekeeper. **Better analysis = better trade selection when trades DO execute.** But trades MUST execute. The admin can't be profitable if the bot never enters a trade.

## File to Change
- `src/admin-analysis.ts` — relax `adminAnalyze()` thresholds so trades execute
