# Section 3 Bug #2: SDK call hangs silently on round 2+

**Date:** 2026-05-10
**Reporter:** Wizard

---

## Symptom

Martingale shows "Doubling to $20.00 for round 2..." — then hangs forever. No crash, no result, no timeout. Process stays alive but unresponsive.

## Root Cause

`bot.ts` line 80:
```typescript
result = await executeTradeWithSdk(sdk, roundTrade);
```

If the SDK call hangs (WebSocket silent disconnect, IQ Option frozen API), `executeTradeWithSdk` never resolves and never throws. The `p-timeout` wrapper inside the SDK only covers SOME calls — not all. If a WebSocket read blocks forever, the promise never settles.

The outer `try/catch` (line 79-88) can't catch a hang — it only catches thrown errors.

## Fix

Wrap every round call in `Promise.race` with a hard timeout:

```typescript
const ROUND_TIMEOUT_MS = 120_000; // 2 minutes

try {
    result = await Promise.race([
        executeTradeWithSdk(sdk, roundTrade),
        new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Round timed out')), ROUND_TIMEOUT_MS)
        ),
    ]);
} catch (err: unknown) {
    // Handles both thrown errors AND the Promise.race timeout
    const msg = err instanceof Error ? err.message : 'Unknown error';
    await ctx.reply(
        `⚠️ *Round ${round}/${MAX_ROUNDS} — timed out*\n_${msg}_\n\nMartingale stopped.`,
        { parse_mode: 'Markdown' }
    );
    return;
}
```

Also need the same wrapper for `createSdk()` at line 58.
