# Directive: Exclude Admin from Mass Broadcasts

**Authority:** Master Ferdinand Shiloh Hart  
**From:** Wizard  
**Date:** 2026-06-06

IMPORTANT: Merge master first before implementing.

---

## Problem

Admin Telegram ID is included in all mass-send user queries. Admin receives giveaway results, notifications, and other user-facing broadcasts.

## Fix

**File: `src/db.ts`**

Update `getAllUserIds()` to exclude admin ID:

```typescript
export function getAllUserIds(): number[] {
    const adminId = parseInt(process.env.ADMIN_USER_ID ?? '1615652240', 10);
    return (db.prepare(
        'SELECT telegram_id FROM users WHERE telegram_id != ?'
    ).all(adminId) as { telegram_id: number }[]).map(r => r.telegram_id);
}
```

This ensures admin is excluded from:
- Giveaway results announcements (`giveaway.ts:296`)
- Any other function that calls `getAllUserIds()` for mass broadcasts

**Also fix `src/db.ts` — `getBroadcastTargetIds()`:**

This was already updated in the previous directive to exclude admin. Verify it's correct at line ~811:

```typescript
export function getBroadcastTargetIds(): number[] {
    const adminId = parseInt(process.env.ADMIN_USER_ID ?? '1615652240', 10);
    return (db.prepare(
        "SELECT telegram_id FROM users WHERE ssid IS NOT NULL AND ssid != '' AND tier IN ('PRO','MASTER') AND telegram_id != ?"
    ).all(adminId) as { telegram_id: number }[]).map(r => r.telegram_id);
}
```

## Verification

1. Giveaway completes → result announcement sent to all users except admin
2. Admin no longer sees "Missed out? Upgrade to PRO" in own DM
