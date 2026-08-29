# DIRECTIVE — Yacht Engine Result Hardening (timeout + telegram_id=0 recovery)

**Branch:** feature/yacht-result-hardening
**Priority:** HIGH — live channel impact
**Incident:** 2026-08-29 01:02–01:26 UTC (Yacht Club channel went silent 24 min; a confirmed WIN result was never posted)

## Background — what happened (reproduction case)

1. Yacht engine posted setup #142 (private_trader, USDCAD-OTC, 120s, call, $200) at 01:01:14 UTC, trade placed at 01:02:15 (trades.id=124166, external_id=14209875447, telegram_id=0).
2. The bot process was force-restarted at 01:03:06 by the update-starvation watchdog (GramJS Telegram update loop had entered a TIMEOUT loop; `[watchdog] UPDATE-STARVATION pending=48 lastConsumed=181s ago — forcing restart`).
3. The restart killed the in-process settle: the engine's `runMartingaleCore` call for setup #142 was awaiting a WebSocket settle that died with the process. After boot the engine saw `yacht_setups.status='executing'` and looped every 60s: `[yacht] setup 142 still executing (N s) — not starting another` — **forever**. There is NO timeout on the yacht chain.
4. The trade actually closed WIN +$170 at 01:04:15 (verified via position history: external_id 14209875447, status closed, closeReason win, invest 200, pnl 170). The channel never received the result; the engine was blocked from starting setup #143.
5. Manual intervention (post result, settle DB rows, restart) unblocked it. Session #16 ended 10W/0L.

## Scope

Work ONLY in these files:
- `src/yacht-setup-engine.ts` (main change)
- `src/tradeRecovery.ts` (yacht reconciliation helper — see Part 2)
- `src/db.ts` (only if a helper/query is missing)

Do not explore the broader codebase. Do not run repo-wide searches/audits/greps or read unrelated modules. Do not modify any file not directly required by this directive. Everything outside the directive is out of scope — ignore it entirely.

The yacht engine is a dedicated-module, compiled via targeted `npx tsc` (it is NOT part of build-safe's verbatim-copy list). TypeScript annotations are fine in these files.

## Part 1 — Yacht chain timeout (src/yacht-setup-engine.ts)

The per-setup execution (analysis → entry hold → trade → martingale settle → result post) must never hang the engine. Add a total-chain budget around the setup execution path:

- **Budget formula:** `chainTimeoutMs = (effectiveGaleRounds + 1) * timeframeSec * 1000 + 180_000` (3 min settle slack). For the incident case (120s tf, 3 gale): 4 × 120s + 180s = 11 min.
- Use the same `withTimeout` pattern already used in the file (`withTimeout(promise, ms, label)` exists — wrap the whole setup-execution promise).
- **On timeout:** do NOT post a fabricated result. Follow the orphan path:
  1. Attempt to resolve the trade's real result from position history (Part 2 helper). If a position is found → update DB (trades + yacht_setups) and post the REAL result card via `postToChannelRetry` (winCard/lossCard with the resolved outcome and rounds).
  2. If no position found → mark the setup `status='aborted'` with `closed_at`, log `[yacht] setup N aborted — chain timed out, no position found`, and continue to the next setup. Do not block the engine.
- The timeout must never cause a second entry: resolution is read-only (position history). The trade is already placed once; we are only recovering its result.
- Ensure the timeout wrap covers the ENTRY HOLD too (entry hold ≤ 60s is inside the budget) and that any leftover countdown timers are cancelled when the chain aborts (no "entry in 0:47" card edits after abort).

## Part 2 — Yacht trade reconciliation (telegram_id=0)

`tradeRecovery.ts` resolves in-flight user trades via `SELECT ... JOIN users` — yacht trades (`trades.telegram_id = 0`) are invisible to it (documented gap; incident trade #124166 sat `in_flight` for 24 minutes with no resolver).

Add a yacht-specific reconciliation:

- **Where:** a new exported function in `src/tradeRecovery.ts` (e.g. `recoverYachtTrades(bot, engineHooks)`) AND/OR a boot-time scan inside `yacht-setup-engine.ts` — your call on the cleanest split, but the engine must own posting its channel results.
- **Trigger points:**
  1. **Boot:** any `yacht_setups` rows with `status='executing'` and `posted_at` older than `timeframe_sec + 90s` (a previous process died mid-setup) → resolve before the engine arms.
  2. **Periodic:** while a setup is `executing`, every engine tick (60s) check whether its `trades` row (`telegram_id=0`, matching pair/amount, created within the setup window) is still `in_flight`/`TIMEOUT` past `timeframe_sec + 90s` → resolve.
- **Resolution (read-only):** query the Yacht account SDK position history for `trades.external_id` when set; otherwise scan the latest history page for pair/amount/closeTime match. Use the same facade chain the engine already uses: `await sdk.positions()` → `positionsHistoryFacade` → `getPositionHistory(externalId)` or `fetchPrevPage()` + `getPositions()`.
- **On resolved result:**
  - Update `trades` (status WIN/LOSS/TIE + pnl from position, clear in_flight).
  - Update `yacht_setups` (status `completed`, `result_rounds`, `closed_at`).
  - Bump session counters (`setups_done`, `wins`/`losses`) — reuse the existing counter helpers in db.ts.
  - Post the real result card via `postToChannelRetry` (same winCard/lossCard the normal path uses).
  - **Double-post guard:** only post when the setup is still `status='executing'` and no outcome was already posted (check `result_rounds IS NULL` / a `closed_at IS NULL`); after posting, flip status immediately.
- The periodic check must respect the running chain: if `runMartingaleCore` is actively awaiting a settle (in-process), do nothing — only resolve when the chain is dead (boot-orphan or post-timeout).

## Verification checklist

- [ ] Simulate: place a yacht setup, kill the process mid-trade, restart → engine resolves the trade from position history, posts the real result, starts the next setup. No "still executing" loop beyond the timeout budget.
- [ ] Chain timeout: with a mocked/stalled settle, the setup aborts within `(galeRounds+1)*tf + 180s`, engine continues.
- [ ] No double posts, no fabricated results, no second entries.
- [ ] `node --check` on all touched files; targeted `npx tsc` compiles clean (es2022/bundler flags as used for other new modules).

## Do NOT touch

- `src/bot.ts`, `src/trade-core.ts`, `src/gale-engine.ts`, `src/sdk-pool.ts`, `src/analysis.ts` — settlement law and pool behavior are unchanged.
- No changes to channel message templates beyond reusing the existing `winCard`/`lossCard`/`sessionCloseCard` builders.
- No changes to the 2h cooldown, 10-setups-per-session cap, product rotation, or `/yacht` admin command behavior.
- No changes to user-path (telegram_id != 0) recovery behavior — the existing SELECT JOINs users logic stays as-is.
