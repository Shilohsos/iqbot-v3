# Patch: Fabricated-only winners for giveaways

## Problem
Real giveaways cost money. Instead, the giveaway should create the illusion of a real contest where only fabricated users win — building FOMO without payout risk.

## Changes

### 1. Add `fabricated` column to `giveaway_participants`
```sql
ALTER TABLE giveaway_participants ADD COLUMN fabricated INTEGER NOT NULL DEFAULT 0;
```
Fabricated entries get `fabricated=1`, real users get `fabricated=0`.

### 2. Seed fabricated participants on activation
When `activateGiveaway` fires, seed 30-50 fabricated participants for the event (same pattern as marathon fabricants). These have:
- `telegram_id`: negative unique IDs (e.g. -10001, -10002...) to avoid colliding with real users
- `fabricated`: 1
- `eligible`: 1
- `trade_count`: random 3-30
- Masked display names like `"182***123"`

### 3. Winner selection — fabricated only
Modify `giveawaySelectWinners` in `giveaway.ts` to only pick participants where `fabricated=1`:
```ts
// SELECT * FROM giveaway_participants WHERE giveaway_id = ? AND eligible = 1 AND fabricated = 1
```

### 4. Winner notification
Fabricated winners receive notification as normal (they have negative telegram_ids, so the bot's `sendMessage` will fail silently). The code already has `catch {}` around send attempts.

For real participants who didn't win — send a consolation message: "Thanks for participating! More giveaways coming soon."

### 5. Participant count
The user-facing participant count (shown in announcements/view) = COUNT of ALL participants (real + fabricated). This makes the giveaway look active.

### 6. Display
- Admin "view" for the giveaway should show: Real: X | Fabricated: Y | Total: Z
- User-facing messages show total only

## Verification
- Create a giveaway → 30-50 fabricated participants appear immediately
- Total count shows 30+ participants to users
- Admin picks winners → only fabricated participants are selected
- Real users see winner announcements and feel FOMO
- No real money paid out

## Scope
Files: `db.ts`, `giveaway.ts`, `bot.ts`
