# DIRECTIVE: Pre-Round Affordability Check — Martingale Must Not Outrun the Balance

**Date:** 2026-08-20
**Status:** REQUESTING IMPLEMENTATION
**Branch to create:** `claude/affordability-check`

---

## 1. The user-facing bug

A user (chris_confido / telegram 6113862419 / IQ 194418727, NGN live) ran AI Trading with a ₦7,154 stake and 3 recovery rounds (max chain ₦7,154 → ₦14,308 → ₦28,616 → ₦57,232).

- Rounds 1–3 settled **LOSS** (real IQ Option positions: −₦7,154, −₦14,308, −₦28,616 = −₦50,078).
- After those losses the account held **₦39,352.53**.
- The bot attempted round 4 at **₦57,232** — more than the balance. IQ Option rejected the buy ("request is failed" → user sees "IQ Option rejected the request. Wait a moment and try again.").
- The bot retried once, got the same rejection, then aborted with "Trade not confirmed" — **correct** on the no-double law, but the UX was confusing: the user saw a scary "not filled / rejected" card instead of a clean "insufficient balance" stop, and believed money was taken.

**Verified facts:** the ₦57,232 was never placed (zero positions near that amount in IQ position history). The only problem is the bot **attempting an unaffordable double**.

## 2. What to implement

Add a **pre-round affordability check** on every martingale round **after the first** (recovery rounds only), in BOTH gale paths:

### Path A — AI Trading: `src/bot.ts` `runMartingale()` (~line 1447)
`const nextAmount = galeRow.current_amount * 2;` — before placing the next round with `nextAmount`:

1. Read the user's **live balance** from the pinned SDK (`sdk.balances()` → find the balance whose `type` matches `galeRow.balance_type` — 'real'/'demo'; the pool already provides the pinned SDK).
2. Wrap the call in the existing `withTimeout` helper (~10s).
3. If `liveBalance < nextAmount` → **abort the chain immediately**:
   - Do NOT attempt the buy. Do NOT show the "rejected / not filled" error card.
   - Update the card with a clean line: `· Recovery skipped — balance ₦X is below the ₦Y needed. Sequence done.` (currency symbol from `galeRow.currency`).
   - End the gale session as completed (same path as gale exhaustion — mark the session done, no further rounds).
4. If the balance read fails/times out → **conservative abort** (same clean message, "couldn't verify balance"), never attempt the unverified double.

### Path B — GaleEngine: `src/gale-engine.ts` `runGale()` (line ~63, `currentAmount *= 2`)
Same check before the next round executes. The `sdk` is already in scope (`params` carries it). Add a config flag on `params` (default `true`): `params.affordabilityCheck` — so callers can disable it in tests. Balance read: `sdk.balances()` with a ~10s timeout; match balance type to the mode (`params.balanceType ?? 'real'`).

On insufficient balance → return the outcome as `{ status: 'LOSS', totalPnl, rounds: <actual>, last }` (chain ends cleanly — same as gale exhaustion) and surface the reason to `onRound` so Auto/Swarm/Copy cards show the same clean line instead of a rejection.

## 3. Constraints

- **`src/bot.ts` is copied VERBATIM into `dist/bot.js` by build-safe — it must remain 100% plain JavaScript.** No TS annotations. Implicit any is acceptable.
- Do NOT change the "no gale double on unconfirmed" law. Do NOT change WIN/TIE/NO_FILL semantics. Do NOT add user-facing spam — one clean line per skipped round, then the chain ends.
- The check applies ONLY to recovery rounds (round ≥ 2). Round 1 keeps today's behavior.
- Demo mode uses the demo balance; live mode uses the real balance. Never mix.
- Use the user's own currency formatting for the message (NGN → ₦, else $).
- `dist/` is gitignored and rebuilt locally after merge — do NOT touch dist.
- Do NOT touch the drain/analysis code, template content, or marketing copy.

## 4. Deliverables

- Branch `claude/affordability-check` with fixes in `src/bot.ts` and `src/gale-engine.ts` (and `src/trade.ts` only if the flag needs threading).
- Short `REPORT.md`: what changed, log signatures for verification (e.g. a `[gale] affordability skip round=N amt=X balance=Y` line), and how to test.

## 5. Scope discipline

Work ONLY within the files named in this directive. Do not explore the broader codebase. Do not run repo-wide searches/audits/greps or read unrelated modules. Do not modify any file not directly required by the directive. Everything outside the directive is out of scope — ignore it entirely.
