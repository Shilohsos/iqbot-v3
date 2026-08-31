# DIRECTIVE — YACHT ENGINE: DEMO EXECUTION + $10 STAKE

**Date:** 2026-08-31
**Branch:** feature/yacht-demo-stake

## Why

The Yacht Club setup engine currently executes every setup on the **live** Yacht
account (`dmwferdinand@gmail.com`). When that balance hits zero, every subsequent
setup resolves as a LOSS and the channel gets flooded with loss cards — spam and
a dead account.

Fix: the engine must execute on the **demo** balance. OTC pairs are synthetic —
demo and live see the exact same candles and price feed, so a setup that wins on
demo wins on live. The posted results (WIN/LOSS) are identical either way. The
channel doctrine (no PnL / stake / balance anywhere) is unchanged. Demo starts
at $10,000 and cannot die on a bad streak; a refill is instant.

Additionally, Master wants the stake to start at **$10** (was $200).

## Scope

Work ONLY in `src/yacht-setup-engine.ts`. Do not explore the broader codebase.
Do not run repo-wide searches or audits. Do not modify any other file.

## Changes

### 1. Execute on DEMO balance

`src/yacht-setup-engine.ts` line ~807, the `runMartingaleCore` call:

```
balanceType: 'live',
```

must become:

```
balanceType: 'demo',
```

The `trade-core` execution path already fully supports `'demo'` (selects
`BalanceType.Demo`, error text 'No demo balance found') — no changes needed
there. `runMartingaleCore` / `gale-engine` already pass `balanceType` through.

### 2. Stake default $10

Three spots in `src/yacht-setup-engine.ts`:

- Line ~729: `const stake = cfgNum('yacht_stake', 200);` → fallback `10`
- Line ~1086 (seedYachtConfig): `['yacht_stake', '200']` → `['yacht_stake', '10']`
- Line ~1202 (status card): `Stake ${cfgNum('yacht_stake', 200)}` → fallback `10`

Note: an existing DB config row `yacht_stake=200` may already be seeded (seed
only inserts when null). Handle this: after the code change, if a `yacht_stake`
config row exists with the old value, it must be updated to `10` so the live
engine picks it up (a migration/UPDATE at module init when the value is exactly
`200` is acceptable — or simply document it and Wizard will update the DB row
locally at deploy; prefer the code-level UPDATE so the shipped state is correct).

### 3. Recovery path — verify demo compatibility (read-only)

`resolveYachtSetupTrades` → `recoverFinal` looks up trades in position history
by `trade_id` / `external_id`. Confirm (log line or existing behaviour) that
position history includes demo-balance positions — if the lookup needs a
balance filter to find demo positions, keep it as-is (position history is not
balance-filtered by default); do NOT add a balance filter unless one is already
present and would now exclude demo positions. If you find such a filter, remove
it so demo trades resolve. Do not change the resolution logic otherwise.

## Do NOT touch

- Any other file in the repo
- Channel doctrine / result card formats (`winCard` / `lossCard` / counts)
- The setup rotation, session scheduling, cooldown logic
- The Private Trader deep-link button / nudges
- `trade-core.ts`, `trade.ts`, `gale-engine.ts` — read-only reference if needed

## Verification checklist

- [ ] `balanceType: 'demo'` in the runMartingaleCore call
- [ ] `yacht_stake` fallback + seed = `10` in all three spots
- [ ] Existing `yacht_stake=200` DB row updated to `10` at init (or documented)
- [ ] Recovery path confirmed working for demo positions (no live-only filter)
- [ ] Compiles clean: `npx tsc --noEmit` (or the project's build-safe script for
      the yacht module + `node --check` on dist output)
