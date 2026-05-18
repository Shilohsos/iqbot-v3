# Root Cause Analysis: IQ Bot V3 — OTC Candle Data Failure

## Incident Summary

On 2026-05-18 between 20:08 and 21:31 UTC+2, IQ Option's server began rejecting historical candle data requests for OTC instruments with active IDs in the 76-86 range. This caused the bot's analysis phase to fail with "status 4040 — not found. bad routing" for pairs like EURUSD-OTC, EURGBP-OTC, and GBPJPY-OTC.

All other bot functions (authentication, balance fetch, trade execution) continued working normally.

---

## Causal Chain (3 steps)

### Step 1: Symptom
**Analysis fails** — user sees "Analysis failed: request is failed with status 4040 and message: not found. bad routing"

- Evidence: User screenshots at 21:31 and 21:39
- SDK code at `src/index.ts:10216-10217`: `createError(status, data)` returns this exact error message

### Step 2: Immediate Cause
**IQ Option's candle history endpoint (`quotes-history.get-candles` v2) returns status 4040 for active IDs 76-86**

- SDK request: `{ name: 'quotes-history.get-candles', version: '2.0', body: { active_id: 76, size: 60, count: 5 } }`
- Server response: `{ status: 4040, message: "not found. bad routing" }`
- Verified with:
  - 5 consecutive attempts over 10 seconds — all failed (not intermittent)
  - 3 different user SSIDs — all failed (not per-account)
  - Both size=1 and size=60 — both failed (not timeframe-specific)
  - Both turbo and blitz options — same active ID 76, both fail

### Step 3: Root Cause
**IQ Option removed/deprecated candle history routing for legacy OTC active IDs in the 76-86 range**

- Active IDs 76-86 (EURUSD-OTC, EURGBP-OTC, USDCHF-OTC, EURJPY-OTC, NZDUSD-OTC, GBPUSD-OTC, GBPJPY-OTC, AUDCAD-OTC) have **no candle data available** via `quotes-history.get-candles` v2
- New OTC active IDs (2111-2139 range: AUDUSD-OTC @ 2111, USDCAD-OTC @ 2112, etc.) DO have candle data
- EURUSD-OTC **only exists** at the old ID 76 — there is no replacement/new ID
- The pairs are still **tradable** (`canBeBoughtAt()` returns true, blitz option expirations available) — only candle history was removed

---

## Timeline

| Time (UTC+2) | Event | Evidence |
|:------------:|-------|----------|
| 2026-05-18 20:08:14 | Last successful EURUSD-OTC trade | `trades` table: EURUSD-OTC, status=LOSS, pnl=0 |
| 2026-05-18 20:08–21:31 | IQ Option disables candle routing for IDs 76-86 | Gap in EURUSD-OTC trades; no EURUSD-OTC trades after 20:08 |
| 2026-05-18 21:31 | User reports error on EURUSD-OTC trade | Screenshot: "Analysis failed: request is failed with status 4040" |
| 2026-05-18 21:31+ | All OLD ID pairs fail analysis; NEW ID pairs (AUDUSD-OTC @ 2111, USDCAD-OTC @ 2112) work | Direct SDK testing confirmed |

---

## Impact Assessment

| Metric | Value |
|--------|-------|
| Affected pairs | 8 OTC pairs (IDs 76-86) |
| Historical volume on affected pairs | EURUSD-OTC: 869 of 1,503 total trades (57.8%) |
| Other pairs still working | AUDUSD-OTC (284 trades), USDCAD-OTC (13 trades), GBPUSD-OTC (337 trades) |
| Trades completed today before outage | 230 trades today (hour 5-20) |
| Bot availability | Bot remained online — only analysis on old-ID pairs failed |
| Financial loss | Unknown — users couldn't trade affected pairs during outage |
| Duration | Ongoing as of last test (22:10 UTC+2) — IQ Option has not restored service |

---

## Failed/Lacking Safeguards

1. **No pair health check** — The bot never verifies that an active ID supports candle data before adding it to the pair selection list
2. **No analysis fallback** — When candle fetch fails, the bot reports an error to the user with no retry or alternative data source
3. **No proactive monitoring** — The audit script tests random SSIDs but doesn't test specific pair candle availability
4. **No active ID versioning** — The bot uses whatever `turboOptions.getActives()` returns without checking if those IDs are current

---

## Remediation

### Short-term (can implement now):
1. **Filter dead OTC IDs from pair selection** — Exclude active IDs that fail candle data during pair discovery
2. **Add analysis fallback** — If candles fail for a pair, retry with a different timeframe or report "pair not available" instead of a cryptic error

### Long-term (needs Claude/directive):
3. **Audit all 169 OTC pairs** — Catalog which IDs have working candle data and which are dead, build a whitelist
4. **Add candle health check** — Periodic test of all available pairs, mark dead pairs in database
5. **Monitor IQ Option API changes** — Track when new OTC IDs appear and old ones go dead

---

## Verification

Re-tracing the causal chain in reverse:

**Root cause → Step 3 → Step 2 → Symptom:**

IQ Option removed candle routing for OTC IDs 76-86 → when bot calls `quotes-history.get-candles` with active_id=76, server returns status 4040 → the SDK creates an error "request is failed with status 4040 and message: not found. bad routing" → `analyzePair()` throws → `bot.ts` catches and shows "Analysis failed: ... bad routing" → user sees the error.

This chain is logically consistent. Every link is supported by timestamped evidence and reproducible test results.
