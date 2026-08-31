# DIRECTIVE — YACHT ENGINE PART 3: LIVE MIRROR MUST FIRE AT ENTRY (NOT AFTER SETTLE)

**Date:** 2026-08-31
**Branch:** feature/yacht-demo-stake (continues after Part 2)

## Why — live mirror is entering LATE

Live evidence (session #34, NZDJPY-OTC 2M):

```
12:39:56  demo chain places NZDJPY-OTC call stake=10 (entry at countdown 0:00)
12:41:57  demo result → WIN rounds=1   (120s trade expired)
12:41:57  live mirror BUYS NZDJPY-OTC $50   ← 2 MINUTES LATE — at the expiry
12:43:57  live mirror result → LOSS (different window entirely)
```

The mirror is currently called at the END of `runOneSetup` (step 7, after the
demo chain settles and the result is posted). Because the demo chain runs the
full martingale ladder before settling, the mirror can enter minutes (or, on a
5M gale chain, up to 20 minutes) AFTER the setup's real entry moment. Same pair,
same direction — but a DIFFERENT trade window. The live account therefore does
not mirror the signal at all; it buys whatever the market is doing at expiry.

## Fix — fire the mirror at the same entry moment as the demo chain

The live mirror must enter **at the same instant the demo chain's first trade
enters** (when the engine's countdown hits 0:00 and the tracking trade is
placed) — not after settlement.

### 1. Move the trigger

- Remove the `await placeLiveMirror(setup)` call from the end of `runOneSetup`
  (currently step 7, after `postToChannelRetry` of the result card).
- Call it at the same point where the demo chain's first trade is fired — i.e.
  immediately BEFORE the `runMartingaleCore(...)` tracking chain starts, at the
  moment the entry hold expires and the trade would be placed.
- It must be **non-blocking**: do NOT await it inside the setup flow. Fire it as
  `void placeLiveMirror(setup)` (or an equivalent fire-and-forget pattern with
  an internal catch-all — it already never throws, but keep it that way). The
  demo chain, the result post, the counters and the session pacing must never
  wait on the mirror.

### 2. Own SDK — never share the tracking SDK concurrently

The mirror currently does `const sdk = await getYachtSdk()` — the SAME SDK the
demo chain is using. Firing both concurrently on one WebSocket risks the
known parallel-buy hang (same class as the swarm parallel-SDK issue). The
mirror must create its **own SDK instance** from the same yacht credentials
(the existing `createSdk` + proxy + SsidAuthMethod path used by `getYachtSdk`
internally — factor a small `createYachtSdk()` helper if needed) and shut it
down after the mirror settles (finally-block, mirror `dropYachtSdk` style but
scoped to the mirror's own instance). The demo chain keeps its SDK untouched.

### 3. Keep everything else identical

- Compounding stake logic (`compoundingLiveStake`, `yacht_live_ratio`, $50
  first stake, ratio persisted once) — unchanged.
- `balanceType: 'live'`, ONE trade, no martingale, no stop limit.
- Silent: no channel post, no counter, no yacht_setups column, no admin
  notice — log lines only.
- DB hygiene: the temporary `trades` row (telegram_id NULL) is deleted after
  settlement exactly as now. Keep the `WHERE trade_id = ? AND telegram_id IS
  NULL` cleanup.
- Timeout budget: the mirror now runs while the demo chain is also running.
  Keep `LIVE_MIRROR_TIMEOUT_MS + setup.timeframeSec * 1000` so a hung mirror
  settle cannot outlive the window, and never affects the tracking chain.
- If the mirror is still settling when the engine moves to the next setup,
  that is fine — it is fire-and-forget and self-contained.

### 4. Recovery isolation — verify

The mirror's own SDK + own trade means its position lands in the Yacht
account's position history alongside the demo chain's. Confirm:

- `resolveOrphanSetup` / the boot scan still resolve ONLY by the DB row's
  `trade_id` (mirror rows are deleted post-settle, so nothing to confuse) —
  no change expected, but assert it in your report.
- The mirror must not write `telegram_id = 0` rows (it already writes NULL —
  keep that). The yacht recovery query (`WHERE telegram_id = 0`) must still
  only ever see demo tracking rows.

## Do NOT touch

- Any other file in the repo
- Channel doctrine / result cards / session-close counts
- The demo tracking chain behaviour, setup rotation, scheduling, cooldown,
  `/yacht` commands
- `trade-core.ts`, `trade.ts`, `gale-engine.ts` — read-only

## Verification checklist

- [ ] Mirror fires at the same second as the demo chain's first trade (log
      timestamps within ~1s of each other), not after settlement
- [ ] `void placeLiveMirror(...)` (or equivalent) — setup flow never awaits it
- [ ] Mirror uses its own SDK instance, shut down after settle (no shared-SDK
      concurrency with the tracking chain)
- [ ] Compounding stake, $50 first, ratio persisted — unchanged
- [ ] No martingale on live, no stop limit
- [ ] Silent: log-only, no DB trace left, no channel/DB/counter impact
- [ ] Recovery path still demo-only (mirror rows deleted, NULL telegram_id)
- [ ] Compiles clean; `node --check` on dist output
