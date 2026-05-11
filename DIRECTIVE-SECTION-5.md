# Section 5: Multi-Facade Timeframe Support (Blitz + Binary)

## Goal

Replace turbo-only trade execution with multi-facade support. Each timeframe maps to
the correct SDK facade based on what instruments are actually available:

```
30s  → Blitz
60s  → Blitz
300s → Blitz
900s → Binary
```

## Background

Diagnostic confirmed:

```
Blitz:  [30, 45, 60, 120, 180, 300]   ← all three target sizes
Turbo:  [60]                           ← 60s only (not needed now)
Binary: [900]                          ← 15m only
```

## Changes Required

### 1. Update timeframe keyboard (`src/menu.ts`)

Current: 1m, 5m, 15m
New: **30s, 1m, 5m, 15m**

```typescript
export function timeframeKeyboard(): IKMarkup {
    return {
        inline_keyboard: [
            [
                { text: '30s', callback_data: 'tf:30' },
                { text: '1m', callback_data: 'tf:60' },
                { text: '5m', callback_data: 'tf:300' },
                { text: '15m', callback_data: 'tf:900' },
            ],
            [{ text: '❌ Cancel', callback_data: 'wizard:cancel' }],
        ],
    };
}
```

Also update `tfLabel()`:
```typescript
export function tfLabel(timeframeSec: number): string {
    if (timeframeSec === 30) return '30s';
    if (timeframeSec === 60) return '1m';
    if (timeframeSec === 300) return '5m';
    return '15m';
}
```

### 2. Multi-facade trade execution (`src/trade.ts`)

Add facade selection logic to `executeTradeWithSdk()`:

```typescript
// Select facade based on timeframe
const targetSize = trade.timeframeSec ?? 60;

if (targetSize === 900) {
    // Binary Options for 15m
    const binaryOptions = await sdk.binaryOptions();
    const active = binaryOptions.getActives().find(...)
    const instrumentsFacade = await active.instruments();
    const available = instrumentsFacade.getAvailableForBuyAt(currentTime);
    const instrument = available.find(i => i.expirationSize === 900 && ...);
    const option = await binaryOptions.buy(active, dir, trade.amount, demoBalance);
} else {
    // Blitz Options for 30s, 60s, 300s
    const blitzOptions = await sdk.blitzOptions();
    const active = blitzOptions.getActives().find(...)
    // Blitz uses active.expirationTimes (no .instruments())
    if (!active.expirationTimes.includes(targetSize)) {
        return errorResult(trade, `No ${targetSize}s instrument available for ${trade.pair}`);
    }
    const option = await blitzOptions.buy(active, dir, targetSize, trade.amount, demoBalance);
}
```

**Important differences between Blitz and Turbo/Binary:**
- Blitz: `active.expirationTimes: number[]` — no `.instruments()` call
- Blitz: `blitzOptions.buy(active, direction, expirationSize, price, balance)` — takes `expirationSize` as a parameter
- Binary: `binaryOptions.buy(instrument, direction, price, balance)` — takes `instrument` object
- Blitz direction: `BlitzOptionsDirection.Call` / `BlitzOptionsDirection.Put`

### 3. Wait for result

Both Blitz and Binary options have position tracking. The existing `waitForResult()`
uses `sdk.positions()` which should work for both. Verify this.

If not, Blitz options may need a different result tracking mechanism — check the
SDK's `BlitzOptionsOption` class for result fields.

## Files to Change

- `src/menu.ts` — new timeframe buttons + `tfLabel()`
- `src/trade.ts` — facade selection logic, Blitz buy path, Binary buy path

## Don't Change

- `src/bot.ts` — wizard flow unchanged
- `src/analysis.ts` — analysis still uses candles, same regardless of facade
- `src/db.ts` — schema unchanged

## Acceptance Criteria

1. 30s timeframe → trades via Blitz, 30s expiry ✅
2. 1m timeframe → trades via Blitz, 60s expiry ✅
3. 5m timeframe → trades via Blitz, 300s expiry ✅
4. 15m timeframe → trades via Binary, 900s expiry ✅
5. Analysis still works on all timeframes (candles aren't facade-specific)
6. Results (WIN/LOSS/TIE) delivered for both Blitz and Binary trades
7. No "No 300s instrument available" error for 5m
