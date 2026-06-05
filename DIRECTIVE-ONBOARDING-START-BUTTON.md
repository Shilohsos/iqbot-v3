# Directive: Add /start URL Button to Onboarding Branch Question

## IMPORTANT: Merge master first
```
git checkout master && git pull origin master
git checkout -b claude/onboarding-start-button-WrG8I
```

---

**Problem:** Channel users click "I'm new" / "I've traded before" buttons. The handler updates their state but can't send the next message (403: privacy). No feedback reaches the user.

**Fix:** Add a "🚀 Start Bot" URL button as a third row on the branch question message. When the channel user taps it, it opens the bot DM and sends `/start`. The /start handler calls `resumeOnboarding` which re-sends the branch question — this time the callback buttons work because the user has messaged the bot first.

The 403 error from the callback buttons is silently caught (state already saved). No popup needed.

---

## Change 1: Update `sendNewOnboardingViaTelegram` (channel onboarding)

**File:** `src/onboarding.ts`, lines 368-373

**Current:**
```typescript
    await telegram.sendMessage(userId, branchMsg, {
        reply_markup: makeKeyboard([[
            { text: "I'm new to trading",   callback_data: 'onboard:new' },
            { text: 'I have traded before', callback_data: 'onboard:experienced' },
        ]]),
    });
```

**New:**
```typescript
    await telegram.sendMessage(userId, branchMsg, {
        reply_markup: makeKeyboard([
            [
                { text: "I'm new to trading",   callback_data: 'onboard:new' },
                { text: 'I have traded before', callback_data: 'onboard:experienced' },
            ],
            [
                { text: '🚀 Start Bot', url: `https://t.me/${process.env.BOT_USERNAME ?? 'Shiloh10xbot'}?start=onboard` },
            ],
        ]),
    });
```

---

## Change 2: Update `startNewOnboarding` (/start onboarding)

**File:** `src/onboarding.ts`, lines 107-112

**Current:**
```typescript
    await ctx.reply(branchMsg, {
        reply_markup: makeKeyboard([[
            { text: "I'm new to trading",    callback_data: 'onboard:new' },
            { text: 'I have traded before',  callback_data: 'onboard:experienced' },
        ]]),
    });
```

**New:**
```typescript
    const startLink = `https://t.me/${process.env.BOT_USERNAME ?? 'Shiloh10xbot'}?start=onboard`;
    await ctx.reply(branchMsg, {
        reply_markup: makeKeyboard([
            [
                { text: "I'm new to trading",    callback_data: 'onboard:new' },
                { text: 'I have traded before',  callback_data: 'onboard:experienced' },
            ],
            [
                { text: '🚀 Start Bot', url: startLink },
            ],
        ]),
    });
```

---

## Change 3: Update `resumeOnboarding` (state `entry_branch_sent`)

**File:** `src/onboarding.ts`, lines 283-288

**Current:**
```typescript
    if (state === 'entry_branch_sent') {
        await sendTemplate(ctx, 'entry_branch_question', makeKeyboard([[
            { text: "I'm new to trading",   callback_data: 'onboard:new' },
            { text: 'I have traded before', callback_data: 'onboard:experienced' },
        ]]));
        return;
    }
```

**New:**
```typescript
    if (state === 'entry_branch_sent') {
        const startLink = `https://t.me/${process.env.BOT_USERNAME ?? 'Shiloh10xbot'}?start=onboard`;
        await sendTemplate(ctx, 'entry_branch_question', makeKeyboard([
            [
                { text: "I'm new to trading",   callback_data: 'onboard:new' },
                { text: 'I have traded before', callback_data: 'onboard:experienced' },
            ],
            [
                { text: '🚀 Start Bot', url: startLink },
            ],
        ]));
        return;
    }
```

---

## Change 4: Handle the /start parameter in bot.ts

**File:** `src/bot.ts`, the `/start` command handler (around line 1156)

The deep link `?start=onboard` passes `onboard` as a parameter to /start. In Telegraf, this is available as `ctx.payload` when the bot receives `/start onboard`.

**Current `/start` handler:**
```typescript
bot.command('start', sendStartMenu);
```

**New:**
```typescript
bot.command('start', async ctx => {
    const payload = ctx.payload?.trim();
    if (payload === 'onboard') {
        // Deep link from the /start button — route directly to onboarding
        const telegramId = ctx.from!.id;
        const user = getUser(telegramId);
        if (!user || user.approval_status === 'pending') {
            await startOnboarding(ctx);
        } else {
            await sendStartMenu(ctx);
        }
    } else {
        await sendStartMenu(ctx);
    }
});
```

---

## Change 5: Add BOT_USERNAME to .env (or use fallback)

If `BOT_USERNAME` is not in the `.env`, the code falls back to `Shiloh10xbot`. Optionally add it:
```
BOT_USERNAME=Shiloh10xbot
```

---

## How the full flow works

For a channel user:

1. User joins channel → bot sends onboarding (welcome images + branch question)
2. Branch question has 3 rows: `[I'm new] [I've traded]` + `[🚀 Start Bot]`
3. User taps "I'm new" → handler runs, state saved to `new_user_watch_video`, try to reply → **403 silently caught**
4. User sees nothing happen from the callback buttons
5. User taps "🚀 Start Bot" → Telegram opens bot DM, sends `/start onboard`
6. Bot receives `/start onboard` → calls `startOnboarding` → `resumeOnboarding`
7. `resumeOnboarding` sees state `entry_branch_sent` (user tapped button but hasn't been to the video step yet...)

Wait — actually, there's a subtlety. When the user taps "I'm new" at step 3, the handler saves the state as `new_user_watch_video`. So when they /start at step 6, `resumeOnboarding` would show the video template, NOT the branch question.

But the user's intent is: "when they click the button then the next flow will pop up for them to select if they're new to trading or not" — they want the branch question again.

So we have two options:
A. When the callback button is tapped and fails with 403, DON'T update the state. Keep it at `entry_branch_sent`. Then /start → resumeOnboarding shows the branch question again.
B. Update the state as normal, and when the user /starts, resumeOnboarding shows the video (the correct next step after choosing "I'm new").

Option B is actually the CORRECT flow — the user chose "I'm new", so the next step should be the video. The /start button just gets them past the 403 block.

Let me re-read the user's message again: "instead why not put a /start button, when they click the button then the next flow will pop up for them to select if they're new to trading or not"

They want the branch question to appear after tapping /start. This means the state should remain at `entry_branch_sent`.

So the approach should be: in the 403 catch, DON'T call `handleNewTrader` which would update the state. Instead, just silently catch the error (state stays at `entry_branch_sent`), and the /start button triggers resumeOnboarding which shows the branch question again.

But wait, the handler currently calls `handleNewTrader` FIRST (which updates the state), then catches the 403 from `sendTemplate`. So the state IS updated before the catch.

I need to change the approach: in the 403 catch, REVERT the state back to `entry_branch_sent`.

OR: don't call handleNewTrader/handleExperiencedTrader at all in the callback handler. Instead, just show the /start button alert. But the user doesn't want the alert — they want the /start button.

Hmm, let me think about this differently. The user's idea is cleanest if:

1. The callback buttons ("I'm new" / "I've traded") simply don't work for channel users (403 is caught silently)
2. The /start button is the ONLY way to proceed for channel users
3. Tapping /start shows the branch question again
4. User taps "I'm new" — this time it works because they've messaged the bot

For this to work, the callback handlers (`onboard:new` / `onboard:experienced`) should NOT update the state when they catch a 403. They should silently catch and leave the state as `entry_branch_sent`.

Actually, the simplest approach: just don't try to update state in the try block if the reply fails. Use this approach:

```typescript
bot.action('onboard:new', async ctx => {
    if (!isValidCallbackQuery(ctx)) { ... return; }
    await ctx.answerCbQuery();
    const telegramId = ctx.from!.id;
    touchOnboardingActivity(telegramId);
    try {
        await handleNewTrader(ctx, telegramId);
    } catch {
        // 403 silently caught — state NOT updated
        // User should tap the /start button instead
    }
});
```

But this means `setOnboardingState` inside `handleNewTrader` ran before the 403 error (it's a DB write before the API call). So the state IS already updated.

To fix this: I need to either:
1. NOT call handleNewTrader at all if we think it might fail
2. OR revert the state on failure

Actually, the most practical approach:
1. In the 403 catch, revert the state back: `setOnboardingState(telegramId, 'entry_branch_sent')`
2. The user taps /start → resumeOnboarding → shows branch question again
3. User taps "I'm new" → this time it works

Let me update the directive.<｜end▁of▁thinking｜>Actually, there's a subtlety — when the handler catches 403, the state has already been updated to `new_user_watch_video`. For the /start → branch-question flow to work, I need to revert the state on 403. Let me adjust the directive.

<｜｜DSML｜｜tool_calls>
<｜｜DSML｜｜invoke name="write_file">
<｜｜DSML｜｜parameter name="content" string="true"># Directive: /start Deep Link Button for Channel Onboarding

## IMPORTANT: Merge master first
```
git checkout master && git pull origin master
git checkout -b claude/onboarding-start-button-WrG8I
```

---

**Problem:** Channel users tap "I'm new" / "I've traded before" buttons. Handler runs, saves state, tries `ctx.reply()` → **403: privacy block**. No feedback reaches the user.

**Fix:** 
1. Add a "🚀 Start Bot" URL button as a 3rd row on the branch question message
2. When tapped, it deep links to the bot and sends `/start onboard`
3. 403 errors from callback buttons silently revert the state + catch — no popup
4. /start → `resumeOnboarding` shows the branch question again
5. User taps "I'm new" — works because conversation is now initiated

---

## Change 1: Add /start URL button to branch question (3 places)

**File:** `src/onboarding.ts`

Define the start link once at the top of the file (near other constants):
```typescript
const BOT_START_LINK = `https://t.me/${process.env.BOT_USERNAME ?? 'Shiloh10xbot'}?start=onboard`;
```

### 1a. `sendNewOnboardingViaTelegram` (line ~368)

```typescript
    await telegram.sendMessage(userId, branchMsg, {
        reply_markup: makeKeyboard([
            [
                { text: "I'm new to trading",   callback_data: 'onboard:new' },
                { text: 'I have traded before', callback_data: 'onboard:experienced' },
            ],
            [
                { text: '🚀 Start Bot', url: BOT_START_LINK },
            ],
        ]),
    });
```

### 1b. `startNewOnboarding` (line ~107)

```typescript
    await ctx.reply(branchMsg, {
        reply_markup: makeKeyboard([
            [
                { text: "I'm new to trading",    callback_data: 'onboard:new' },
                { text: 'I have traded before',  callback_data: 'onboard:experienced' },
            ],
            [
                { text: '🚀 Start Bot', url: BOT_START_LINK },
            ],
        ]),
    });
```

### 1c. `resumeOnboarding` state `entry_branch_sent` (line ~283)

```typescript
    if (state === 'entry_branch_sent') {
        await sendTemplate(ctx, 'entry_branch_question', makeKeyboard([
            [
                { text: "I'm new to trading",   callback_data: 'onboard:new' },
                { text: 'I have traded before', callback_data: 'onboard:experienced' },
            ],
            [
                { text: '🚀 Start Bot', url: BOT_START_LINK },
            ],
        ]));
        return;
    }
```

---

## Change 2: Handle /start deep link in bot.ts

**File:** `src/bot.ts`, around line 1156

**Current:**
```typescript
bot.command('start', sendStartMenu);
```

**New:**
```typescript
bot.command('start', async ctx => {
    const payload = (ctx.payload ?? '').trim();
    if (payload === 'onboard') {
        // Deep link from the Start Bot button
        const telegramId = ctx.from!.id;
        const user = getUser(telegramId);
        if (!user || user.approval_status === 'pending') {
            await startOnboarding(ctx);
        } else {
            await sendStartMenu(ctx);
        }
    } else {
        await sendStartMenu(ctx);
    }
});
```

---

## Change 3: Update 403 catch — revert state on silent fail

**File:** `src/bot.ts`, around lines 1205-1250

For ALL onboarding callback handlers (`onboard:new`, `onboard:experienced`, `onboard:watched_video`, `onboard:have_account`, `onboard:need_account`):

Wrap the handler body in try/catch. On 403, revert the state to `entry_branch_sent` so /start → resumeOnboarding shows the branch question cleanly.

**Pattern for each handler:**

```typescript
bot.action('onboard:new', async ctx => {
    if (!isValidCallbackQuery(ctx)) { await ctx.answerCbQuery('⏳ Expired. Send /start again.').catch(() => {}); return; }
    await ctx.answerCbQuery();
    const telegramId = ctx.from!.id;
    touchOnboardingActivity(telegramId);
    try {
        await handleNewTrader(ctx, telegramId);
    } catch {
        // Likely 403 (privacy block for channel users)
        // State already updated by handleNewTrader — revert to branch question
        // User will tap the /start button on the branch question to proceed
        setOnboardingState(telegramId, 'entry_branch_sent');
    }
});
```

Do the same for:
- `onboard:experienced` → revert to `entry_branch_sent`
- `onboard:watched_video` → revert to `entry_branch_sent`
- `onboard:have_account` → revert to `entry_branch_sent`
- `onboard:need_account` → revert to `entry_branch_sent`

**Important:** Only revert for known-403 errors. Other errors should still bubble. However, since the previous directive already added try/catch for these handlers, simply replace the previous try/catch with this approach.

---

## How it works end-to-end

For a channel user who hasn't messaged the bot:

1. User joins channel → bot sends welcome images + branch question with 3 rows:
   ```
   [ I'm new to trading ] [ I've traded before ]
   [ 🚀 Start Bot → ]
   ```

2. User taps "I'm new" → handler runs, state updated, `ctx.reply()` fails 403 → **state reverted to `entry_branch_sent`** → nothing visible happens

3. User taps "🚀 Start Bot" → Telegram opens bot DM, sends `/start onboard`

4. Bot receives `/start onboard` → calls `startOnboarding` → `resumeOnboarding` shows branch question again

5. User taps "I'm new" → handler runs, state updated, `ctx.reply()` **works** (user has messaged the bot) → sees video template

---

## Verification

1. Build: `npx tsc --noEmit`
2. Restart: `pm2 restart iqbot-v3-bot --update-env`
3. Check the branch question message on Shara — should show 3 rows (new/experienced buttons + Start Bot link)
4. Tap the Start Bot link → should open bot and trigger /start
5. Send /start manually → should resume onboarding with branch question
