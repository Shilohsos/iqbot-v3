# DIRECTIVE — Upgrade Token System (Grandfather → Reset Access)

**Status:** Approved by Master — 2026-08-07
**Branch:** master (build on current HEAD)
**Scope:** access management, config, one-time migration sweep
**No UI changes needed.** This is a backend access-lifecycle feature.

---

## 1. Business Requirement (verbatim from Master)

> "Current existing users will be on an upgrade token that'll reset from next month."

- **Now → Aug 31, 2026:** every user who already has `ai_trading` or `auto_trading`
  access keeps it, **regardless of their current balance** (grandfather window).
- **Sep 1, 2026 (reset date):** every user is re-evaluated against the **new**
  minimums — `ai_trading: $100`, `auto_trading: $500` (from `PRODUCT_LIMITS`).
- Users below the new minimum are **downgraded to `signals`** (account and
  balance kept — only access level changes).
- Signals access is never affected (flagship, free).

---

## 2. Implementation Plan

### 2.1 Config (DB `config` table — use existing helper)

Add one row:

```
key = upgrade_token_reset_date
value = 2026-09-01
```

The value must be **read at runtime every time** it's needed (do not hardcode
the date in code — the date lives in DB so Master can change it without a build).

### 2.2 Gate: grandfather window (live immediately)

In the existing access-evaluation path (`syncAccessFromBalance` /
`resolveAccess` in `src/access.ts`):

- If `today < reset_date` AND the user **already has** `ai_trading` or
  `auto_trading` access → **skip downgrade**. They keep access even if their
  balance is below the new minimum.
- "Already has access" = the user's current `access_level` in DB is
  `ai_trading` or `auto_trading` (before any re-evaluation of this call).
- New funders during the window still need the NEW minimums to gain access
  (this is already the behavior after the threshold raise — keep it).

### 2.3 One-time reset sweep (fires on/after reset date)

Add a module `src/upgrade-token.ts` (or a function inside `access.ts` —
your call, keep it consistent with the codebase):

- Runs **at bot startup** and then **once per hour** (reuse the existing
  interval pattern — see how other hourly loops are scheduled in `bot.ts`).
- Self-disabling: once it has run successfully **after** `reset_date`,
  it must never run again (store a flag in DB, e.g. `config` row
  `upgrade_token_sweep_done = 1`).
- Logic per user:
  1. `access_level` is `ai_trading` or `auto_trading` (skip everyone else).
  2. Read live funded balance in USD (`funded_balance_usd` — the same value
     `syncAccessFromBalance` uses; **do not** open SDK connections for this —
     use the cached column).
  3. If balance < threshold for their level (`$100` / `$500` from
     `PRODUCT_LIMITS`):
     - Downgrade to `signals` via the existing downgrade path (same function
       the normal downgrade uses — keep one source of truth).
     - Log: `logger.info('upgrade-token', 'user {id} downgraded → signals (balance $X < $Y)')`.
  4. If balance ≥ threshold → keep access, no action.
- **Safety:** process in small batches (e.g. 100 users per tick) to avoid
  blocking the event loop; if the sweep is interrupted mid-way, it resumes on
  the next tick (don't mark `sweep_done` until the whole pass completes).
- **Do NOT notify users** about the downgrade — Master will handle
  communication. No messages, no broadcasts, no DM.

---

## 3. Edge Cases (must hold)

| Case | Expected behavior |
|---|---|
| User funded $150 (ai_trading) before Aug 31 | Keeps ai_trading through window; on Sep 1 balance ≥ $100 → keeps access |
| User funded $50 (auto_trading) before Aug 31 | Keeps auto_trading through window; on Sep 1 balance < $500 → downgraded to signals |
| User never funded, has signals | Untouched, always |
| User funds $200 during window, no prior access | Gains ai_trading immediately ($100 threshold) |
| User downgraded on Sep 1, then tops up to $600 | Re-gains auto_trading via normal upgrade path (existing behavior) |
| Reset date changed in DB to a later date | Sweep must not fire early; grandfather window extends automatically |
| Bot restarts mid-sweep | Sweep resumes; `sweep_done` only after full pass |

---

## 4. Acceptance Checklist

- [ ] `upgrade_token_reset_date = 2026-09-01` present in DB config at boot
- [ ] Grandfather gate active: pre-reset users keep access below new minimums
- [ ] New funders during window require new minimums (unchanged behavior)
- [ ] Post-reset sweep downgrades below-minimum users to `signals` only
- [ ] Sweep runs hourly, batched, resumable, self-disables after completion
- [ ] Zero user-facing messages added
- [ ] `npm run build` passes (or `tsc --noEmit`) without new errors
- [ ] All changes committed on `master` with clear commit message

---

## 5. Files You May Touch

- `src/access.ts` (gate + threshold logic)
- `src/upgrade-token.ts` (new — sweep)
- `src/bot.ts` (startup hook + hourly interval registration)
- `src/db.ts` (config helpers if needed)
- Tests if the repo has a test harness — otherwise manual verification steps
  documented in your commit message.
