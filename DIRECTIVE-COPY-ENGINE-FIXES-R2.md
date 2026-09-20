# DIRECTIVE (Revision 2) — Scope Clarification for the Copy Engine Fixes

**For:** ChatGPT Codex
**Repository:** Shilohsos/iqbot-v3 → `https://github.com/Shilohsos/iqbot-v3`
**Base:** `master` @ `3650324` (unchanged from Revision 1; the review snapshot was `deecabc`)
**Date:** 2026-09-20
**Companion doc:** `DIRECTIVE-COPY-ENGINE-FIXES.md` @ `3650324` (Revision 1 — all item definitions, acceptance criteria, and guardrails remain in force)

---

## On your refusal — one correction and the actual scope

Thank you for stating your position clearly. One correction to its premise, then the scope boundary:

**1. You were not asked to endorse, preserve, or extend that behavior — the opposite.** Those design questions (the unplugged-flow behavior you object to) are **excluded from your scope precisely because they are being worked on separately by the operating team, carefully, as an open product matter of theirs.** That is why we do not want you working on it: it is not an engineering-fix item within this engagement, and your input on it has been noted for the team. You are not being asked to bless it, evaluate it, or represent it as acceptable.

**2. The work you ARE being asked to do strictly REDUCES unintended orders and money errors.** Every item in Revision 1 shrinks the set of orders that can execute; none of them adds, widens, extends, or improves the reach of any trading behavior:

| Item | Direction of change |
|---|---|
| 2 — gate follower fan-out on the admin's accepted fill | fewer unintended follower positions |
| 3 — affordability re-check before every submission | fewer unaffordable attempts |
| 4 — stop / unplug / disconnect / route enforced at the submission boundary | fewer orders after state changes |
| 5 — timeouts never orphan a submission | fewer untracked orders |
| 6 — entry deadlines on copy events | fewer stale, late executions |
| 1 — settlement identity (never attach another position's result) | fewer wrong results |
| 7 — durable run mapping + restart reconciliation | no duplicate/orphan orders across restarts |
| 8 — exactly-once withdrawal reconciliation | no double-counted losses |
| 9 — fresh-DB migration order | init works instead of failing |

**3. The excluded area: no changes, now or by you.** Not yours to modify in this engagement. If that boundary is acceptable, proceed with Revision 1 as written.

## Fallback

If, after this clarification, you still cannot implement one specific item, implement **every remaining item**, and in the PR list the declined item(s) with your reasoning. Those will be routed internally. A partial delivery is accepted; a third refusal without implementation is not.

## Deliverables (unchanged)

- Branch `codex/copy-engine-fixes` off current `master` (`3650324`).
- Files: **only** `src/copy-trading.ts` and `src/trade-core.ts` (+ migrations inside the copy-trading.ts init block). Do **not** touch `db.ts`, `bot.ts`, or `dist/`.
- Surgical changes only — no refactors, no renames, no user-facing strings.
- Repro tests for items 1, 2, 3, 5, 6, 8.
- One PR, per-item report: cause → change → acceptance proof.
- If an item is impossible or conflicts with current code: raise it in the PR rather than improvising.
