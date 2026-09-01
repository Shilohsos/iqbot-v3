# DIRECTIVE — Yacht Live Mirror: Run the Full Martingale Ladder on the Same Setup

**Status:** BUG — live mirror still fires ONE trade per setup and never recovers on the same setup.
**Priority:** HIGH
**Scope:** `src/yacht-setup-engine.ts` ONLY. Do not explore the broader codebase, do not run repo-wide searches, do not modify any other file.

---

## 1. Observed failure (2026-09-01, Master's screenshot + engine logs)

The Yacht demo chain (the channel product) runs a full Smart Recovery gale on every setup
and recovers: today BTCUSD-OTC-op recovered at round 2 (`WIN rounds=2`) and AUDJPY-OTC
recovered at round 3 (`WIN rounds=3`). The channel posts those as wins.

The **live mirror** on the same setups placed ONE trade each and never continued:

| Setup | Channel (demo) result | Live mirror placed | Live result |
|---|---|---|---|
| #383 BTCUSD-OTC-op | WIN rounds=2 (recovered) | $50.00 once | LOSS |
| #384 AUDJPY-OTC | WIN rounds=3 (recovered) | $93.43 once | LOSS |

Screenshot evidence (13:27 WAT): live balance **$617.39**, closed trades today =
**AUD/JPY −$93.43**, **BTC/USD −$50**. Balance math: 760.82 − 50 − 93.43 = 617.39 ✓.

Master's words: *"Your fix did not work, this thing is still doing this same thing."*
The live account still shows a bare loss per setup with no martingale recovery rounds —
identical to the pre-fix behavior. The gale "level" today only made the NEXT setup's
single trade larger (50 → 93.43) instead of recovering the current setup.

## 2. Required behavior (Master's spec, verbatim intent)

- **The live mirror must run the full martingale ladder on the SAME setup**, exactly like
  the demo Smart Recovery chain does: place the base trade; if it LOSSES, immediately place
  the recovery round at double the stake; repeat until a WIN or the gale cap
  (`yacht_gale`, default 3 recovery rounds → max 4 trades per setup). A WIN anywhere ends
  the ladder and resets the next setup to base.
- **It follows its OWN live results only.** The channel/demo/group result is NEVER
  consulted. Even if the channel records a win and the live records a loss, the live
  ladder continues from its own loss. (Master: *"Even if on the group it records win and
  the live records loss it is still supposed to follow the Gale."*)
- **Concurrency:** the mirror ladder never blocks the demo chain, and it never blocks the
  NEXT setup. If the channel sends another setup while the live mirror is mid-ladder, that
  setup is taken too — both trades run together (Master: *"the both traded can run
  together"*). Use the existing fire-and-forget pattern (`void placeLiveMirror(...)`).
- **Compounding stake base:** stake for the first trade of a setup = `balance × ratio`
  (compounding, re-read live balance immediately before the buy; ratio calibrated at
  $50/balance on first mirror, persisted in `yacht_live_ratio`). Each ladder round after a
  LOSS doubles: round N = `balance × ratio × 2^(N−1)`, capped at the ladder's max round.
  Round 2 stake is computed from the balance read at the time of the recovery buy (balance
  has already dropped by round 1's loss — that is correct and intended).
- **Broker minimum:** never place a stake below $1. If a computed stake < $1, skip that
  round with a WARN and abort the ladder for this setup (do NOT loop).

## 3. Current implementation (what to change)

`src/yacht-setup-engine.ts`:

- `placeLiveMirror(setup, setupId)` (~line 1158 call site; function ~930–1041) currently:
  1. computes ONE stake via `compoundingLiveStake()` (base = `balance × ratio × 2^mirrorGaleLevel()`)
  2. executes ONE `executeTradeWithSdk` call
  3. deletes the trade row immediately (`DELETE FROM trades WHERE trade_id = ? AND telegram_id IS NULL`) — keep this per-round
  4. logs the result and updates a **cross-setup** persisted level `yacht_mirror_gale_level`
     (LOSS → level+1 for the NEXT setup; WIN → reset 0)

  This cross-setup level is the wrong mechanism. Replace it with an **intra-setup ladder**:
  after a LOSS with rounds remaining, loop the buy on the SAME pair/direction at the
  doubled stake until WIN or cap. Keep `yacht_mirror_gale_level` only as a restart-resume
  hint (see §5) — it must no longer be the thing that "doubles" anything.

- `compoundingLiveStake()` (~834–857): keep the ratio calibration + `balance × ratio`
  base, but the `Math.pow(2, mirrorGaleLevel())` multiplier moves into the ladder loop
  (round index), not the persisted cross-setup level.

- Keep: own SDK instance per mirror ladder (pre-warmed during entry hold), silent (never
  posted to channel, never tracked in DB beyond the transient trade row), ≤1s hot path to
  the first buy, fire-and-forget (`void placeLiveMirror(...)`).

## 4. Ladder mechanics (concrete)

```
stake0 = balance × ratio                     (calibrated ratio, live balance read now)
round 0: buy(pair, dir, stake0)
  WIN            → done. next setup base. log "live mirror WIN (direct)"
  TIE            → stake refunded; round NOT consumed; retry same stake after cooldown
  NO_FILL/ERROR  → no trade placed; retry same stake once (SDK health rebuild), then abort ladder
  LOSS           → round 1: stake1 = balance_now × ratio × 2   (read fresh balance)
                    buy again SAME pair/direction
                    WIN → done (log "live mirror WIN (recovery round 1)")
                    LOSS → round 2: stake2 = balance_now × ratio × 4 ... continue
                    ...
                    last round LOSS → ladder failed; next setup restarts at base
```

Gale cap = `yacht_gale` (default 3 recovery rounds → max 4 trades per setup). Every round
must be a NEW `executeTradeWithSdk` call on the same SDK; delete each transient trade row
after its result. A 30s-timeframe ladder round takes ~35–40s (buy + settle) — rounds are
sequential on the same setup, but the NEXT setup's mirror fires concurrently on its own
SDK (existing pattern).

## 5. Restart survival

If the process dies mid-ladder, on boot: resume any setup whose mirror ladder was
interrupted. Persist per-setup ladder state (setup id, pair, direction, round index, next
stake, in-flight trade id if any) — you may extend the existing mirror state persistence
mechanism. On boot, resolve the in-flight mirror trade via IQ position history (same
pattern as the demo trade recovery), then continue the ladder at the correct round; if the
in-flight trade won, finish the ladder as WIN; if it lost, continue to the next round.
Keep it simple — a best-effort resume with a 45-min orphan grace is acceptable.

## 6. Verification checklist (Claude, report each)

1. `placeLiveMirror` now loops rounds within ONE setup (grep: recovery buy inside the same
   function as the base buy; no cross-setup `Math.pow` in `compoundingLiveStake`).
2. Channel/demo result never read by the mirror path (grep the mirror function for any
   reference to the demo tracking result).
3. Ladder cap = `yacht_gale` (3 → max 4 trades), WIN resets next setup to base.
4. `$1` broker-min guard present on every round.
5. Concurrency preserved: next setup's mirror still fires while a ladder is mid-flight
   (`void placeLiveMirror(...)` unchanged at the call site).
6. Restart resume: mid-ladder state persisted; boot resolves and continues.
7. Compile clean, `node --check dist/yacht-setup-engine.js` passes.

## 7. Out of scope — do NOT touch

- The demo tracking chain, its gale, or its result posting.
- Channel posting, countdown, nudge logic.
- Any other file. This directive is scoped to the live-mirror ladder in
  `src/yacht-setup-engine.ts` only.
