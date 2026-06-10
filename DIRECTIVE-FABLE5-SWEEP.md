# FABLE 5 SWEEP: Full System Audit & Fix — One-Shot

You are Claude Fable 5 — the most capable model Anthropic has publicly released. Your task is a **complete, one-shot sweep** of this IQ Option trading bot codebase.

**RULES:**
- Read EVERY source file listed in Phase 1 before making any changes
- Do NOT stop after analysis — implement every fix you identify
- Do NOT leave "TODO" or "this needs attention" — fix it now
- If something needs architectural discussion beyond a code fix, note it in your final report
- Build must pass after all changes
- Do NOT modify `.env`, `iqbot-v3.db`, or `node_modules/`

---

## Phase 1: Read All Source Files

Read ALL files in this exact order (they build on each other):

**Core:**
1. `src/protocol.ts` — network config (WS_URL, IQ_HOST, PLATFORM_ID)
2. `src/errors.ts` — FriendlyErrors map + friendlyError()
3. `src/retry.ts` — retry logic helpers
4. `src/logger.ts` — logging utilities
5. `src/index.ts` — SDK (quadcode/client-sdk-js)
6. `src/db.ts` — all database access functions
7. `src/tiers.ts` — tier config, normalizeTier, convertToUsd
8. `src/proxy.ts` — proxy URL + rotation (new)
9. `src/sdk-pool.ts` — persistent SDK connection pool

**Trading:**
10. `src/analysis.ts` — market analysis (RSI, EMA, MACD, Bollinger)
11. `src/trade.ts` — trade execution via SDK
12. `src/tradeRecovery.ts` — recovery/cleanup after trades

**Bot logic:**
13. `src/menu.ts` — keyboard/button builders
14. `src/classifier.ts` — LLM brain intent classifier
15. `src/llm.ts` — LLM interaction helpers
16. `src/onboarding.ts` — user onboarding flow
17. `src/channel.ts` — Telegram channel integration
18. `src/auto-broadcast.ts` — automated broadcast system
19. `src/giveaway.ts` — giveaway/promo/marathon system
20. `src/brand-voice.ts` — brand voice for composed content

**UI:**
21. `src/ui/admin.ts` — admin panel keyboards
22. `src/ui/user.ts` — user-facing keyboards

**Main:**
23. `src/bot.ts` — MAIN FILE (~5400 lines). Telegraf bot, all handlers, trade wizard, admin commands, brain routing, re-engagement, notifications queue, funding cycle, reconnect cycle, scheduler, everything.

**Scripts:**
24. `scripts/proxy-healthcheck.cjs` — proxy rotation cron
25. `scripts/error-propagation-test.ts` — error test patterns

---

## Phase 2: Verify Known Issues Are Fixed

Check each of these was implemented correctly:

1. **Authenticat error mapping** — `src/errors.ts` should have `'authenticat'` key mapping to reconnect message. Verify it catches both "authentication is failed" and "not authenticated" (use `.includes()` semantics to confirm).

2. **Proxy fallback chain** — `src/bot.ts` → `loginAndCaptureSsid()` should: try proxy → on fail: fire direct login + async rotation simultaneously. Bad credentials should short-circuit (no fallback). The triggerProxyRotation() in `src/proxy.ts` should swap in-memory URL (no PM2 restart).

3. **Classifier max_tokens 150→300** — `src/classifier.ts` → confirm value changed.

4. **SDK pool MAX_AGE 30→10 min** — `src/sdk-pool.ts` → confirm changed. Pool size logging added to `cleanup()`.

5. **IQ_HOST** — `src/protocol.ts` → confirm env-override pattern exists. No change to default needed (research confirmed it only affects translations).

---

## Phase 3: Blind Spot Scan — Every Source File

For EVERY file in Phase 1, scan for these categories. Fix everything you find.

### 3A. Error Handling Gaps
- Any `try/catch` that swallows errors without logging?
- Any `friendlyError()` call where the fallback would mask a useful error?
- Any unhandled promise rejection paths?
- Any missing error types in `FriendlyErrors` map beyond what's already added? (Test: "authentication is failed" was missed before. Are there other SDK error strings that could slip through?)
- Check SDK error messages: what strings does the SDK actually throw? Look at all `new Error(...)` or `throw ...` in the SDK code if accessible. Specifically check for auth-related, network-related, and timeout-related error messages.

### 3B. Race Conditions & Concurrency
- The SDK pool (`sdk-pool.ts`): multiple concurrent `get()` calls for the same userId — the pending promise pattern handles this, but verify.
- `runMartingale()` in `bot.ts`: multiple rounds executed sequentially? Any risk of concurrent martingale sequences for the same user?
- `activeTradeSessions` Map: incremented/decremented atomically? Any path where decrement is missed causing a permanent block?
- `wizardSessions` Map: accessed from multiple async handlers. Any TOCTOU race?
- Broadcast paths: `dispatchBroadcastPayload()` processes users. Could two broadcasts overlap for the same user?

### 3C. TypeScript Safety
- Any `any` types that should be specific?
- Any missing null checks before property access?
- Any `as` casts that bypass safety?
- Any `!` non-null assertions that could fail at runtime?
- Check the `PoolEntry` interface and all typed interfaces.

### 3D. Memory / Resource Leaks
- SDK pool: `.shutdown()` called in `release()` and `cleanup()`. Any path where an SDK connection is abandoned in the Map but never cleaned up?
- `wizardSessions` / `connectSessions` / `adminSessions` Maps: any cleanup mechanism for abandoned sessions? (DB has 36 stale sessions — check if in-memory maps also accumulate)
- `activeTradeSessions` Map: decremented in `finally` blocks? (A missing decrement leaks the entry permanently)
- `pendingBroadcasts` / `pendingDeliveries` Maps: any TTL or cleanup?
- Telefile file_id cache (`assetFileIdCache`): bounded but verify.
- Event listeners: any `bot.on(...)` or `bot.action(...)` registrations that accumulate?

### 3E. Database Patterns
- All DB queries use prepared statements? (check for string interpolation in SQL)
- `db.prepare(sql).get()` called with parameters when SQL has placeholders? Check for `better-sqlite3` parameter mismatch bug (line 4760 in bot.ts was fixed before — verify similar patterns elsewhere)
- WAL mode — check that no exclusive locks block readers
- No indexes on trades (8,852 rows), funnel_events (6,264), messages — add indexes where queries justify them

### 3F. Known Recurring Bug Classes
These have been identified across multiple sessions. Check EVERY instance:

1. **`sendTemplate()` silent return** — when template key doesn't exist in DB, sendTemplate() returns silently. Any caller that assumes it succeeded? Should log a warning.
2. **Key transformation mismatches** — sendTemplate() passes key as-is, but re-engagement loops strip prefixes. Check all template key references match.
3. **Currency-sensitive comparisons without `convertToUsd()`** — NGN min_balance bug was found before. Are there other hardcoded dollar comparisons? (tiers.ts, giveaway.ts, bot.ts)
4. **Background loops missing button support** — re-engagement loop uses `sendMessage` not `sendTemplate`. Any other path where buttons are expected but not included?
5. **Parallel send paths with different guards** — inline triggers have cooldowns but background loops don't. Check all automation paths.
6. **SSID invalidation on ALL SDK errors** — not just auth errors. Check all catch blocks that handle SDK errors.
7. **`/start` silent dead-ends** — handlers that exit silently without responding to the user.

### 3G. Ordering & Handler Priority
- `bot.action()` and `bot.on('text')` handlers — are more specific patterns registered before catch-all patterns?
- Does any broad regex match intercept callback data meant for another handler?
- The brain classifier in the text handler — does it fire BEFORE or AFTER specific command handlers?

---

## Phase 4: Implement All Fixes

Apply every fix you identified in Phase 3. Do NOT leave anything as "should be fixed later."

**Constraints:**
- Do NOT modify `.env`, `iqbot-v3.db`, or `node_modules/`
- Build must pass with `npx tsc` (zero errors)
- Do NOT add new npm dependencies
- Every change must be intentional — no unnecessary refactoring

---

## Phase 5: Final Report

After all changes, output a structured report:

```
## FABLE 5 SWEEP RESULTS

### Files Modified
- file.ts — what changed and why

### Issues Found & Fixed
1. [SEVERITY] Description — what was wrong, how it was fixed

### Issues Found — Needs Architecture Discussion
1. [Description] — things that need design decisions beyond a code fix

### Verification
- Build: PASS/FAIL
- Key patterns verified: [list]
```
