# Fix FOREIGN KEY constraint failed on onboarding_tracking

## IMPORTANT: Merge master first

```bash
git checkout master && git pull origin master && git checkout -b claude/fix-onboarding-fk
```

## Problem

Three functions in `src/db.ts` write to `onboarding_tracking` which has `FOREIGN KEY (telegram_id) REFERENCES users(telegram_id)`:

- `setOnboardingState` (line 2221)
- `touchOnboardingActivity` (line 2230)
- `incrementDemoTradeCount` (line 2243)

When a callback or message handler calls these functions for a user who hasn't been inserted into the `users` table yet, the FK constraint fails. This produces a `bot.catch` error and the operation is silently lost.

This happens frequently because users can interact with the bot (tap broadcast buttons, join from channel, send messages) before the `users` row is created.

## Fix

Add `INSERT OR IGNORE INTO users (telegram_id, ssid, created_at) VALUES (?, '', datetime('now'))` at the start of each function to ensure the parent row exists before the FK-dependent insert.

**File:** `src/db.ts`

### 1. `setOnboardingState` (line 2221)

Add one line at the start of the function:

```typescript
export function setOnboardingState(telegramId: number, state: string): void {
    db.prepare("INSERT OR IGNORE INTO users (telegram_id, ssid) VALUES (?, '')").run(telegramId);  // ← ADD
    db.prepare("UPDATE users SET onboarding_state = ? WHERE telegram_id = ?").run(state, telegramId);
    db.prepare(`
        INSERT INTO onboarding_tracking (telegram_id, state_changed_at, last_activity_at)
        VALUES (?, datetime('now'), datetime('now'))
        ON CONFLICT(telegram_id) DO UPDATE SET state_changed_at = datetime('now'), last_activity_at = datetime('now')
    `).run(telegramId);
}
```

### 2. `touchOnboardingActivity` (line 2230)

Add one line at the start:

```typescript
export function touchOnboardingActivity(telegramId: number): void {
    db.prepare("INSERT OR IGNORE INTO users (telegram_id, ssid) VALUES (?, '')").run(telegramId);  // ← ADD
    db.prepare(`
        INSERT INTO onboarding_tracking (telegram_id, last_activity_at)
        VALUES (?, datetime('now'))
        ON CONFLICT(telegram_id) DO UPDATE SET last_activity_at = datetime('now')
    `).run(telegramId);
}
```

### 3. `incrementDemoTradeCount` (line 2243)

Add one line at the start:

```typescript
export function incrementDemoTradeCount(telegramId: number): number {
    db.prepare("INSERT OR IGNORE INTO users (telegram_id, ssid) VALUES (?, '')").run(telegramId);  // ← ADD
    db.prepare(`
        INSERT INTO onboarding_tracking (telegram_id, demo_trade_count, last_activity_at)
        VALUES (?, 1, datetime('now'))
        ON CONFLICT(telegram_id) DO UPDATE SET demo_trade_count = demo_trade_count + 1, last_activity_at = datetime('now')
    `).run(telegramId);
    const row = db.prepare('SELECT demo_trade_count FROM onboarding_tracking WHERE telegram_id = ?').get(telegramId) as { demo_trade_count: number } | undefined;
    return row?.demo_trade_count ?? 0;
}
```

## Verification

After deploying, check PM2 logs:
```bash
pm2 logs iqbot-v3-bot --lines 200 --nostream | grep "FOREIGN KEY"
```

Expected: zero FOREIGN KEY errors. If any remain, they're from a different table.
