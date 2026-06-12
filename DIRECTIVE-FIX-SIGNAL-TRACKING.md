# Directive: Fix Signal Result Tracking

## IMPORTANT: Merge master first
Run `git merge origin/master` before implementing.

---

## The Bug
Signal tracking background loop never processes expired signals. Records stay `active` forever.

**Root cause:** The loop tries to create an SDK connection using `process.env.IQ_SSID` (admin SSID) via `sdkPool.get(SIGNAL_ADMIN_KEY=0, adminSsid)`. The IQ Option admin SSID is typically expired or the connection hangs for 180 seconds (the SDK's default timeout). The try/catch around it swallows the error silently — the loop returns on every tick without logging anything.

## The Fix
Instead of using a separate admin SDK connection, use each user's OWN SDK from the existing pool (`sdkPool`). Users whose signals are being checked already have valid SSIDs (they're actively generating signals), so their connections work.

### Changes to `src/bot.ts`

**1. Replace the sentinel SDK in the background interval**

Current (broken):
```typescript
const SIGNAL_ADMIN_KEY = 0;
...
let sdk = null;
try {
    sdk = await sdkPool.get(SIGNAL_ADMIN_KEY, adminSsid);
} catch {
    return;
}
```

Replace with per-user SDK retrieval inside the loop:

```typescript
// ─── Signal result tracking (checks expired signals every 15s) ───────────────

backgroundIntervals.push(setInterval(async () => {
    try {
        const expired = getExpiredActiveSignals();
        if (expired.length === 0) return;

        // Get the blitzOptions once (needs any valid SDK)
        const firstUser = getUser(expired[0].telegram_id);
        if (!firstUser?.ssid) return;
        
        let refSdk: ClientSdk;
        try {
            refSdk = await sdkPool.get(expired[0].telegram_id, firstUser.ssid);
        } catch {
            return;
        }

        try {
            const blitz = await refSdk.blitzOptions();
            const actives = blitz.getActives();
            const norm = (s: string) => s.toUpperCase().replace(/^front\./i, '').replace(/[-\/\s]/g, '');

            for (const sig of expired) {
                try {
                    const active = actives.find(a => norm(a.ticker) === norm(sig.pair));
                    if (!active) { updateSignalTrackResult(sig.id, 'lost', 'unknown_pair'); continue; }

                    // Use the same refSdk for candle data — market data is not user-specific
                    const candles = await refSdk.candles();
                    const history = await candles.getCandles(active.id, sig.timeframe, { count: 2 });
                    if (history.length < 2) { updateSignalTrackResult(sig.id, 'lost', 'no_data'); continue; }

                    const openPrice = history[0].open;
                    const closePrice = history[1].close;
                    const wentUp = closePrice > openPrice;

                    const isWin = sig.direction === 'call' ? wentUp : !wentUp;
                    const status = isWin ? 'won' : 'lost';
                    const result = isWin ? 'price_moved_favor' : 'price_moved_against';

                    updateSignalTrackResult(sig.id, status, result);
                    logger.info('signal-track', `signal #${sig.id} user ${sig.telegram_id} ${sig.pair} → ${status}`);

                    // Martingale auto-progression: insert next round on loss
                    let notifyText: string;
                    if (isWin) {
                        notifyText = `🟢 *SIGNAL WON!* ${sig.pair} ${sig.direction.toUpperCase()} hit.\n\nReady for your next signal!`;
                    } else if (sig.round < sig.max_rounds) {
                        const nextRound = sig.round + 1;
                        const now = new Date();
                        const nextExpiry = new Date(now.getTime() + sig.timeframe * 1000);
                        const toSqlite = (d: Date) => d.toISOString().replace('T', ' ').slice(0, 19);
                        insertSignalTrack({
                            telegram_id: sig.telegram_id, pair: sig.pair,
                            direction: sig.direction, timeframe: sig.timeframe,
                            entry_time: toSqlite(now), expiry_time: toSqlite(nextExpiry),
                            round: nextRound, max_rounds: sig.max_rounds,
                            entry_price: null,
                        });
                        notifyText = `🔴 *SIGNAL LOST.* ${sig.pair} ${sig.direction.toUpperCase()} moved against.\n\nLevel ${nextRound + 1} martingale queued — stay in the trade.`;
                    } else {
                        notifyText = `🔴 *SIGNAL LOST.* All ${sig.max_rounds + 1} rounds exhausted.\n\nTake a break and try a fresh signal.`;
                    }

                    try { await bot.telegram.sendMessage(sig.telegram_id, notifyText, { parse_mode: 'Markdown' }); } catch (e) {
                        logger.warn('signal-track', `sendMessage failed for ${sig.telegram_id}: ${e instanceof Error ? e.message : e}`);
                    }
                } catch (err) {
                    logger.warn('signal-track', `error checking signal ${sig.id}: ${err instanceof Error ? err.message : err}`);
                    updateSignalTrackResult(sig.id, 'lost', 'check_error');
                }
            }
        } finally {
            sdkPool.release(expired[0].telegram_id);
        }
    } catch (err) {
        logger.error('signal-track', `loop error: ${err instanceof Error ? err.message : err}`);
    }
}, 15000));
```

**2. Update the import at line 7**
Add `ClientSdk` to the sdk-pool import if it isn't already available. Actually `sdkPool` is already imported at line 7. You may need to import `getUser` if not already available in scope (it is — used throughout bot.ts).

**3. Remove the `SIGNAL_ADMIN_KEY` constant** (line ~6043) — no longer needed.

### Why this works
- Uses a REAL user's SDK (one whose signal just expired)
- That user's SSID was working recently (they just generated a signal)
- Market data (candle prices) is NOT user-specific — any SDK returns the same price
- Failed sends are logged instead of swallowed
- All expired signals in a batch use the same refSdk for efficiency
- 15s interval balances responsiveness vs SDK churn

## Verification
- [ ] After deploy, generate a signal → wait for expiry + 15s → check if result is updated
- [ ] Check PM2 logs for `[signal-track]` entries
- [ ] Win notification shows 🟢 with correct pair/direction
- [ ] Loss notification shows 🔴 with next level info
- [ ] Martingale auto-queues next round on loss
