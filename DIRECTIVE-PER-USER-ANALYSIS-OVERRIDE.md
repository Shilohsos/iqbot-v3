# Directive: Per-User Analysis Override (Candle Count + Display Confidence)

**IMPORTANT: Merge master first** — must include latest master changes.

## Goal
Add per-user override columns to control analysis quality without affecting other users. Used to reduce candle count and boost displayed confidence for specific accounts.

## Changes

### 1. Add columns to users table

```sql
ALTER TABLE users ADD COLUMN analysis_candles INTEGER DEFAULT NULL;
ALTER TABLE users ADD COLUMN display_confidence_min INTEGER DEFAULT NULL;
```

- `analysis_candles`: override candle count for analysis (NULL = use default 35)
- `display_confidence_min`: minimum displayed confidence percentage (NULL = show actual value)

### 2. Modify `analysis.ts`

In `runAnalysis()`, accept an optional `candleCount` parameter:

```typescript
async function runAnalysis(sdk: ClientSdk, pair: string, timeframeSec: number, tier: string, candleCount?: number): Promise<AnalysisResult> {
    // ... existing code ...
    const count = candleCount ?? 35;
    const history = await candlesFacade.getCandles(active.id, timeframeSec, { count });
    if (history.length < Math.min(30, Math.floor(count * 0.85))) throw new Error('Not enough data for analysis');
    // ... rest of function ...
}
```

Pass the override through `analyzePairWithSdk` and `analyzePair`.

### 3. Modify `bot.ts` — trade handler

In the trade handler (around line 1644), pass per-user candle count:

```typescript
const user = getUser(ctx.from!.id);
const candleOverride = user?.analysis_candles ?? undefined;
analysis = await analyzePairWithSdk(sdk, pair, timeframe, analysisTier, candleOverride);
```

### 4. Modify `bot.ts` — confidence display

After analysis is returned, apply `display_confidence_min` floor before showing to user:

```typescript
const displayConfidence = user?.display_confidence_min 
    ? Math.max(analysis.confidence, user.display_confidence_min)
    : analysis.confidence;
// Use displayConfidence in all UI output instead of analysis.confidence
```

Also inject this into the analysis reason string (e.g., `BULLISH (4/4) | RSI ...` already shows confidence — the floor applies to the displayed percentage).

### 5. Seed data for target user

```sql
UPDATE users SET analysis_candles = 15, display_confidence_min = 80 WHERE telegram_id = 1341582495;
```

This gives rafiujunior:
- **15 candles** (was 35) — less data = less accurate signals
- **80% min displayed confidence** — every trade shows 80%+ regardless of actual confidence

### Files to modify
- `analysis.ts` — candle count parameter in `runAnalysis()`, `analyzePairWithSdk()`, `analyzePair()`
- `bot.ts` — pass user config, apply confidence floor in display
- `db.ts` — schema migration (ALTER TABLE) + getUser() already returns all columns so no change needed for the query

## Verification
1. Run `SELECT analysis_candles, display_confidence_min FROM users WHERE telegram_id = 1341582495;` to confirm seed
2. Take a trade on rafiujunior's account — verify displayed confidence is 80%+
3. Verify other users' analysis is unchanged (still 35 candles, actual confidence)
