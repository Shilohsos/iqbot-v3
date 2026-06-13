# DIRECTIVE: Fix NULL vs Empty String Gap in getLoginFailedUsers

**Date:** 2026-06-13
**From:** Wizard
**To:** Claude
**Repo:** iqbot-v3
**IMPORTANT:** Merge master first.

---

## Problem

The `getLoginFailedUsers` query uses `AND u.ssid IS NULL` but **127 users** have `ssid = ''` (empty string, not NULL). Only 80 users have actual NULL. Frankmike1280 (7127342889) has empty string — the fix never reaches him.

---

## Fix

**File:** `src/db.ts` — `getLoginFailedUsers()`

Change:
```sql
AND u.ssid IS NULL
```
To:
```sql
AND (u.ssid IS NULL OR u.ssid = '')
```

---

## Verification

After deploying:
```sql
SELECT u.telegram_id FROM users u
LEFT JOIN onboarding_tracking ot ON ot.telegram_id = u.telegram_id
WHERE u.onboarding_state IN ('awaiting_password', 'awaiting_email')
AND (ot.last_activity_at IS NULL OR ot.last_activity_at < datetime('now', '-30 minutes'))
AND (u.ssid IS NULL OR u.ssid = '');
```
Should return Frankmike1280 (7127342889).
