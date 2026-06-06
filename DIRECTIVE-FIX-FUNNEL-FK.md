# Directive: Fix Funnel Parse Error + Giveaway FK Error

**IMPORTANT: Merge master first**

## Problem 1: Funnel button crashes with Markdown parse error

**Root cause:** The funnel message at `src/bot.ts` line 2451 uses `.join('\\n')` which produces literal `\n` text (backslash + n), NOT actual newlines. This makes the message one long line. Telegram's Markdown parser then misinterprets intra-word underscores in event types (e.g. `user_connected`) as italic entities, causing "can't parse entities" when the underscore isn't at a word boundary.

**Fix:** Change the join separator from `'\\n'` (literal backslash-n) to `'\n'` (actual newline character):

**File:** `src/bot.ts`, line ~2451

```typescript
// Change from literal \n:
].join('\\n');

// To actual newlines:
].join('\n');
```

Also apply same fix to `recentLines` at ~line 2424:
```typescript
// Change from:
`).join('\\n');
// To:
`).join('\n');
```

This ensures the message has real newlines, so underscores appear at line-start word boundaries and are correctly interpreted as Markdown entities.

## Problem 2: FOREIGN KEY error for user 8699680983

**Root cause:** User 8699680983 doesn't exist in `users` table (joined during 403 bug period). When the user interacts with giveaways (taps Participate, receives updates), the giveaway system inserts into `giveaway_participants` or `giveaway_updates` which have `FOREIGN KEY (telegram_id) REFERENCES users(telegram_id)`. The insert fails with FK violation.

**Fix:** Two approaches:

### Option A: Add user to users table (quick fix)
```sql
INSERT OR IGNORE INTO users (telegram_id, approval_status, tier) VALUES (8699680983, 'approved', 'DEMO');
```

### Option B: Handle FK in giveaway insert code
Change `insertGiveawayParticipant` and `queueParticipantUpdate` in `src/db.ts` to use `INSERT OR IGNORE` and check user existence before queuing updates.

**Recommended: Option A** — it's a single user, and they're clearly a legitimate user who joined the channel. They should be in the users table.

## What's NOT needed (already handled)

- **Onboarding state migration:** All 46 stuck users have valid states (`awaiting_user_id`, `awaiting_email`, `connected`). The reconnect cycle (runs every 60s) already sends them nudge messages.
- **Reconnect to expired SSIDs:** The reconnect cycle already handles this — 32 users were due at last startup and are being messaged every 60s tick.

## Deploy Checklist

| Step | Status |
|------|--------|
| 1. Merge master into feature branch | ☐ |
| 2. Apply `'\\n'` → `'\n'` fix in bot.ts | ☐ |
| 3. Insert user 8699680983 into users table | ☐ |
| 4. `npm run build` | ☐ |
| 5. `pm2 restart iqbot-v3-bot --update-env` | ☐ |
| 6. Push to origin | ☐ |
| 7. Verify funnel button works | ☐ |
