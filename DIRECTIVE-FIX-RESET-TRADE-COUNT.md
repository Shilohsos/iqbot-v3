# Fix: `/refresh` not resetting demo_trade_count

**IMPORTANT: Merge master first**

## Bug

`/refresh` calls `resetUser()` which only clears fields in the `users` table. `demo_trade_count` in `onboarding_tracking` persists from the old session. After a fresh connect, `getDemoTradeCount()` returns the old count (> 0), so the first trade triggers the upsell flow instead of the first-trade congrats + command guide.

## Fix

**File:** `src/db.ts` — line 688

**Current:**
```typescript
export function resetUser(telegramId: number): void {
    db.prepare(`UPDATE users SET ssid = NULL, iq_user_id = NULL, approval_status = 'pending', onboarding_state = NULL WHERE telegram_id = ?`).run(telegramId);
}
```

**Replace with:**
```typescript
export function resetUser(telegramId: number): void {
    db.prepare(`UPDATE users SET ssid = NULL, iq_user_id = NULL, approval_status = 'pending', onboarding_state = NULL WHERE telegram_id = ?`).run(telegramId);
    db.prepare(`DELETE FROM onboarding_tracking WHERE telegram_id = ?`).run(telegramId);
}
```

Deleting the `onboarding_tracking` row resets `demo_trade_count`, `last_funding_at`, `last_activity_at`, `last_followup_msg_id` — everything. Fresh start.

## Verification

1. `npx tsc --noEmit` — must pass
2. User with existing trade history sends `/refresh`
3. Reconnects through onboarding
4. First demo trade WIN → shows congrats + command guide + main menu (not upsell)
5. Second demo trade WIN → shows upsell + funding sequence as expected
