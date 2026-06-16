# DIRECTIVE: Comprehensive System Audit — Findings for Verification

## IMPORTANT: Merge master first

Before implementing, merge the latest master into your working branch. This directive covers findings across 3 recent audit sweeps of access.ts, auto-trading.ts, and bot.ts.

## How to Read

Each finding is tagged with severity:
- **🔴 Critical** — will crash, corrupt data, or silently break a core user flow
- **🟠 High** — incorrect behavior, significant UX impact, or permanent stuck state
- **🟡 Medium** — logic bug with moderate impact
- **🟢 Low** — code hygiene, dead code, or edge case

**Please verify each finding independently.** Do not take the audit at face value — some findings may be incorrect (see Verified Issues section).

---

## Section A: Verified Issues (confirmed by independent inspection)

### A1. 🔴 auto:god — missing `mode` property in wizard state

**File:** `src/bot.ts` line 2704

```typescript
autoWizSessions.set(ctx.chat!.id, { step: 'confirm', currency, amount: stakeNative, assets, timeframe, gale });
//                                 ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
//                                 No `mode` field!
```

When the user clicks "Approve & Start" after God Mode generates a plan, the `aconfirm` handler destructures `st.mode` and passes it to `autoEngine.start()`:

```typescript
upsertAutoSession({
    telegram_id: uid, currency: st.currency, amount: st.amount,
    assets: st.assets, timeframe: st.timeframe, gale_rounds: st.gale ?? 3,
    mode: st.mode,   // ← undefined from auto:god
});
autoEngine.start(uid, st.mode);  // ← starts with undefined mode
```

The `upsertAutoSession` INSERT uses `mode` column which defaults to 'live'. But `autoEngine.start(uid, undefined)` may behave incorrectly (the engine checks `this.mode === 'demo'` in several places).

**Fix:** Add `mode: 'live'` to the God Mode wizard state.

---

### A2. 🔴 auto:start:live — doesn't call `hasAccessLive`, uses stale DB balance

**File:** `src/bot.ts` lines 2522-2542

The `auto:start:live` handler re-checks the balance gate using `getUser().funded_balance_usd` (stale DB cache):

```typescript
const funded = user?.funded_balance_usd ?? 0;  // ← stale from DB
```

This does NOT call `hasAccessLive()`. Compare with:
- `ui:auto` (line 2486) ✅ calls `hasAccessLive` before showing the menu
- `ui:trade` (line 1943) ✅ calls `hasAccessLive`
- `auto:god` (line 2674) ✅ calls `hasAccessLive`

**Scenario:** User has $40 but DB shows $0. They click Auto Trading → `ui:auto` passes via `hasAccessLive` → "Live Trading" button shown → they click it → **blocked** because `auto:start:live` reads stale $0 from DB.

**Fix:** Replace the stale `getUser()` read with a `hasAccessLive()` call at the top of `auto:start:live`.

---

### A3. 🔴 syncAccessFromBalance — passes current access_level as tokenGrant, preventing downgrades

**File:** `src/bot.ts` line 836

```typescript
const newAccess = resolveAccess(usdAmount, getProduct(prev?.access_level), prev?.access_expires_at);
```

**Problem:** `resolveAccess(balance, tokenGrant, expiresAt)` uses `tokenGrant` as an override — if the token grant rank is HIGHER than the balance-derived level, it sticks. Passing the user's **current** `access_level` as `tokenGrant` means:

1. User funds $150 → `auto_trading` (stored in DB)
2. Balance drops to $5 → `syncAccessFromBalance` passes `'auto_trading'` as tokenGrant
3. `resolveAccess(5, 'auto_trading', null)` returns `'auto_trading'` because rank(2) > rank(0)
4. User is **permanently stuck** at `auto_trading` regardless of actual balance

**All 3 call sites affected:** line 836 (syncAccessFromBalance), line 1117 (post-connect sync), line 6613 (periodic 30-min sync).

This makes the `relockBalance` thresholds ($5/$10) completely inoperative.

**Fix:** `syncAccessFromBalance` should pass `undefined` as the token grant, letting the balance purely determine access. Only token grants from the `upgrade_tokens` table should override balance.

---

### A4. 🔴 Demo/Live mode system (isDemoMode, shouldRevertToDemo, relockBalance) is dead code

**File:** `src/access.ts` lines 44-66 (relockBalance), lines 125-180 (isDemoMode, shouldRevertToDemo, getDemoLimitMessage, getRelockMessage)

**Problem:** These 5 exported functions are **defined, exported, and imported in bot.ts but never called anywhere in the codebase.** The comment block at the top of access.ts (lines 11-20) describes a full Demo/Live mode system with relock semantics — but none of it is wired into the gating logic. Changing `relockBalance` has zero effect on runtime behavior.

**Confirm via:**
```bash
grep -rn 'shouldRevertToDemo\|getDemoLimitMessage\|getRelockMessage\|isDemoMode' src/
```

**Fix:** Either (a) wire these functions into `syncAccessFromBalance` and `hasAccessLive` to implement the promised relock system, or (b) remove them as dead code.

---

### A5. 🟠 `setUserFundedBalance` doesn't clear stale `access_expires_at`

**File:** `src/db.ts` lines 1016-1023

```typescript
export function setUserFundedBalance(telegramId: number, fundedUsd: number, accessLevel?: string): void {
    if (accessLevel) {
        db.prepare('UPDATE users SET funded_balance_usd = ?, access_level = ? WHERE telegram_id = ?')
            .run(fundedUsd, accessLevel, telegramId);
    }
```

**Problem:** When `syncAccessFromBalance` updates access from a live balance check, `access_expires_at` from any previous token grant is left dangling in the DB. This doesn't cause an active bug (the `downgradeExpiredAccess` cron clears expired tokens hourly), but it's inconsistent and fragile.

**Fix:** Set `access_expires_at = NULL` in the UPDATE when `accessLevel` is provided.

---

### A6. 🟠 `refreshFundedBalanceFromLive` doesn't clear stale SSID when reconnect fails

**File:** `src/bot.ts` lines 861-869

```typescript
if (isAuthExpiredError(err) && await autoReconnect(uid)) {
    ssid = getSsidForUser(uid);
    if (ssid) { try { await fetchAndSync(ssid); } catch { /* give up */ } }
}
// Non-auth errors OR auth error + reconnect failed: silently return
```

**Problem:** When `isAuthExpiredError(err)` IS true but `autoReconnect()` returns false (bad credentials, decoding failure), the stale SSID is never cleared. Compare with the periodic sync at lines 6621-6629 which correctly clears it:

```typescript
if (isAuthExpiredError(err)) {
    const reconnected = await autoReconnect(user.telegram_id);
    if (!reconnected) {
        clearUserSsid(user.telegram_id);    // ← this is missing in refreshFundedBalanceFromLive
        setSsidValid(user.telegram_id, 0);
    }
}
```

**Fix:** Add `clearUserSsid()` + `setSsidValid(0)` when reconnect fails in `refreshFundedBalanceFromLive`.

---

### A7. 🟠 `auto:resume` uses cached `requireAutoAccess` instead of `hasAccessLive`

**File:** `src/bot.ts` line 2742

```typescript
if (session?.mode !== 'demo' && !requireAutoAccess(ctx)) { await sendAutoTradingLock(ctx); return; }
```

`requireAutoAccess` only checks cached `access_level` from DB. Doesn't do live balance refresh. Lower severity than A2 because resume only works for existing sessions (user was already approved at session start), but a session could have been stopped long enough for the balance to drop below threshold.

**Fix:** Replace `requireAutoAccess(ctx)` with `hasAccessLive(ctx.from!.id, 'auto_trading')`.

---

### A8. 🟠 Auto-trading demo timer never reads DB-stored minutes after restart

**File:** `src/auto-trading.ts` lines 42-47

`getDemoMinutesUsed()` only reads from the in-memory `demoTimers` Map. After a PM2 restart, the map is empty — returns 0, and `isDemoLimitReached()` returns false. The engine can thus **trade past the 30-minute daily cap** after a restart, while the UI correctly blocks NEW sessions via `canAutoDemo()` reading from DB.

**This was likely the cause of the heap+restart issues:** each time the bot restarted, demo users got a fresh 30 minutes.

**Fix:** `getDemoMinutesUsed()` should also read `getProductUsage(uid, 'auto_trading').used` from DB and add it to the in-memory total.

---

### A9. 🟠 reviews:approve and reviews:copy are UI dead-ends

**File:** `src/bot.ts` lines ~4687-4693

Both handlers only show toast notifications. No actual approval record stored, no broadcast triggered, no clipboard action possible in Telegram. Admin clicks these expecting action — nothing happens.

**Fix:** Either implement actual functionality or change buttons to advise copying manually.

---

## Section B: Verified Non-Issues (audit findings that are WRONG — skip these)

The full session audit raised these concerns but they are **NOT bugs** — the columns already exist in the DB schema:

- ❌ "Missing `status_msg_id` column" → Column 18, exists as `INTEGER`
- ❌ "Missing `mg_active`/`mg_next_amount` columns" → Columns 15-16, both exist

These were added by existing lazy migrations. No fix needed.

---

## Section C: Lower Priority Findings (verify and address if relevant)

### C1. 🟡 `auto:start` handler is unreachable (dead code)
**File:** `bot.ts` lines 2485-2496 — registered as `bot.action('auto:start', ...)` but no keyboard in the codebase references `callback_data: 'auto:start'`. Can never be triggered.

### C2. 🟡 `sendAutoMenu` has no error handling around `ctx.reply`
**File:** `bot.ts` lines 2443, 2461 — throws unhandled if user blocked the bot. Other cycles (funding, reconnect) correctly use `.catch(() => {})`.

### C3. 🟡 `hasAccessLive` has no concurrency guard
**File:** `bot.ts` lines 875-880 — rapid button mashing can trigger parallel SDK balance calls. Low risk but exploitable.

### C4. 🟡 Invalid `balanceType` value `'practice'` via type-unsafe cast
**File:** `auto-trading.ts` line 399 — `const balanceType = this.mode === 'demo' ? 'practice' : 'live'` cast as `'demo' | 'live'`. Fragile — a refactor changing the check to `=== 'demo'` would break demo mode trading.

### C5. 🟡 `getAccessLevel` duplicates threshold constants
**File:** `access.ts` lines 201-205 — uses hardcoded `AUTO_TRADING_MIN_USD = 100` and `AI_TRADING_MIN_USD = 30` instead of reading from `PRODUCT_LIMITS`. Changes to thresholds wouldn't propagate.

### C6. 🟡 All errors in `refreshFundedBalanceFromLive` silently swallowed
**File:** `bot.ts` lines 847-870 — Users never know their balance refresh failed. Combine with A6, a user with expired SSID whose reconnect fails is silently stuck forever.

### C7. 🟢 `PRIV_IDS` Set recreated every loop iteration in auto-trading
**File:** `auto-trading.ts` line 346 — Should be module-level constant.

### C8. 🟢 `convertToUsd` rateCache map never prunes expired entries
**File:** `access.ts` line 318 — Memory leak pattern. Low impact (small currency set).

---

## Files Referenced

| File | Path |
|------|------|
| Access gating | `src/access.ts` |
| Auto trading engine | `src/auto-trading.ts` |
| Main bot handler | `src/bot.ts` |
| Database helpers | `src/db.ts` |
