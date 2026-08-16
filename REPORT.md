# REPORT — 4117 "Payout rate changed" Permanent Fix

**Branch:** `claude/4117-permanent-fix` (from `c89e047`)
**Files changed:** `src/trade-core.ts`, `src/sdk-pool.ts` (+ this REPORT.md)
**Files NOT changed:** `src/bot.ts` (already correct — see §4), `src/index.ts` (no bug found — see §2)

---

## 1. Root-cause verdict

**The current total outage is not IQ Option's 4117. It is a bug in the rate-freshness probe added on 2026-08-16 — the probe aborts 100% of buys, for every user, on every pair, unconditionally.**

`BlitzOptionsActive.profitPercent` is a **method** (`src/index.ts:4699`):

```ts
public profitPercent(): number { return 100 - this.profitCommissionPercent }
```

The probe in `settle()` read it **without calling it** (three places — `trade-core.ts:322/336/344`):

```ts
const rateBeforeRefresh = readActive()?.profitPercent;   // ← a Function, not a number
const rateAfterWarm     = active.profitPercent;          // ← the same Function
if (rateAfterRetry === rateBeforeRefresh) return noFill('Payout rate changed');
```

Both sides are the **same prototype method reference**, so the comparison is `true` on every
execution. `updateActives()` mutates actives in place rather than replacing them, so the object
identity never changes either — and even across two *different* actives the reference is
identical, because methods live on the shared prototype. The guard therefore always falls
through to `return noFill('Payout rate changed')` **before the buy is ever attempted**.

That reproduces the reported symptom exactly: the caller's `buyFailRetries` cap of 2 produces
two identical `not filled (⚠️ Payout rate changed — try again in a moment.)` lines, then
"Trade not confirmed", with no order placed and no money lost — every single time, which is why
one user saw the same trade fail five times in a row.

Empirical before/after on identical healthy-market inputs (mock SDK, rate stable, buy would
succeed):

| | buys attempted | settle result |
|---|---|---|
| **Before** (master `c89e047`) | **0** | `NO_FILL — "Payout rate changed"` |
| **After** (this branch) | **1** | buy placed, awaiting settlement |

### Why the probe cannot be repaired, only removed

Adding the missing `()` would fix the type error but not the logic. The probe infers
"the rate did not change ⇒ the feed is dead". **Payout rates are stable for minutes at a time**,
so "unchanged across two refreshes ~2s apart" is the *normal, healthy* case. A corrected probe
would still abort a large share of legitimate trades. The inference is unsound at the premise,
so the probe is removed rather than patched.

### The directive's "dead subscription" hypothesis is disproved

Directive §4.1 asked whether an actives/rate **subscription** fails to re-arm after reconnect.
It does not — there is no such subscription:

- `BlitzOptions.refreshActives()` (`index.ts:4487`) is a live request/response round-trip
  (`wsApiClient.doRequest(CallBinaryOptionsGetInitializationDataV3)`), not a cached snapshot
  and not a push feed.
- The only background element is a 60s `setInterval` (`index.ts:4448`) that performs the *same*
  round-trip; it holds no subscription state to lose across a reconnect.
- `buy()` (`index.ts:4500`) already refreshes immediately before sending and re-reads the
  refreshed active on its internal retry.

A rebuilt socket that can serve `balances()` can serve `getInitializationDataV3` too. **No change
to `src/index.ts` was needed or made.** Genuine 4117s therefore come from the real race — IQ
moves the payout between our refresh and their validation — which the existing retry ladder is
the right tool for, and which is left intact.

---

## 2. What changed

### `src/trade-core.ts`

1. **Removed the freshness probe** (the outage). The `refreshActives()` call and the 1.2s
   warm-up before the buy are **kept** — both are sound and were helping.
2. **Sound dead-feed signal instead:** a `refreshActives()` that *throws or times out* is real
   evidence the rate path is broken. That now flags the user's pooled socket for rebuild via a
   new `markSocketUnhealthy()` helper. Zero added latency — it reuses the refresh already
   performed. The buy still proceeds on cached actives (refusing to trade would be worse).
3. **Escalation after the ladder (directive §4.3):** when 4117 survives all four backoff
   retries, the socket is flagged unhealthy so the **next** opportunity opens a fresh
   connection instead of re-failing on the same one. A 4117 that recovers mid-ladder does *not*
   flag anything — no needless rebuilds.

The retry ladder itself (`[1000, 2000, 3000, 4000]`ms, same-stake, fresh active re-read each
attempt) is byte-for-byte unchanged, as is the NO_FILL contract and the "no gale double on
unconfirmed" law.

### `src/sdk-pool.ts`

New `sdkFeedBroken(sdk)` (directive §4.2) — a socket whose **already-built** blitz facade has an
**empty actives map** can only produce failed buys, so the pool now rebuilds instead of handing
it out. Wired into both `isEntryHealthy()` and the `get()` healthy-flag fast path (the fast path
matters: it returns early without consulting `isEntryHealthy`).

Cost is one synchronous `Map` read. It inspects `blitzOptionsFacade` **only when it already
exists**, so it never triggers the request that would create it and adds no latency. Deliberately
**not** a rate-comparison probe, for the reason in §1.

### `src/bot.ts` — intentionally unchanged

The escalation §3 describes (mark unhealthy on the 2nd consecutive 4117) is already present and
correct at `bot.ts:1864`, in plain JavaScript. Nothing needed adding, so nothing was touched —
the file remains 100% plain JS for build-safe's verbatim copy.

---

## 3. How to verify

**Type-check:** `npx tsc --noEmit` is byte-identical to the pre-change baseline — zero new errors.
`node --check` clean on both compiled modules.

**Automated:** 17/17 assertions against the compiled output cover the regression (a normal trade
now reaches `buy()`), the ladder still retrying 1+4 times, mid-ladder recovery not flagging the
socket, ladder exhaustion flagging it, refresh-failure flagging it, and `sdkFeedBroken`'s
true/false/no-verdict cases including `get()` rebuilding rather than returning a broken socket.

**Log signatures after deploy:**

- *The outage is gone* — this line must **stop** appearing:
  `[trade-core] rate feed not syncing pair=… — aborting buy (stale rate → 4117)`
  It is deleted with the probe; any occurrence means the old build is still running.
- *Normal trade:* `[trade-core] SETTLE final=… pair=… source=…` at the usual rate. Users should
  stop seeing `not filled (⚠️ Payout rate changed…)` on healthy markets.
- *Genuine 4117, recovered:* `[trade-core] buy rejected (profit-rate/4117) … retrying same stake`
  followed by a successful `SETTLE` — no pool churn.
- *Genuine 4117, persistent:* `[trade-core] 4117 survived 4 retries pair=… — flagging socket for rebuild`
  then `[pool] user … marked unhealthy: 4117 survived retry ladder`. The **next** attempt should
  open a fresh socket and succeed; a user repeating this every time now means a real IQ-side
  rate problem on that pair, not a stuck socket.
- *Dead feed caught by the pool:* `[pool] user … blitz actives map is empty — marked unhealthy (dead rate feed)`.

**Manual:** one live trade on a healthy OTC pair should now place. Before this branch it could not,
regardless of pair, user, or retry count.

---

## 4. Follow-up risks

1. **Genuine 4117 races still exist and are expected.** This branch removes a self-inflicted
   100% block; it cannot remove IQ-side rate movement. Residual 4117 should now be rare and
   self-healing via the ladder + socket rebuild. If a specific pair still fails persistently
   after a rebuild, that is an IQ-side condition worth escalating with the log lines above.
2. **The 1.2s warm-up is retained on faith, not evidence.** It predates this work and was not
   part of the reported bug, so I left it. It costs 1.2s of latency on every trade. If you want
   it measured, the `SETTLE … ms=` field before/after removing it is the experiment — I did not
   change it because that is a behavior change outside this directive.
3. **`markSocketUnhealthy` only affects pooled sockets.** Trades on a non-pooled SDK (e.g. the
   admin path that builds its own connection) have no pool entry; the call is a safe no-op there.
   Those paths already rebuild by other means.
4. **Directive §4.5 (pinning the analyzed rate) was assessed and not implemented.** The buy must
   send the rate IQ currently accepts; pinning an older analyzed rate would *cause* 4117 rather
   than prevent it. The existing refresh-immediately-before-buy is already the correct
   mitigation, so no change was low-risk enough to justify.
