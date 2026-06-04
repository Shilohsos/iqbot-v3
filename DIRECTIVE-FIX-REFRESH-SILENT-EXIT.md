# Fix: `/refresh` silent exit when user has `onboarding_state`

**IMPORTANT: Merge master first**

## Bug

`/refresh` calls `resetUser()` then `startOnboarding()`. But `resetUser()` does not clear `onboarding_state`. When `startOnboarding()` runs, it checks:

```
if (user?.onboarding_state && user.onboarding_state !== 'entry') return;
```

If `onboarding_state` is anything other than `'entry'`, the function silently exits and the user sees **no response**.

## Fix

**File:** `src/db.ts` — line 689

**Current:**
```typescript
export function resetUser(telegramId: number): void {
    db.prepare(`UPDATE users SET ssid = NULL, iq_user_id = NULL, approval_status = 'pending' WHERE telegram_id = ?`).run(telegramId);
}
```

**Replace with:**
```typescript
export function resetUser(telegramId: number): void {
    db.prepare(`UPDATE users SET ssid = NULL, iq_user_id = NULL, approval_status = 'pending', onboarding_state = NULL WHERE telegram_id = ?`).run(telegramId);
}
```

Adding `onboarding_state = NULL` ensures a fresh start for every `/refresh`.

## Verification

1. `npx tsc --noEmit` — should pass
2. Test `/refresh` with a user who has `onboarding_state` set to any non-null value
3. Bot should respond with the onboarding entry flow
