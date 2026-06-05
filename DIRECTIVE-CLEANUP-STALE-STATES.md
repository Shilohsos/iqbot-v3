# DIRECTIVE: One-time cleanup of stale onboarding states

## Problem

After the major simplification, 25 users still have legacy `onboarding_state` values that no longer have handlers:

- `entry_branch_sent`: 17 users
- `new_user_watch_video`: 4 users
- `returning_user_ask_account`: 3 users
- `entry`: 1 user

These users will either hit the LLM brain (which may give irrelevant responses) or receive no reply at all.

## Solution

Run a one-time migration that moves all legacy states into `awaiting_user_id`. This puts them back into the clean User ID → email → password flow.

## Changes

### Option 1: Add admin command (recommended)

**File: `src/bot.ts`**

Add a new admin command:

```typescript
bot.command('admin migrate_states', async ctx => {
    if (ctx.from!.id !== getAdminId()) return;

    const result = db.prepare(`
        UPDATE users 
        SET onboarding_state = 'awaiting_user_id' 
        WHERE onboarding_state IN ('entry', 'entry_branch_sent', 'new_user_watch_video', 'returning_user_ask_account')
    `).run();

    await ctx.reply(`✅ Migrated ${result.changes} users to awaiting_user_id state.`);
});
```

### Option 2: One-time manual run (fastest)

Run this SQL directly on the VPS:

```bash
sqlite3 /root/iqbot-v3/iqbot-v3.db "
UPDATE users 
SET onboarding_state = 'awaiting_user_id' 
WHERE onboarding_state IN ('entry', 'entry_branch_sent', 'new_user_watch_video', 'returning_user_ask_account');
"
```

Then verify:

```bash
sqlite3 /root/iqbot-v3/iqbot-v3.db "
SELECT onboarding_state, COUNT(*) 
FROM users 
WHERE onboarding_state IS NOT NULL 
GROUP BY onboarding_state;
"
```

Expected result after migration:

```
awaiting_user_id | 25
connected        | 3
```

## After Migration

- All users are now in the clean flow.
- The `entry` state is no longer used anywhere and can be removed from code in a future cleanup if desired.
- No more unresponsive users due to stale states.

Send to Claude.