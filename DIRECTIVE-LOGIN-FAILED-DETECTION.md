# DIRECTIVE: Reconnect Loop — Fix login_failed Detection

**Date:** 2026-06-13
**From:** Wizard
**To:** Claude
**Repo:** iqbot-v3
**IMPORTANT:** Merge master first before starting.

---

## Problem

When a user enters wrong IQ Option credentials during onboarding, the catch block sets `onboarding_state` back to `'awaiting_email'` (line 5447 of bot.ts). But `getLoginFailedUsers()` only queries for `onboarding_state = 'awaiting_password'`. The user falls into a classification gap:

| Query | Checks for | Matches Frankmike1280? |
|-------|-----------|----------------------|
| `getSsidExpiredUsers` | `ssid_valid=0 AND ssid IS NOT NULL` | No (no SSID) |
| `getUserIdRejectedUsers` | `awaiting_user_id` + 3+ fails | No (state is awaiting_email) |
| `getLoginFailedUsers` | `awaiting_password` only | **No — state is awaiting_email** |
| `getAbandonedOnboardingUsers` | `awaiting_email` after 6h inactivity | No (just active) |
| `getNeverConnectedUsers` | `onboarding_state IS NULL` | No (state is awaiting_email) |

**Result:** The reconnect loop has zero message templates for these users. If somehow they DO get a reconnect prompt (e.g., via admin `admin:ssid_expired` manual trigger), the fallback may send "Your session expired" — which is wrong for a user who never connected.

---

## Fix

### Section 1 — Broaden `getLoginFailedUsers` query

**File:** `src/db.ts` — function `getLoginFailedUsers()` (line ~2661)

**Current:**
```sql
SELECT u.telegram_id FROM users u
LEFT JOIN onboarding_tracking ot ON ot.telegram_id = u.telegram_id
WHERE u.onboarding_state = 'awaiting_password'
AND (ot.last_activity_at IS NULL OR ot.last_activity_at < datetime('now', '-1 hour'))
```

**Change:** Also accept `awaiting_email` state, and use a shorter window (30 min):
```sql
SELECT u.telegram_id FROM users u
LEFT JOIN onboarding_tracking ot ON ot.telegram_id = u.telegram_id
WHERE u.onboarding_state IN ('awaiting_password', 'awaiting_email')
AND (ot.last_activity_at IS NULL OR ot.last_activity_at < datetime('now', '-30 minutes'))
AND u.ssid IS NULL
AND u.ssid_valid IS NULL
```

The added `ssid IS NULL AND ssid_valid IS NULL` ensures we only target users who genuinely never connected (distinct from `getSsidExpiredUsers` which targets users with expired SSIDs).

### Section 2 — Fix the login_failed message to be more actionable

**File:** `src/bot.ts` — `getReconnectMessage()` case `'login_failed'` (line ~5913)

**Current message is fine but missing the specific instruction for wrong credentials:**
```
'🟣 *Login didn't go through*\n\nDouble-check your IQ Option email and password.\n\n1️⃣ Tap 🔗 Connect below\n2️⃣ Enter the correct email and password\n3️⃣ We'll handle the rest'
```

**Change:** Add a hint about common mistakes (caps lock, extra spaces, wrong email):
```
'🟣 *Login didn\\'t go through*\n\nYour IQ Option email or password was incorrect.\n\n✅ Check for typos, caps lock, or extra spaces\n✅ Make sure you\\'re using your IQ Option login (not Google/Apple)\n\n1️⃣ Tap 🔗 Connect below\n2️⃣ Enter the correct email and password\n3️⃣ Back to winning 💜'
```

### Section 3 — Ensure login failure catch sets ssid_valid properly

**File:** `src/bot.ts` — login failure catch block (line ~5445-5450)

**Current:**
```typescript
setOnboardingState(ctx.from!.id, 'awaiting_email');
const errMsg = err instanceof Error ? err.message : 'Login failed';
await ctx.reply(`❌ ${errMsg}\n\n📧 Enter your IQ Option email again:`);
```

**Change:** Add explicit `ssid_valid` clearing to ensure the user is never misclassified:
```typescript
setOnboardingState(ctx.from!.id, 'awaiting_email');
try { setSsidValid(ctx.from!.id, 0); } catch {}
const errMsg = err instanceof Error ? err.message : 'Login failed';
await ctx.reply(`❌ ${errMsg}\n\n📧 Enter your IQ Option email again:`);
```

---

## Verification

1. After deploying: query `getLoginFailedUsers()` — should return users in both `awaiting_password` AND `awaiting_email` states
2. Frankmike1280 (7127342889) should now be picked up and receive the "Login didn't go through" message
3. No user without an SSID should receive "Your session expired" message from the reconnect loop

---

## Files Modified

| File | Section | Change |
|------|---------|--------|
| `src/db.ts` | 1 | Widen `getLoginFailedUsers` to include `awaiting_email` state, 30-min window, SSID-null guard |
| `src/bot.ts` | 2 | Improve `login_failed` reconnect message |
| `src/bot.ts` | 3 | Set `ssid_valid=0` on login failure |
