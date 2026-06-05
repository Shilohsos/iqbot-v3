# DIRECTIVE: Simplify onboarding — nuke complexity, keep the core

## Goal

Replace the over-engineered onboarding (branch questions, video steps, re-engagement, LLM brain fighting) with one simple flow:

**User messages bot → asked for User ID → email → password → connected. That's it.**

No welcome sequences. No branch questions. No re-engagement. No onboarding templates. No 403 bugs from channel callbacks.

## What stays the same

- Trading, admin tools, broadcasts, giveaways, leaderboard
- Funding sequences (demo trade upsells)
- LLM brain only for **connected users** handling messages that make sense (already gated)
- User verification via `checkAffiliate`, email/password login via SDK
- All DB tables, user profiles, sessions

## Changes

### 1. New welcome message at `/start`

**File: `src/bot.ts`**

Replace the `startOnboarding` function (lines 811–819) with a simple inline handler. Also replace the dispatcher at line 707 that calls `startOnboarding` for new/pending/manual users.

```typescript
// In sendStartMenu (around line 707):
if (!user || user.approval_status === 'pending' || user.approval_status === 'manual') {
    setOnboardingState(ctx.from!.id, 'awaiting_user_id');
    await ctx.reply(
        'Welcome to 10x Special Bot 💜\n\n' +
        'Send your IQ Option User ID to get started.\n\n' +
        'Need an account? Tap below 👇',
        {
            reply_markup: {
                inline_keyboard: [[
                    { text: '🆕 Create Account', url: AFFILIATE_LINK }
                ]]
            }
        }
    );
    return;
}
```

Delete the entire `startOnboarding` function (lines 811–819) — it's no longer called.

### 2. Remove onboarding callbacks

**File: `src/bot.ts`**

Replace the full handlers for these 5 callbacks with simple stubs that redirect to `/start`:

- `onboard:new` (line 1168)
- `onboard:experienced` (line 1185)
- `onboard:watched_video` (line 1202)
- `onboard:have_account` (line 1219)
- `onboard:need_account` (line 1236)

Each becomes:

```typescript
bot.action('onboard:new', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    await sendStartMenu(ctx);
});
```

(All 5 use the same stub — just redirect to start menu which shows the simple welcome for unapproved users.)

Also remove from the import line (line 116):
```typescript
// Remove these from the import:
startNewOnboarding, handleNewTrader, handleWatchedVideo,
handleExperiencedTrader, handleHaveAccount, handleNeedAccount,
```

Keep the existing stubs for `onboard:yes`, `onboard:no`, `onboard:autocreate` — they already redirect.

### 3. Remove re-engagement loop

**File: `src/bot.ts`** — Delete the entire re-engagement loop block (lines 4739–4868).

This is the ~130-line block starting with:
```
// ─── Re-engagement loop (1h cadence, 3 segments) ──────────────────────────────
```

And ending with the catch block around line 4868. Delete all of it.

Also remove the import of `getReengageTemplateKey` from the imports at the top (line 119):
```typescript
// Remove:
getReengageTemplateKey
```

And remove the call to `getReengageTemplateKey` in the template button renderer (search for it).

### 4. Remove exported onboarding functions

**File: `src/onboarding.ts`**

Delete these exported functions:
- `startNewOnboarding` (lines 79–113)
- `handleNewTrader` (lines 116–121)
- `handleWatchedVideo` (lines 124–130)
- `handleExperiencedTrader` (lines 133–139)
- `handleHaveAccount` (lines 142–145)
- `handleNeedAccount` (lines 148–151)
- `resumeOnboarding` (lines 268–324)
- `sendNewOnboardingViaTelegram` (lines 326–374)
- `getReengageTemplateKey` (lines 260–262)
- `REENGAGE_MAP` constant (lines 251–258)

Keep:
- `sendTemplate` (helper, still used by connected flow handlers)
- `handleUserIdInput` (lines 154–169)
- `handleUserIdVerified` (lines 172–177)
- `handleUserIdFailed` (lines 180–184)
- `handleEmailCollected` (lines 188–193)
- `handleConnected` (lines 196–209)
- `checkFundingSequence` (lines 222–247)

Also remove the `new_account_created` text handler that was recently added in bot.ts (around line 4219) — this state no longer exists since `handleNeedAccount` is removed.

### 5. Simplify channel join

**File: `src/channel.ts`**

Remove the `sendOnboarding` function call and `startWelcomeFollowUp` function. Replace with inline welcome message.

```typescript
// In the chat_join_request handler, replace line 46:
// await sendOnboarding(ctx.telegram, userId);
// With:
const botUsername = process.env.BOT_USERNAME ?? 'Shiloh10xbot';
await ctx.telegram.sendMessage(userId,
    'Welcome to 10x Special Bot 💜\n\n' +
    'Tap the button below to start and connect your IQ Option account.',
    {
        reply_markup: {
            inline_keyboard: [[
                { text: '🚀 Start Bot', url: `https://t.me/${botUsername}?start` }
            ]]
        }
    }
);
```

Remove the `startWelcomeFollowUp` function entirely (lines 62–108). Also remove the `getRecentlyApprovedUsers` import if it's no longer used.

Remove the import of `sendNewOnboardingViaTelegram` from onboarding.js.

### 6. Clean up DB startup

**File: `src/db.ts`**

Remove the `seedReengageVariants` function entirely. Also remove the call to `seedReengageVariants()` at startup. Remove the `migrateTemplates()` call since templates are already migrated from the previous deploy.

These lines at the bottom of bot.ts:
```typescript
seedTemplates();
seedReengageVariants();  // DELETE
migrateTemplates();      // DELETE
```

Also remove the corresponding function definitions from db.ts if they exist there.

### 7. Clean up template seed SQL

**File: `db/templates-seed.sql`**

Remove these INSERT statements:
- All `reengage_*` templates (24 variants A/B/C for 8 states)
- `entry_welcome_1`, `entry_welcome_2`, `entry_branch_question` (3 onboarding entry templates)

Keep: `verify_fail_1`, `verify_fail_2`, `verify_success`, `awaiting_password`, `connected_success`, `experienced_need_new` (with Create Account button), and all non-onboarding templates.

## File size impact

- bot.ts: ~ -150 lines (callbacks, re-engagement loop, startOnboarding, imports)
- onboarding.ts: ~ -200 lines (all branching/engagement functions)
- channel.ts: ~ -60 lines (follow-up loop, imported function)
- db.ts: ~ -30 lines (seedReengageVariants, migrateTemplates)
- templates-seed.sql: ~ -30 lines (27 templates removed)
- **Net: ~ -470 lines**

## Testing

1. User sends /start → sees "Send your User ID" + Create Account button
2. User sends numeric User ID → verify → email → password → connected
3. User taps Create Account → creates account → comes back → sends User ID → connected
4. User taps old cached callback from any old message → redirects to /start
5. User joins channel → gets simple welcome with Start Bot button
6. Connected user sends a message → LLM brain handles it (no change)
7. No more re-engagement messages, no more hourly follow-ups, no more stuck-user loops
