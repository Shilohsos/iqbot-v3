# DIRECTIVE: 4117 "Payout rate changed" — Permanent Fix

**Date:** 2026-08-16
**Status:** REQUESTING IMPLEMENTATION
**Branch to create:** `claude/4117-permanent-fix`

---

## 1. The user-facing bug

A user taps a trade (AI Trading / Private Trader). The bot shows:

```
OPPORTUNITY FOUND — Confidence: 80% — PUT SIGNAL
Pair: EURUSD-OTC · Amount: ₦1,470 · Expiration: 1m

♦ Trade 1 ⚠️ ₦1,470.00 not filled (⚠️ Payout rate changed — try again in a moment.)
♦ Trade 1 ⚠️ ₦1,470.00 not filled (⚠️ Payout rate changed — try again in a moment.)
⚠️ Trade not confirmed — IQ Option did not confirm this order/result. No gale double was applied.
[↻ New Opportunity]
```

**10+ user complaints on 2026-08-15/16.** One user reported the SAME trade failing 5 times in a row. The trade is never placed, no money is lost, but users cannot trade at all and support is flooded.

## 2. What "4117" is

IQ Option rejects a Blitz (OTC) buy with error 4117 / "profit rate change" / "Payout rate changed" when the payout rate sent with the buy request differs from the server's current rate. **No order is placed.** The classic trigger chain:

1. A WebSocket dies (residential-proxy recycle, network blip, pool eviction).
2. The pool rebuilds a fresh SDK/WebSocket connection.
3. The new socket is ALIVE (balances work, health ping passes) but its **OTC actives rate feed has not synced** — `getActives()` still carries the stale `profitPercent` snapshot.
4. `refreshActives()` on that connection returns the SAME stale rate (the subscription never re-established), so every retry re-sends the same stale rate → 4117 forever.
5. The pool keeps the socket because it is "healthy" (balances ping OK) → **the same user fails on every subsequent signal** until the socket is evicted/restarted.

## 3. What is already in place (DO NOT REMOVE)

`src/trade-core.ts` — `settle()`:
- `refreshActives()` before buy (15s timeout).
- 1.2s warm-up after refresh (cold-feed sync).
- On 4117: 4 same-stake retries with backoff `[1000, 2000, 3000, 4000]`ms; each retry re-refreshes actives + re-reads the FRESH active object (never reuses the stale one) + 400ms settle.
- **NEW (2026-08-16, uncommitted — in the current working tree):** rate-freshness probe BEFORE the buy — samples `profitPercent` pre-refresh; if after refresh + warm-up + one extra refresh + 800ms the rate is unchanged, returns `NO_FILL('Payout rate changed')` WITHOUT attempting the doomed buy.

`src/bot.ts` — `runMartingale()` NO_FILL path:
- `buyFailRetries` capped at 2 → abort with "Trade not confirmed" (no gale double — this behavior is CORRECT and must stay).
- Pool socket marked unhealthy on WebSocket-closing errors (pre-buy gate rebuild).
- **NEW (2026-08-16, uncommitted):** on the 2nd consecutive 4117-family failure, calls `sdkPool.markUnhealthy(userId, ...)` so the next opportunity rebuilds a fresh socket.

`src/sdk-pool.ts`:
- `get()` pre-flight 2s balances() ping; `isEntryHealthy()` rejects closing-state sockets; `markUnhealthy()` exists.

SDK (`src/index.ts` `BlitzOptions.buy`): refreshes actives + retries once internally.

## 4. What Claude must investigate and fix "once and for all"

Investigate with evidence, then implement the smallest correct fix set:

1. **Why does the OTC rate feed stay dead on rebuilt sockets?** Check `src/index.ts` Blitz implementation: is the actives/rate subscription re-established on reconnect? Is `refreshActives()` actually pulling from the live feed or re-serving a cached snapshot? If there is a subscription that must be re-armed after `forceCloseConnection`/reconnect, that is the root fix.

2. **Feed-health pre-flight in the pool:** `sdkPool.get()` currently validates the socket with a balances() ping. Add a lightweight actives/rate sanity check so a socket with a dead rate feed is treated as unhealthy (rebuild) instead of being handed out. Must NOT add meaningful latency (>~1s) and must NOT break the session-pin settle path.

3. **Mid-retry rebuild option:** if the rate is STILL stale after the 4 backoff retries, consider marking the pool entry unhealthy inside `settle()` (or returning a distinct NO_FILL code the callers already map) so the NEXT attempt — not just the abort — gets a fresh connection.

4. **Verify ALL product paths route through the fixed `settle()`:** AI Trading (`src/bot.ts` runMartingale → `src/trade.js` executeTradeWithSdk → `settle`), Autopilot/Swarm/Copy (`src/trade-core.ts` GaleEngine path), Signals (candle-based, no buy — confirm it cannot produce a 4117).

5. **Race window:** the 60s background actives refresh can change the rate between analysis and buy. If there is a clean way to reduce this window (e.g., refresh immediately before buy — already done — or pin the analyzed rate), assess and implement only if low-risk.

## 5. Constraints

- **`src/bot.ts` is copied VERBATIM into `dist/bot.js` by build-safe — it must remain 100% plain JavaScript.** No TypeScript annotations (`: type`, `as X`, generics) in bot.ts edits. Implicit any is acceptable.
- `src/trade-core.ts`, `src/sdk-pool.ts` are tsc-compiled — normal TS is fine there.
- `dist/` is gitignored and rebuilt locally after merge — do NOT touch dist.
- Do NOT change the "no gale double on unconfirmed" law. Do NOT add user-facing spam — the abort message may stay as-is.
- Do NOT touch the drain/analysis code, template content, or any marketing/UI copy.

## 6. Deliverables

- Branch `claude/4117-permanent-fix` with the fix in `src/trade-core.ts`, `src/bot.ts`, `src/sdk-pool.ts` (and `src/index.ts` only if the dead-subscription root cause lives there).
- A short `REPORT.md` at the branch root: root cause verdict, what changed, how to verify (log signatures), and any follow-up risks.

## 7. Scope discipline

Work ONLY within the files named in this directive. Do not explore the broader codebase. Do not run repo-wide searches/audits/greps or read unrelated modules. Do not modify any file not directly required by the directive. Everything outside the directive is out of scope — ignore it entirely.
