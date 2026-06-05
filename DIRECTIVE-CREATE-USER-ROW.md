# Directive: Create User Row Before Onboarding — Fix FK Crash

**IMPORTANT: Merge master first**

## Root Cause

Both `startNewOnboarding()` and `sendNewOnboardingViaTelegram()` call `setOnboardingState(telegramId, 'entry')` as their first action. This function does:

1. `UPDATE users SET onboarding_state = ?` — no-op if user doesn't exist
2. `INSERT INTO onboarding_tracking ... ON CONFLICT DO UPDATE` — **FAILS with FK error** because `onboarding_tracking.telegram_id` references `users(telegram_id)` and the user row doesn't exist

This causes TWO failures:
- **Channel join:** The channel handler catches the error → logs "[channel] failed to send onboarding" → user gets no onboarding
- **/start:** No try-catch → error bubbles to `bot.catch` → "⚠️ Something went wrong" → user can never start

## Changes Required

### 1. Ensure user exists before `setOnboardingState` in `src/onboarding.ts`

**In `startNewOnboarding()`** — add user creation as the first action:

```typescript
export async function startNewOnboarding(ctx: Context, telegramId: number): Promise<void> {
    if (getConfig('features_paused') === '1') return;

    // Ensure user row exists before setting onboarding state
    // (onboarding_tracking has a FK → users, so INSERT fails if user doesn't exist)
    db.prepare(`
        INSERT INTO users (telegram_id, approval_status, created_at)
        VALUES (?, 'pending', datetime('now'))
        ON CONFLICT(telegram_id) DO UPDATE SET
            approval_status = COALESCE(approval_status, 'pending'),
            created_at = COALESCE(created_at, datetime('now'))
    `).run(telegramId);

    setOnboardingState(telegramId, 'entry');
    // ... rest remains the same
}
```

**In `sendNewOnboardingViaTelegram()`** — add user creation before `setOnboardingState`:

```typescript
export async function sendNewOnboardingViaTelegram(
    telegram: Telegraf['telegram'],
    userId: number,
    firstName: string,
): Promise<void> {
    if (getConfig('features_paused') === '1') return;

    // Ensure user row exists before setting onboarding state
    db.prepare(`
        INSERT INTO users (telegram_id, approval_status, created_at)
        VALUES (?, 'pending', datetime('now'))
        ON CONFLICT(telegram_id) DO UPDATE SET
            approval_status = COALESCE(approval_status, 'pending'),
            created_at = COALESCE(created_at, datetime('now'))
    `).run(userId);

    setOnboardingState(userId, 'entry');
    // ... rest remains the same
}
```

### 2. Add import in `src/onboarding.ts`

If `db` is not already imported in `onboarding.ts`, add it. Check existing imports — likely `from './db.js'` is already imported since the file uses `getTemplateByKey`, `setOnboardingState`, etc.

## How It Works

| Scenario | Before | After |
|----------|--------|-------|
| User joins channel (new, no DB row) | FK error → onboarding silently fails → user gets no messages | ✅ User row created → onboarding_tracking INSERT succeeds → onboarding sent |
| User sends /start (new, no DB row) | FK error → "Something went wrong" | ✅ User row created → onboarding starts normally |
| User sends /start repeatedly | Keeps crashing | ✅ ON CONFLICT handles existing rows gracefully |

## Verification

1. `npx tsc --noEmit` — must pass with zero errors
2. Clear a test user from `users` table (or use a new Telegram account)
3. Send /start → must receive onboarding flow (not "Something went wrong")
4. Verify user row was created in `users` table with `approval_status = 'pending'`
5. Existing users who already have a DB row → no change in behavior
