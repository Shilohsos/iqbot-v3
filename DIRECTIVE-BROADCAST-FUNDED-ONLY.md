# Directive: Auto-Broadcast Only to Funded Users

**IMPORTANT: Merge master first**

## Change

Restrict the auto-broadcast to **funded users only** — users who have connected their IQ Option account AND are PRO or MASTER tier. These are users who have funded and just need trade reminders.

## Current vs New

**Current `getBroadcastTargetIds()` in `src/db.ts` (line 760-763):**
```typescript
export function getBroadcastTargetIds(): number[] {
    return (db.prepare(
        'SELECT telegram_id FROM users WHERE ssid_valid IS NULL OR ssid_valid = 1'
    ).all() as { telegram_id: number }[]).map(r => r.telegram_id);
}
```

This sends to EVERY user (non-activated, DEMO, rejected — everyone except those with `ssid_valid = 0`).

**Replacement:**
```typescript
/** Broadcast targets: only funded users (PRO/MASTER with SSID). */
export function getBroadcastTargetIds(): number[] {
    return (db.prepare(
        "SELECT telegram_id FROM users WHERE ssid IS NOT NULL AND ssid != '' AND tier IN ('PRO','MASTER')"
    ).all() as { telegram_id: number }[]).map(r => r.telegram_id);
}
```

## Verification

1. `npx tsc --noEmit` — must pass
2. Check DB: `SELECT COUNT(*) FROM users WHERE ssid IS NOT NULL AND ssid != '' AND tier IN ('PRO','MASTER')` — should match the new target count
3. Next auto-broadcast fire → only funded users receive it
