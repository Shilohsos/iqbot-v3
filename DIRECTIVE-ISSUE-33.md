# Issue 33: Activations screen shows "Pending: None" despite pending users existing

## Symptom
Admin Dashboard shows ⏳ 1 pending user, but clicking "Activations" button shows "Pending: None".

## Root Cause
**File:** `src/bot.ts`, line 1089 — Activations handler

```typescript
const pending = getPendingManualUsers();  // ❌ queries for approval_status = 'manual'
```

**File:** `src/db.ts`, line 388-392 — `getPendingManualUsers()` function

```typescript
export function getPendingManualUsers(): UserRecord[] {
    return db.prepare(`
        SELECT * FROM users WHERE approval_status = 'manual' ORDER BY created_at DESC
    `).all() as UserRecord[];
}
```

The user table has three relevant statuses for pending/awaiting users:
- `'pending'` — waiting for approval (standard onboarding)
- `'manual'` — flagged for manual review (affiliate channel not found)

The dashboard `getApprovalStats()` correctly counts **both**:
```typescript
SUM(CASE WHEN approval_status = 'pending' THEN 1 ELSE 0 END) AS pending,
SUM(CASE WHEN approval_status = 'manual'  THEN 1 ELSE 0 END) AS manual,
```

But the Activations screen only checks `'manual'`, missing `'pending'` users entirely.

## Current data
```
UID: 5324040109  username: Amara6442  status: pending  tier: DEMO
UID: 6622587977  username: Thatgirlshay237  status: approved  tier: DEMO
UID: 7679722084  username: abijahtega  status: approved  tier: PRO
```

## Fix Required
**In `src/db.ts`**: Rename/update `getPendingManualUsers()` to return users with status `'pending'` OR `'manual'` — all users who haven't been approved or rejected yet.

Options:
1. Update `getPendingManualUsers()` to query both statuses:
   ```sql
   WHERE approval_status IN ('pending', 'manual')
   ```
2. Or rename it to `getPendingUsers()` for clarity and use the query above.

**In `src/bot.ts`** (line 1089): Update the call to use the corrected function.

## Acceptance Criteria
- [ ] Activations screen shows all unapproved users (both `pending` and `manual` statuses)
- [ ] Dashboard count (⏳) matches what Activations lists
- [ ] Approved and rejected users are not shown as pending
