# IMPORTANT: Merge master first
## DIRECTIVE: FIX-TEMPLATES-RESEED-ON-RESTART
## Problem: seedTemplates() runs on EVERY bot restart, re-inserting deleted templates

### Root Cause

`src/db.ts` line `seedTemplates()` is called unconditionally at startup (in `bot.ts`). It uses `INSERT OR IGNORE`, so existing templates are preserved — but any templates that were **deleted** during cleanup get re-inserted from the seed SQL files (`db/templates-seed.sql`, `db/templates-brain-seed.sql`).

This means every restart undoes template cleanup and brings back all the old categories (pricing_tiers, withdrawal, funding_deposit, scam_legit, etc.).

### Fix

**File:** `src/db.ts` — `seedTemplates()` function

Add an early-exit guard that checks if templates already exist:

```typescript
export function seedTemplates() {
    const existing = db.prepare('SELECT COUNT(*) AS cnt FROM templates').get() as { cnt: number };
    if (existing.cnt > 0) {
        return; // Already seeded — don't re-insert
    }
    // ... rest of existing seed logic
}
```

This ensures seed only runs on first-ever startup (empty database), never again after templates have been modified or cleaned.

### Cleanup of already-re-inserted templates

Since the seed already re-ran on this restart, the 101 previously-deleted templates are already back. The `seedTemplates()` guard prevents future re-insertions, but we also need to remove the current duplicates.

In `seedTemplates()` (or in `bot.ts` right after the seed call), add a cleanup query to remove the categories we deliberately deleted:

```typescript
// Cleanup: remove template categories we don't use
db.exec(`
    DELETE FROM templates WHERE category IN (
        'pricing_tiers', 'upgrade_migration', 'funding_deposit',
        'withdrawal', 'scam_legit', 'risk_safety',
        'bot_strategy', 'referral_affiliate', 'leaderboard_stats',
        'trading_explanation', 'how_bot_works', 'bot_not_working',
        'loss_recovery', 'frustration_complaint', 'need_time',
        'unrecognized', 'thanks_response', 'talk_to_admin',
        'ssid_connect_fail', 'promo_bonus', 'returning_user',
        'new_user_greeting', 'greeting', 'reengage'
    )
`);
```

Place this AFTER the seed guard so it runs once on first startup (cleaning what the seed just inserted) and never runs again.

### Testing

1. Restart bot — verify `[db] templates: 179 rows after seed` no longer appears
2. Run `SELECT COUNT(*) FROM templates` — should be 78
3. Verify old deleted categories (pricing_tiers, withdrawal, etc.) are NOT back
