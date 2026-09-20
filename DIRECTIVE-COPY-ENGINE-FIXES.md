# DIRECTIVE — Copy Engine Correctness Fixes

**For:** ChatGPT Codex
**Repository:** Shilohsos/iqbot-v3 (private)
**Base:** `master` @ `e5ffc47` — **this is 2 commits ahead of the snapshot you reviewed (`deecabc`); read the current code before changing anything.**
**Date:** 2026-09-20
**Source:** Your 19 September 2026 Copy Trading review (9 findings). Every finding below was re-verified against `master @ e5ffc47` before being included. Two of your original points are already partially mitigated in the current code and are noted inline.

---

## Purpose

Fix the confirmed correctness defects in the Copy Trading engine so that:
1. Follower orders only ever exist when the corresponding admin order was accepted by the broker.
2. Settlement, recovery, stop/unplug, and restart behaviors are deterministic and money-safe.
3. No stale, unaffordable, or orphaned orders can be submitted.

## Build context (important)

- The deployed runtime compiles FROM these `src/` files on our side (`tsc` → `dist/`). Do **not** touch `dist/` or any build output. Ensure your changes compile under the repo's existing TypeScript configuration.
- `src/bot.ts` must remain plain JavaScript compatible per repo convention — but **do not modify `bot.ts` at all** for this directive.

## Hard rules

- **Surgical, minimal changes.** No refactors, renames, formatting sweeps, or unrelated fixes.
- **Files you may modify:**
  - `src/copy-trading.ts` (primary)
  - `src/trade-core.ts` (item 1 and item 5 only)
  - Additive DB migrations go **inside** the copy engine's existing migration block in `src/copy-trading.ts`. Do **not** modify `src/db.ts`.
- **Additive migrations only** — `CREATE TABLE IF NOT EXISTS` / guarded `ALTER`; never destructive.
- **No user-facing strings may change.** The entire engine is silent to users by design; keep it that way (logs only).
- Keep existing log styles (`logger.info('copy'|'copy-trade', ...)`).

## Out of scope — do NOT implement

The following are **intentional product behaviors approved by the owner**. Your review's design-change suggestions for them are acknowledged and **declined**:

- The unplugged hourly dummy-burst flow (20 chains per follower per hour) is a deliberate feature. Do not remove it, do not gate it behind consent copy, do not change its scheduling or composition. You may only make it obey the correctness rules in items 3–7 where they apply to submissions.
- Plug-state invisibility (the admin's plug/unplug state is never shown to users).
- Random display-confidence draws (`drawDisplayConfidence`) and window shaping.
- Compounding behavior (except where shared code is fixed for the items below).
- The policy that an already-open admin ladder finishes its recovery on the admin account (see item 4).

---

## Item 1 — Settlement recovery must not match an unrelated position

**Your finding #7.** Affects admin and followers (shared TradeCore).

**Current (`src/trade-core.ts`, `recoverFinal` history fallback):** when the identifier lookup fails, the fallback matches by stake (±0.021) and a lower time bound (`openTime >= start − 5s`, and candidates with *missing* openTime are accepted), then picks the newest `closeTime`. No pair, direction, or account check. Your repro: order ext 456 returned a different position's WIN (ext 777).

**Required:**
- Always prefer exact broker identity; persist `externalId` at submission when the broker returns one.
- The history fallback must require **all** of:
  - same normalized pair,
  - same direction,
  - same balance/account identity when available,
  - `openTime` within `[start − 5s, start + timeframeSec + 20s]`.
- Candidates with **missing `openTime`** are rejected unless they are the only candidate and no ambiguity window exists; **if more than one candidate passes all filters → return `unresolved`** (a distinct outcome — never assign another position's result).
- Callers must treat `unresolved` as "no settlement result" (see item 5 policy).

**Acceptance:** your reproduction must now return `unresolved` (not ext 777's WIN). Include the test in the PR.

---

## Item 2 — Followers must not fire unless the admin order is accepted

**Your finding #1.**

**Current (`src/copy-trading.ts`, `runCopySetup`):** `mirrorTradeToCopyUsers(...)` is dispatched **before** the admin's `executeTradeWithSdk(...)`. If the admin order throws or returns NO_FILL, follower orders have already been queued/submitted.

**Required:**
- Split **submission** from **settlement** for the admin path: submit the admin order and obtain an explicit **accepted** signal (order placed at the broker). Either expose an `onAccepted` callback / return value from the trade path, or submit through the lower-level facade directly — your choice — but the fan-out must be provably gated on broker acceptance.
- Call `mirrorTradeToCopyUsers` **only after acceptance**. On rejection/failure/ambiguity → **no fan-out** for that round.
- Preserve the intended timing: fan-out still fires seconds after the admin's entry (immediately after acceptance) — never after settlement.
- Every fan-out carries `runId` + `round` (already in the payload — keep).

**Acceptance:** mocked admin NO_FILL / throw → **zero** follower order submissions; mocked accept → follower orders fire (subject to item 6 deadlines). Include the test.

---

## Item 3 — Admin affordability must be re-checked before every submission

**Your finding #6.**

**Current (`runCopySetup`):** `maxStake = 90% of the balance read once, before the ladder`; recovery rounds do `stake = min(stake × 2, maxStake)` against the **original** cap. After losses, rounds can be unaffordable; followers may already have been fanned out.

**Required:**
- Re-read the admin live balance **immediately before every submission**, including round 0.
- Recompute the usable cap from the **current** balance each time (keep the 90%-usable policy, matching the follower side).
- If the next ladder stake exceeds the affordable cap → **end the run cleanly**: no order, no fan-out for that round, log the reason. Stay silent to users. (Optional: an admin-side notice is allowed — admin only.)

**Acceptance:** your reproduction ($500 start, 97% display → $450 loss → next $450 attempt with ~$50 left) must now **not submit**; the run ends; zero follower fan-out for that round. Include the test.

---

## Item 4 — Enforce stop / unplug / product state at the execution boundary

**Your finding #4** (all four races).

**Current:** `isCopyConnectionActive()` checks only that the row is active and runs before SDK acquisition / balance reads; queued follower orders do not recheck state; the admin checks plug state before the scan but not again before starting the run.

**Required:**
1. Strengthen the pre-submission guard: immediately before **every** order submission (after balance read, right before the buy call), verify: active row, **product matches the flow**, access signed + unexpired, and the relevant engine flags (`copy_active`; `copy_admin_plugged` for the copy product).
2. On state transitions (`copy_active` → OFF, unplug, product change, user disconnect): **invalidate queued-but-not-submitted** mirror work for the affected user (drop + log). In-flight submissions may finish — nothing new after.
3. Admin path: recheck plug state **immediately before starting a run** (i.e., after analysis completes). If unplugged mid-analysis → abort; no orders, no fan-out.
4. Keep the approved policy: an **already-open** admin ladder continues its remaining recovery on the admin account even if unplugged — but **new runs never start** while unplugged.

**Acceptance:** your four reproductions — order after disconnect must not submit; queued mirror dropped on OFF; no fresh run after mid-analysis unplug; old Copy order must not fire after a product/H20 route switch. Include the tests.

---

## Item 5 — Timeouts must not orphan submissions

**Your finding #5.**

**Current:** follower calls are wrapped in `withTimeout` (= `Promise.race`); it does not cancel. The queue can advance and the SDK can be released while the underlying operation may still submit an order.

**Required:**
- Separate the **submission deadline** (bounded: `timeframeSec + 20s` as today) from **settlement tracking**.
- If the submission outcome is ambiguous (timeout after a possible submit): do **not** release/discard. Register the order for reconciliation keyed by `runId` / follower / round, and reconcile via broker history using the item-1 identity rules.
- Keep tracking until a final status (WIN / LOSS / TIE) or explicit `unresolved`. The ladder decision consumes only reconciled results.
- Cancellation (stop/unplug) prevents **future** submissions; it never treats an accepted order as gone.

**Acceptance:** wrapper-rejection-while-pending repro → the order remains tracked; eventual result applied or marked unresolved; no orphan submission proceeds without reconciliation. Include the test.

---

## Item 6 — Entry deadlines for copy events

**Your finding #3** (residual after `e5ffc47`, which already pauses bursts while plugged).

**Current:** mirrored orders queued in the per-user queue carry no entry timestamp/deadline; slow queues can execute late (worst for 30s TFs).

**Required:**
- Every copy event gets an **entry deadline**: **15 s** for TFs ≤ 60 s; **30 s** for TFs ≥ 120 s (named constants).
- Immediately before submission, if `now > deadline` → **skip + log** `stale mirror skipped (Xs late)`. Never replay missed trades later.
- Bursts themselves keep their own cadence and are exempt from mirror deadlines.
- Keep the current `e5ffc47` behavior (bursts pause while the admin is plugged).

**Acceptance:** a mirror queued behind a long burst executes only if within deadline; otherwise skipped and recorded. Include the test.

---

## Item 7 — Durable run/round mapping + restart reconciliation

**Your finding #11** (credit: bursts already re-queue on boot from `e5ffc47`; the run mapping is still memory-only).

**Current:** admin run state, follower queues, and chain bases live in memory. Admin orders are stored as `telegram_id: 0`; the standard recovery path selects users with a stored SSID and skips them. No copy-specific restart path.

**Required:**
- Additive tables (columns are a minimum; keep names stable):
  - `copy_runs(run_id INTEGER PRIMARY KEY, pair TEXT, direction TEXT, tf_sec INTEGER, base_stake REAL, round INTEGER, status TEXT, updated_at INTEGER)`
  - `copy_dispatches(id INTEGER PRIMARY KEY, run_id INTEGER, telegram_id INTEGER, round INTEGER, status TEXT, created_at INTEGER)`
- Write run state at every transition; insert a dispatch row before each follower submission (`pending` → `submitted` → `settled` / `skipped` / `rejected`).
- On boot: load open runs; reconcile any unresolved admin orders — **including `telegram_id 0` personal-account orders** — via the copy admin session + broker history (item-1 identity rules). Decide the next ladder action from the reconciled result. **No new run starts until the prior run is reconciled or explicitly ended.**

**Acceptance:** kill mid-ladder → boot logs reconciliation → correct continuation (LOSS → next round doubles; WIN/TIE → run done); no duplicate or orphan orders. Describe the test procedure in the PR.

---

## Item 8 — Withdrawal reconciliation must be exactly-once

**Your finding #9.** (P2)

**Current:** `adjustExpected()` already applies each settled trade; `probeCopyFlow()` can subtract the same 48h rolling settled losses a second time when explaining a negative discrepancy.

**Required:** track exactly-once accounting — a checkpoint (e.g., last reconciled trade id per copier) — and subtract only **new, unaccounted** settlement amounts since the last checkpoint. Never reuse the same historical losses for more than one discrepancy.

**Acceptance:** your reproduction ($800 expected after an already-accounted $200 loss; actual $700) must **not** be re-explained; the outflow is recorded. Include the test.

---

## Item 9 — Fresh-DB migration order

**Your finding #8.** (P2 for existing installs; blocks brand-new ones.)

**Current:** the ini block `ALTER TABLE copy_bursts …` runs before `CREATE TABLE IF NOT EXISTS copy_bursts`, inside the same `try`; on a fresh DB the throw skips all remaining migrations and repeats every boot.

**Required:** create **all** engine tables first (`CREATE TABLE IF NOT EXISTS`, with current columns including `product`), then run the `ALTER`-based lazy migrations; isolate each migration step so one failure cannot skip the rest; log completion.

**Acceptance:** fresh empty DB → two init runs succeed; all tables and columns present; zero `no such table` errors. Include the test.

---

## Deliverables

1. Branch `codex/copy-engine-fixes` off current `master`, one PR.
2. Per-item report in the PR description: cause → change → acceptance proof (run output).
3. Repro/regression tests for items 1, 2, 3, 5, 6, 8 (extend your existing harness; note how to run them).
4. If anything in this directive is impossible or conflicts with the current code, stop and raise it in the PR rather than improvising.
