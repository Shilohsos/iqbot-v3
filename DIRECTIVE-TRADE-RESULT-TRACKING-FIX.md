# Trade Result Tracking Fix

## IMPORTANT: Merge master first

This branch was created from master but master may have moved. Run:
```bash
git checkout master && git pull origin master && git checkout -b claude/trade-result-tracking-fix
```
Then apply the changes below.

---

## Problem

`waitForResult()` in `src/trade.ts` polls `positions.getOpenedPositions()` every 5 seconds. When a trade expires/ closes, the position is **removed from the opened list** — the poll can never find it. The 390s timeout fires with `TIMEOUT`, and `insertTrade()` never records a WIN/LOSS result. The user sees "win" on IQ Option but the bot shows no result.

---

## Fix 1: History fallback in `waitForResult` poll

**File:** `src/trade.ts`

When the poll has `externalId` but the position is no longer in the opened list (meaning it was closed and removed), fall back to `positions.getPositionHistory(externalId)`.

**Replace the poll interval** (lines 182-199) with:

```typescript
        // Polling fallback every 5s:
        // - Captures externalId if the websocket open event was missed
        // - Detects close if the websocket close event is never delivered
        // - Falls back to position history API for trades that have left the opened list
        const poll = setInterval(async () => {
            const opened = positions.getOpenedPositions();

            // Phase 1: Capture externalId from opened list
            if (externalId === undefined) {
                const match = opened.find(p => p.orderIds.includes(optionId));
                if (match) externalId = match.externalId;
            }

            // Phase 2: Check if position is still in opened list
            if (externalId !== undefined) {
                const pos = opened.find(p => p.externalId === externalId);
                if (pos?.status === 'closed') {
                    const pnl = pos.closeProfit ?? 0;
                    const reason = pos.closeReason ?? '';
                    const status: TradeResult['status'] = reason === 'win' ? 'WIN' : reason === 'equal' ? 'TIE' : 'LOSS';
                    finish({ status, pnl });
                    return;
                }

                // Phase 3: Position not in opened list — check history API
                // This catches trades that closed and left the opened list
                // before the websocket close event was delivered
                if (!pos) {
                    try {
                        const historyPos = await positions.getPositionHistory(externalId);
                        if (historyPos && historyPos.status === 'closed') {
                            const pnl = historyPos.closeProfit ?? 0;
                            const reason = historyPos.closeReason ?? '';
                            const status: TradeResult['status'] = reason === 'win' ? 'WIN' : reason === 'equal' ? 'TIE' : 'LOSS';
                            finish({ status, pnl });
                            return;
                        }
                    } catch {
                        // History lookup failed silently — next poll will try again
                    }
                }
            }
        }, 5_000);
```

**Also export `waitForResult`** so the startup recovery module can use it. Change line 139 from:
```typescript
function waitForResult(
```
to:
```typescript
export function waitForResult(
```

---

## Fix 2: Store `externalId` in trades table

**File:** `src/db.ts`

Add a migration to add `external_id` column, and update `insertTrade` to accept it.

**Add migration** to the existing migration function:

```typescript
      // Add external_id column for trade result recovery
      await db.exec(`ALTER TABLE trades ADD COLUMN external_id INTEGER`);
    } catch {
      // Column already exists — ignore
    }
    try {
```

Put this AFTER the existing migrations but BEFORE the `return` at the end.

**Update `insertTrade` signature and body:**

Change the function signature from:
```typescript
export function insertTrade(trade: {
```
to (add `external_id?: number` to the type):

```typescript
export function insertTrade(trade: {
    telegram_id?: number;
    pair: string;
    direction: string;
    amount: number;
    status: string;
    pnl: number;
    trade_id: number;
    error?: string;
    martingale_run?: string;
    external_id?: number;
}): void {
```

Add `external_id` to the INSERT:

```typescript
        const stmt = db.prepare(`
            INSERT INTO trades (telegram_id, pair, direction, amount, status, pnl, trade_id, error, martingale_run, external_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(
            trade.telegram_id ?? null,
            trade.pair,
            trade.direction,
            trade.amount,
            trade.status,
            trade.pnl,
            trade.trade_id,
            trade.error ?? null,
            trade.martingale_run ?? null,
            trade.external_id ?? null,
        );
```

---

## Fix 3: Pass `externalId` from `executeTradeWithSdk`

**File:** `src/trade.ts` (in `executeTradeWithSdk`)

After `waitForResult` returns, update the DB record with `externalId` if we captured it. Modify the `insertTrade` call (lines 85-95) to include `external_id`:

The `waitForResult` callback doesn't return `externalId` directly, but it's captured inside the function closure. We need to extract it. **Alternative approach**: make `waitForResult` return `externalId` as part of its result.

**Option A (recommended): Extend the return type**

Change the `waitForResult` return type (line 143) from:
```typescript
): Promise<Pick<TradeResult, 'status' | 'pnl' | 'error'>> {
```
to:
```typescript
): Promise<Pick<TradeResult, 'status' | 'pnl' | 'error'> & { externalId?: number }> {
```

And in `finish`, include `externalId`:
```typescript
        const finish = (result: Pick<TradeResult, 'status' | 'pnl' | 'error'>) => {
```
becomes:
```typescript
        const finish = (result: Pick<TradeResult, 'status' | 'pnl' | 'error'>, capturedExternalId?: number) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            clearInterval(poll);
            positions.unsubscribeOnUpdatePosition(callback);
            resolve({ ...result, externalId: capturedExternalId ?? externalId });
        };
```

Then update ALL finish() call sites to pass `externalId`:
- Line 158: `finish({ status: 'TIMEOUT', pnl: 0, error: 'Result timeout' });` → keep as-is (no externalId on timeout)
- Line 196: `finish({ status, pnl });` → `finish({ status, pnl }, externalId);`
- History fallback (new code): `finish({ status, pnl }, externalId);`

**Then in `executeTradeWithSdk`**, update `insertTrade` to include `external_id`:

```typescript
        const result = await waitForResult(positions, option.id, targetSize + 90);
        const tradeResult: TradeResult = {
            ...result,
            tradeId: option.id,
            pair: trade.pair,
            direction: trade.direction,
            amount: trade.amount,
        };

        insertTrade({
            telegram_id: trade.telegramId,
            pair: tradeResult.pair,
            direction: tradeResult.direction,
            amount: tradeResult.amount,
            status: tradeResult.status,
            pnl: tradeResult.pnl,
            trade_id: tradeResult.tradeId,
            error: tradeResult.error,
            martingale_run: trade.martingaleRunId,
            external_id: (result as any).externalId,  // captured by waitForResult
        });
```

---

## Fix 4: Startup recovery for missed trade results

**File:** `src/bot.ts` (or a new `src/tradeRecovery.ts`)

On bot startup, scan for TIMEOUT trades from the last 15 minutes that were placed by users with valid SSIDs. For each unresolved trade, try to resolve it via position history.

**Create `src/tradeRecovery.ts`**:

```typescript
import { db } from './db.js';
import { createSdk } from './trade.js';

interface UnresolvedTrade {
    trade_id: number;
    external_id: number | null;
    telegram_id: number;
    ssid: string;
    pair: string;
    direction: string;
    amount: number;
}

/**
 * On startup, check for trades from the last 15 minutes that have
 * TIMEOUT or no-result status. Try to resolve them via IQ Option's
 * position history API.
 */
export async function recoverMissedTradeResults(): Promise<void> {
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();

    const rows = db.prepare(`
        SELECT t.trade_id, t.external_id, t.telegram_id, u.ssid, t.pair, t.direction, t.amount
        FROM trades t
        JOIN users u ON u.telegram_id = t.telegram_id
        WHERE t.status = 'TIMEOUT'
          AND t.created_at >= ?
          AND u.ssid IS NOT NULL
          AND u.ssid != ''
          AND u.ssid_valid = 1
        ORDER BY t.created_at DESC
        LIMIT 20
    `).all(fifteenMinutesAgo) as UnresolvedTrade[];

    if (rows.length === 0) return;

    const resolved: string[] = [];

    for (const row of rows) {
        try {
            let sdk;
            try {
                sdk = await createSdk(row.ssid);
            } catch {
                continue; // Can't connect — skip
            }

            try {
                const positions = await sdk.positions();

                // Try to resolve via external_id if we stored one
                if (row.external_id) {
                    const historyPos = await positions.getPositionHistory(row.external_id);
                    if (historyPos && historyPos.status === 'closed') {
                        const pnl = historyPos.closeProfit ?? 0;
                        const reason = historyPos.closeReason ?? '';
                        const status = reason === 'win' ? 'WIN' : reason === 'equal' ? 'TIE' : 'LOSS';

                        db.prepare(`
                            UPDATE trades SET status = ?, pnl = ?, error = NULL
                            WHERE trade_id = ?
                        `).run(status, pnl, row.trade_id);

                        resolved.push(`#${row.trade_id}: ${status} ($${pnl})`);
                    }
                } else {
                    // No external_id — check if still in opened list
                    const opened = positions.getOpenedPositions();
                    const match = opened.find(p => p.orderIds.includes(row.trade_id));
                    if (match && match.status === 'closed') {
                        const pnl = match.closeProfit ?? 0;
                        const reason = match.closeReason ?? '';
                        const status = reason === 'win' ? 'WIN' : reason === 'equal' ? 'TIE' : 'LOSS';

                        db.prepare(`
                            UPDATE trades SET status = ?, pnl = ?, external_id = ?, error = NULL
                            WHERE trade_id = ?
                        `).run(status, pnl, match.externalId ?? null, row.trade_id);

                        resolved.push(`#${row.trade_id}: ${status} ($${pnl})`);
                    }
                    // If still open or can't find — leave as TIMEOUT
                }
            } finally {
                await sdk.shutdown();
            }
        } catch {
            // Individual trade recovery failure — don't block the rest
        }
    }

    if (resolved.length > 0) {
        console.log(`[RECOVERY] Resolved ${resolved.length} missed trade results: ${resolved.join(', ')}`);
    }
}
```

**Call recovery on startup** in `src/bot.ts`, add right after database initialization and before the bot starts polling:

```typescript
import { recoverMissedTradeResults } from './tradeRecovery.js';

// In the startup sequence, after DB init and before bot.launch():
recoverMissedTradeResults().catch(err => {
    console.error('[RECOVERY] Failed to recover missed trades:', err);
});
```

---

## Verification

1. After deploying, place a 5m trade
2. Let it expire naturally
3. Check DB: `SELECT status, pnl, external_id FROM trades ORDER BY created_at DESC LIMIT 5;`
4. Status should be WIN/LOSS, not TIMEOUT
5. `external_id` should be populated

For startup recovery test:
1. Kill the bot mid-trade
2. Wait for trade to complete on IQ Option
3. Restart bot
4. Check logs for `[RECOVERY] Resolved` message
5. Verify DB shows correct result

---

## Files Changed

| File | Change |
|------|--------|
| `src/trade.ts` | History fallback in poll, export waitForResult, extend return type, pass externalId to insertTrade |
| `src/db.ts` | Add column migration, update insertTrade schema |
| `src/tradeRecovery.ts` | **New file** — startup recovery logic |
| `src/bot.ts` | Import and call recoverMissedTradeResults on startup |
