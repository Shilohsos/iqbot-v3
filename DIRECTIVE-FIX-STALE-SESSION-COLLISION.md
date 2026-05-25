# DIRECTIVE: Fix Stale Session Collision — Upgrade vs Connect

## Problem
When a user enters the upgrade flow (clicks "⚡ Upgrade to PRO"), their chat ID stays in `upgradeSessions`. If they later type `/connect` and enter their email, the text handler checks `upgradeSessions` FIRST (line 3335) before `connectSessions` (line 3495). The email gets treated as an upgrade token → "Invalid token."

## Root Cause
The text handler checks sessions in this order:
1. `upgradeSessions` (line 3335) ← catches first
2. `connectSessions` (line 3495) ← never reached

And `/connect` doesn't clear `upgradeSessions`.

## Fix
In `src/bot.ts`, add stale session cleanup to `/connect` handler (line 2775):

### Current:
```ts
bot.command('connect', async ctx => {
    if (ctx.from!.id === getAdminId()) {
        connectSessions.set(ctx.chat.id, { step: 'admin_email' });
        ...
    }
    connectSessions.set(ctx.chat.id, { step: 'email' });
    ...
```

### New:
```ts
bot.command('connect', async ctx => {
    upgradeSessions.delete(ctx.chat.id);  // Clear stale upgrade session
    if (ctx.from!.id === getAdminId()) {
        connectSessions.set(ctx.chat.id, { step: 'admin_email' });
        ...
    }
    connectSessions.set(ctx.chat.id, { step: 'email' });
    ...
```

## Also
Do the reverse — clear `connectSessions` when entering upgrade flow (line 1320):
```ts
bot.action('ui:upgrade', async ctx => {
    connectSessions.delete(ctx.chat!.id);  // Clear stale connect session
    upgradeSessions.add(ctx.chat!.id);
    ...
```

## Better Approach (Optional)
Move the `upgradeSessions` check in the text handler to come AFTER the `connectSessions` check so connect always takes priority. This way even without clearing, connect wins.
