# DIRECTIVE — YACHT ENGINE PART 2: LIVE MIRROR WITH COMPOUNDING STAKE

**Date:** 2026-08-31
**Branch:** feature/yacht-demo-stake (continues after Part 1 — demo execution + $10 stake)

## Why

Part 1 (already on this branch) made the engine execute on the **demo** balance so
the channel results come from demo and the live account can never zero-out into a
loss-spam session.

Now the **live** Yacht account must **mirror the exact same trades** the engine
sends — but the live side is **NEVER used for tracking** (no live results posted,
no live outcome in the DB counters, no live data anywhere in the channel). The
live mirror exists only to compound the real account.

Live stake follows the compounding strategy from the eBook
("Compounding with 10x AI — Part One"): a percentage of the **current live
balance** so the stake recalibrates as the account grows. Master's specifics:

- Live stake **starts at $50** (not a fixed 1%, not any fixed percent — $50 at the
  current live balance at first mirror)
- As the live balance **compounds (grows), the stake rises with it**
  (percentage-of-current-balance style — stake = calibrated % × current live
  balance, recalculated before every mirror trade)
- **NO stop limit, NO daily loss cap, NO max stake** — it just keeps trading,
  every setup, forever
- No martingale on the live side — the eBook method is a flat stake
  percentage (stake rises with balance, never with emotion). One live trade per
  setup, at the compounded stake. The martingale ladder stays on the demo
  tracking side only.

## Scope

Work ONLY in `src/yacht-setup-engine.ts` (+ `src/tradeRecovery.ts` **only if**
the orphan-resolution path needs a demo/live disambiguation — see §3). Do not
explore the broader codebase. Do not run repo-wide searches/audits. Do not
modify any other file.

## Changes

### 1. Dual execution — demo tracks, live mirrors

In `runOneSetup` (the section that currently calls `runMartingaleCore` with
`balanceType: 'demo'` for the tracking chain):

- Keep the existing demo chain exactly as it is — it is the tracking source and
  produces the channel result post.
- AFTER the demo chain completes (result posted), place **one live mirror
  trade** on the Yacht live account: same pair, same direction, same timeframe,
  same entry timing as the setup, using `balanceType: 'live'`.
- The live mirror uses the dedicated Yacht SDK (`getYachtSdk()` — same SDK the
  engine already uses; the account is the same, only the balance differs).
- The live mirror result is **logged only** (`logger.info('yacht', ...)`). It
  MUST NOT:
  - post anything to the channel,
  - touch `yacht_sessions` counters,
  - touch `yacht_setups` status/result columns,
  - appear in any result card or session-close text.
- If the live mirror trade fails to place (NO_FILL, error), log it and move on —
  never block, never retry the ladder, never post. The demo tracking chain is
  the product; the live mirror is a silent side effect.
- Use a modest timeout so a hung live buy cannot stall the session (e.g.
  `withTimeout(..., 20_000)` style — match the file's existing timeout patterns).

### 2. Compounding live stake

Add a helper, e.g. `compoundingLiveStake(sdk)`:

- Read the current live balance via the Yacht SDK (`balances()` → the `real`
  balance).
- Calibration: on the FIRST mirror of the engine's life (or when no calibration
  exists), the stake is **$50** and the calibration ratio is stored as
  `ratio = 50 / liveBalance` (e.g. live = $1,000 → 5%; live = $500 → 10%).
  Store the ratio in the `config` table under `yacht_live_ratio` so it survives
  restarts. If `yacht_live_ratio` is missing → seed it with
  `50 / liveBalanceAtFirstMirror`.
- Every subsequent mirror: `stake = round(liveBalance * ratio, 2)`, recalculated
  immediately before each live buy. As the balance compounds the stake rises; if
  the balance falls, the stake falls proportionally (percentage behaviour).
- No cap. No floor below $0. If the live balance is insufficient for the trade
  (below the broker minimum), log and skip — keep trading the next setup.
- USD only for the Yacht account (the Yacht account is USD; do not add currency
  conversion).

### 3. Orphan recovery — keep demo-only (verify)

The existing `resolveYachtSetupTrades` / `recoverFinal` path resolves trades from
position history **by trade_id / external_id**. The live mirror trades also land
in position history, so:

- Verify the recovery path cannot mistake a live mirror trade for the demo
  tracking chain (it resolves by the DB row's trade_id — the live mirror never
  writes a DB row, so there is nothing to confuse; confirm this and do NOT add a
  balance filter unless one is already present that would now exclude demo
  positions).
- The live mirror must NOT write to the `trades` table at all (no telegram_id=0
  rows from the mirror). If any code path writes trade rows for yacht trades,
  ensure only the demo tracking chain does.
- No changes to `tradeRecovery.ts` are expected — if you find you need one,
  explain in your report why.

## Do NOT touch

- Any other file in the repo
- Channel doctrine / result cards / session-close counts (still demo-only)
- The demo tracking chain behaviour (Part 1)
- Setup rotation, session scheduling, cooldown, `/yacht` commands
- `trade-core.ts`, `trade.ts`, `gale-engine.ts` — read-only reference if needed

## Verification checklist

- [ ] Demo chain unchanged — tracking + channel posts still come from demo
- [ ] After each demo chain completes, ONE live mirror trade is placed (same
      pair/direction/timeframe/entry, `balanceType: 'live'`)
- [ ] Live mirror stake = $50 first, then `liveBalance × ratio` (ratio persisted
      in `yacht_live_ratio`, seeded as `50 / liveBalanceAtFirstMirror`)
- [ ] No stop limit / no daily loss cap on the live mirror
- [ ] No martingale on the live side — one trade per setup
- [ ] Live mirror writes NOTHING to the DB (no trades row, no counter bump, no
      setup status change) and posts nothing to the channel
- [ ] Live mirror failure = log + continue, never block the session
- [ ] Compiles clean (project's build-safe script for the yacht module +
      `node --check` on dist output)
