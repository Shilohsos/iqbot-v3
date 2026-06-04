# Directive: Broadcast segments — reduce to 3 (Funded / Non-Funded / Non-Activated)

**IMPORTANT: Merge master first**

## Overview

Replace the current 7 broadcast target groups with 3:

| Segment | Who | DB condition |
|---------|-----|--------------|
| **💰 Funded** | Users who funded their account | `tier IN ('PRO','MASTER') AND ssid IS NOT NULL` |
| **💎 Non-Funded** | Connected but not funded | `tier = 'DEMO' AND ssid IS NOT NULL AND approval_status = 'approved'` |
| **❌ Non-Activated** | Never connected or rejected | `ssid IS NULL OR ssid = '' OR approval_status = 'rejected'` |

Plus keep **Test User** and **Admin Back** buttons.

---

## Step 1 — Update broadcast target keyboard

**File:** `src/ui/admin.ts` — function `broadcastTargetKeyboard()` (line 149)

**Current:**
```typescript
export function broadcastTargetKeyboard(): IKMarkup {
    return {
        inline_keyboard: [
            [{ text: '🟢 Active Traders (< 5h ago)',         callback_data: 'broadcast:active' }],
            [{ text: '🔴 Inactive Traders (5h+ idle)',       callback_data: 'broadcast:inactive' }],
            [{ text: '✅ Activated (IQ connected)',           callback_data: 'broadcast:activated' }],
            [{ text: '❌ Non-Activated (no IQ / rejected)',  callback_data: 'broadcast:nonactivated' }],
            [{ text: '👥 All Users',                          callback_data: 'broadcast:all' }],
            [{ text: '🧪 Test User Only',                     callback_data: 'broadcast:testuser' }],
            [{ text: '📅 Scheduled',                          callback_data: 'admin:scheduled' }],
            [{ text: '🔙 Admin Menu',                         callback_data: 'admin:back' }],
        ],
    };
}
```

**Replace with:**
```typescript
export function broadcastTargetKeyboard(): IKMarkup {
    return {
        inline_keyboard: [
            [{ text: '💰 Funded',                              callback_data: 'broadcast:funded' }],
            [{ text: '💎 Non-Funded (connected, no deposit)',  callback_data: 'broadcast:nonfunded' }],
            [{ text: '❌ Non-Activated (no IQ / rejected)',    callback_data: 'broadcast:nonactivated' }],
            [{ text: '🧪 Test User Only',                      callback_data: 'broadcast:testuser' }],
            [{ text: '🔙 Admin Menu',                          callback_data: 'admin:back' }],
        ],
    };
}
```

---

## Step 2 — Add DB helper functions

**File:** `src/db.ts` — add after `getFundedUserCount()` (line 2230)

```typescript
export function getFundedUserIds(): number[] {
    return (db.prepare(
        "SELECT telegram_id FROM users WHERE ssid IS NOT NULL AND ssid != '' AND tier IN ('PRO','MASTER')"
    ).all() as { telegram_id: number }[]).map(r => r.telegram_id);
}

export function getNonFundedUserIds(): number[] {
    return (db.prepare(
        "SELECT telegram_id FROM users WHERE ssid IS NOT NULL AND ssid != '' AND approval_status = 'approved' AND (tier IS NULL OR tier = 'DEMO')"
    ).all() as { telegram_id: number }[]).map(r => r.telegram_id);
}
```

---

## Step 3 — Update broadcast handler regex and logic

**File:** `src/bot.ts`

### 3a — Update the regex pattern (line 2197)

**Current:**
```typescript
bot.action(/^broadcast:(active|inactive|activated|nonactivated|all|testuser)$/, async ctx => {
```

**Replace with:**
```typescript
bot.action(/^broadcast:(funded|nonfunded|nonactivated|testuser)$/, async ctx => {
```

### 3b — Update the target ID resolution (lines 3659-3662)

**Current:**
```typescript
                    if (target === 'active') targetIds = getActiveTraderIds(5);
                    else if (target === 'inactive') targetIds = getInactiveTraderIds(5);
                    else if (target === 'activated') targetIds = getActivatedUserIds();
                    else if (target === 'nonactivated') targetIds = getNonActivatedUserIds();
```

**Replace with:**
```typescript
                    if (target === 'funded') targetIds = getFundedUserIds();
                    else if (target === 'nonfunded') targetIds = getNonFundedUserIds();
                    else if (target === 'nonactivated') targetIds = getNonActivatedUserIds();
```

### 3c — Remove or update the `broadcast:all` and `admin:scheduled` handlers if they reference old segments

Check if there's a `broadcast:all` handler:
```
bot.action('broadcast:all', ...)
```
Remove or update it.

Check for `admin:scheduled`:
```
bot.action('admin:scheduled', ...)
```
Keep scheduled if it still exists as a separate feature, or remove if no longer needed.

### 3d — Update imports

Add to the db.js import block:
```
+   getFundedUserIds,
+   getNonFundedUserIds,
```

---

## Verification

1. `npx tsc --noEmit` — must pass
2. Tap 📢 Broadcast in admin menu → shows 3 segments + Test User
3. Each segment resolves the correct user IDs
4. Broadcast sends work correctly for each segment
