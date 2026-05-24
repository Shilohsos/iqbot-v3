# Review Request: Channel Join + Broadcast Targeting

Claude, please review the changes in commit `a02afe3` on the `master` branch (also fast-forward merged into `claude/broadcast-scheduling-feature-BaEF3`).

## Files Changed

### `src/channel.ts`
**Replaced hardcoded welcome message with onboarding flow.**
- Old: Sent a static "🎉 Welcome to 10x Signals!" message with a Trade Now button
- New: Sends the same onboarding sequence as `/start` — L1 image + brand intro → L3 image + account connection choice (same as `startOnboarding()` in bot.ts)
- Imports `onboardKeyboard` from `./ui/user.js` to render the connection choice buttons

### `src/db.ts`
**Added two new query functions:**
- `getActivatedUserIds()` — users with `ssid IS NOT NULL` (connected IQ account)
- `getNonActivatedUserIds()` — users with `ssid IS NULL` OR `approval_status = 'rejected'`

### `src/ui/admin.ts`
**Updated broadcast target keyboard** with two new options:
- "✅ Activated (IQ connected)" → `broadcast:activated`
- "❌ Non-Activated (no IQ / rejected)" → `broadcast:nonactivated`

### `src/bot.ts`
**Wired up the new targets:**
- Added `getActivatedUserIds`, `getNonActivatedUserIds` to imports
- Extended `broadcastTarget` type union to include `'activated' | 'nonactivated'`
- Updated action handler regex and type assertion
- Added resolution logic: `activated` → `getActivatedUserIds()`, `nonactivated` → `getNonActivatedUserIds()`

## Things to Verify
1. `sendOnboarding()` in channel.ts correctly replicates the `/start` flow for new users
2. The new DB queries correctly distinguish activated vs non-activated users
3. The broadcast UI and handler properly include the new target groups
4. Any edge cases — duplicate button IDs, missing imports, etc.

## Suggested
The `dist/` directory contains stale build artifacts — if approved, can be added to `.gitignore` and cleaned up in a follow-up commit.
