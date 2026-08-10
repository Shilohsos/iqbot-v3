# DIRECTIVE — Autopilot Market-Closed Pause Accuracy + Suspended-Active Detection

## Context

On 2026-08-10 (Monday) the autopilot for Shara (uid 6622587977, session #836, assets `["GBPUSD-OTC","USDCHF-OTC","AUDUSD-OTC"]`, 2m TF, $400 base) paused with the message **"Autopilot paused — all selected pairs are closed right now (market hours). Resume when they open."**

Investigation showed the pause was **premature/wrong**: at the moment of the pause, AUDUSD-OTC was open and tradeable (SDK: `canBeBoughtAt = true`, `isSuspended = false`), while GBPUSD-OTC and USDCHF-OTC were suspended by IQ Option (they appear in the app's asset list — their schedule says open — but the platform refuses purchases; the app itself shows **"Cannot purchase an option (active is suspended)"**).

Log evidence:
```
12:26 UTC [WARN] [auto] pair USDCHF-OTC closed for 6622587977 — rotating (1/3)
12:36 UTC [WARN] [auto] pair GBPUSD-OTC closed for 6622587977 — rotating (2/3)
12:42 UTC [WARN] [auto] pair GBPUSD-OTC closed for 6622587977 — rotating (3/3)
12:42 UTC [INFO] [auto] loop ended normally for 6622587977 (stopping=false)
```
Note the rotation repeated GBPUSD (2/3 then 3/3) and never attempted AUDUSD — the loop's next-asset selection landed on a closed pair again, and `closedStreak >= this.assets.length` (3) fired even though one of the three assets was open.

SDK ground truth at 14:06 UTC (via `blitzOptions().refreshActives()` + `getActives()`):
- EURUSD-OTC id 76 — `suspended: false`, `canBeBoughtAt: true`
- USDCHF-OTC id 78 — `suspended: true`, `canBeBoughtAt: false` (schedule claims open all day)
- GBPUSD-OTC id 81 — `suspended: true`, `canBeBoughtAt: false`
- AUDUSD-OTC id 2111 — `suspended: false`, `canBeBoughtAt: true`

Key insight: OTC pairs can be **suspended** by IQ Option even while their schedule says open. The platform rejects buys with NO_FILL `market is closed right now` (and the UI says `active is suspended`). The bot must distinguish "pair actually closed/suspended" from "temporary error", and must NOT pause the whole session while at least one configured pair is still tradeable.

## Required Changes (src/auto-trading.ts only)

### Part 1 — Per-pair closed tracking (do NOT pause while any configured pair is open)

Replace the single `closedStreak` counter with per-pair state. Track which configured assets are currently closed/suspended. Only pause with `market_closed` when **every configured asset** has been observed closed/suspended in this closed-cycle. If at least one asset remains open, keep scanning/trading it and log clearly.

Concretely:
1. Replace `let closedStreak = 0` with a `Set` (e.g. `closedAssets: Set<string>`).
2. In the NO_FILL branch: when the closed-market regex matches, add the current `asset` to the set. Log `pair X closed for uid — closed={n}/{total} ({list})`.
3. Pause only when `closedAssets.size >= this.assets.length` (all configured pairs seen closed). Message stays the same.
4. On any successful trade outcome (WIN/TIE), clear the set (a pair proved open — market cycle resumed).
5. Also clear the set when a non-closed error occurs (connection issue — pairs may not actually be closed).
6. When rotating after a closed NO_FILL, prefer picking the next configured asset **not** in `closedAssets` (skip known-closed pairs; only fall back to a closed one if all are closed). This fixes the observed bug where the loop re-attempted GBPUSD twice and never tried AUDUSD.

### Part 2 — Add "suspended" to the closed-market detection

The regex at src/auto-trading.ts:667-668 currently is:
```ts
const closedNow = outcome.status === 'NO_FILL' &&
    /market is closed|unknown pair|not available|no .*instrument available|no .*balance found/i.test(outcome.error ?? '');
```
Extend the regex to also match suspension variants so a suspended pair is treated as closed (skip/rotate) instead of a real error (which would count against `consecutiveErrors` and could pause with `repeated_errors`):
```ts
/market is closed|unknown pair|not available|no .*instrument available|no .*balance found|active is suspended|is suspended|suspended/i
```
Keep the same semantics: closedNow → rotate, never count against `consecutiveErrors`.

### Part 3 — Optional pre-trade actives check (recommended)

Before placing a trade for a configured asset, consult the SDK actives snapshot (`sdk.blitzOptions().getActives()`) if it is already available/cached in the loop, and skip the pair when the matching active reports `isSuspended === true` or `canBeBoughtAt(now) === false`. This avoids burning NO_FILL round-trips on known-suspended pairs. Implementation must be defensive: if the actives list is missing/stale/empty, fall back to current behavior (attempt the trade) — never block trading on a data-access failure. Do not add new API calls that could slow the loop; use the actives list the loop already refreshes.

### Part 4 — Logging

- Log every closed/suspended skip with pair name, reason (market-closed vs suspended vs canBeBoughtAt-false), and the current closed-set size.
- Log at INFO when a previously-closed pair becomes open again (trade succeeds) and the closed set clears.
- Keep logs concise: one line per event, prefix `[auto]`.

## Do NOT Touch

- Do NOT modify trade.ts, trade-core.ts, gale-engine.ts, bot.ts, checkin.ts, smart-flow.ts, db.ts, or any admin panel code.
- Do NOT change the confidence gate (AUTO_CONFIDENCE_FLOOR=55), the gale/martingale logic, the anti-double-trade recovery guard, or session pinning.
- Do NOT add a global concurrency cap or any queue that makes users wait to trade.
- Do NOT run repo-wide searches/audits or read unrelated modules. Work ONLY in src/auto-trading.ts.

## Scope Discipline

Work ONLY within the file(s) named in this directive. Do not explore the broader codebase. Do not run repo-wide searches/audits/greps or read unrelated modules. Do not modify any file not directly required by the directive. Everything outside the directive is out of scope — ignore it entirely.

## Acceptance Criteria

1. With 2 of 3 configured pairs suspended and 1 open, the session keeps trading the open pair instead of pausing.
2. With ALL configured pairs suspended/closed, the session pauses with the existing `market_closed` message.
3. A suspended pair produces `[auto] pair X closed (suspended)` log lines and is skipped, not counted as `repeated_errors`.
4. Rotation does not repeatedly attempt the same closed pair while an untried open pair exists.
5. TypeScript compiles cleanly (`npx tsc --noEmit`).
