# Master Directive: Segment Lockdown + Menu Redesign + Brain Rework + Start Flow

---

## IMPORTANT: Merge master first before implementing

---

## Section A: Main Menu — Remove Stats, Rework Upgrade, Rework Help

### A1. Remove Stats button

**File:** `src/ui/user.ts`

Remove the Stats button from the menu layout. Change:

```typescript
const rows: Btn[][] = [
    [{ text: 'Take a trade 👾', callback_data: 'ui:trade' }],
    [
        { text: 'History 📆',  callback_data: 'ui:history' },
        { text: 'Stats 📈',    callback_data: 'ui:stats' },
    ],
```

To:

```typescript
const rows: Btn[][] = [
    [{ text: 'Take a trade 👾', callback_data: 'ui:trade' }],
    [{ text: 'History 📆',  callback_data: 'ui:history' }],
```

### A2. Rework Upgrade handler

**File:** `src/bot.ts`

Replace the `ui:upgrade` handler (~lines 1588-1611).

New handler: Shows a single popup message with:
1. 3 tiers explanation (DEMO max 10 trades/day, PRO $10+ live, MASTER $50+ live)
2. [💰 Fund Account] → fund URL
3. [🔑 Enter Token] → `ui:upgrade_token`
4. [🔙 Back] → `ui:start`

```typescript
bot.action('ui:upgrade', async ctx => {
    await ctx.answerCbQuery();
    connectSessions.delete(ctx.chat!.id);
    const fundUrl = process.env.FUNDING_URL ?? 'https://iqoption.com/pwa/payments/deposit';
    await ctx.reply(
        `💡 *Tiers & Upgrade*\n\n` +
        `🧪 *DEMO* — Practice mode. Max 10 trades\\/day\\.\n` +
        `⚡ *PRO* — Live trading \\- Fund *\\$10\\+* into IQ Option\\.\n` +
        `👑 *MASTER* — Live trading \\- Fund *\\$50\\+* into IQ Option\\.\n\n` +
        `Your tier upgrades automatically once your balance hits the threshold\\.`,
        {
            parse_mode: 'MarkdownV2',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '💰 Fund Account', url: fundUrl }],
                    [{ text: '🔑 Enter Token', callback_data: 'ui:upgrade_token' }],
                    [{ text: '🔙 Back', callback_data: 'ui:start' }],
                ],
            },
        }
    );
});
```

### A3. Rework Help handler

**File:** `src/bot.ts`

Replace the `ui:help` handler (~lines 1693-1703).

New handler: Placeholder links for videos + 5 FAQs.

```typescript
bot.action('ui:help', async ctx => {
    await ctx.answerCbQuery();
    await ctx.reply(
        `❓ *Help & FAQ*\n\n` +
        `*📹 How to trade with 10x Bot*\\\n` +
        `[Watch video](https://youtu.be/b0s1lnZgqAI?si=bGWHTnsA7qIujtMc)\n\n` +
        `*📹 How to fund & withdraw*\\\n` +
        `[Watch video](https://youtu.be/b0s1lnZgqAI?si=bGWHTnsA7qIujtMc)\n\n` +
        `*Q: What is Smart Recovery?*\\\n` +
        `If a trade loses, the bot doubles the next stake to recover the loss\\. Up to 6 rounds\\.\n\n` +
        `*Q: Demo vs Live?*\\\n` +
        `Demo uses practice balance\\. Live uses your real IQ Option balance\\.\n\n` +
        `*Q: How do I withdraw?*\\\n` +
        `All funds stay in your IQ Option account — withdraw directly from there\\.\n\n` +
        `*Q: Why is my session expired?*\\\n` +
        `IQ Option sessions expire after inactivity\\. Use /connect to reconnect\\.\n\n` +
        `*Q: How do I upgrade my tier?*\\\n` +
        `Deposit \\$10\\+ for PRO or \\$50\\+ for MASTER\\. Your tier upgrades automatically\\.`,
        { parse_mode: 'MarkdownV2', reply_markup: backKeyboard() }
    );
});
```

---

## Section B: /start Flow Enhancements

### B1. User ID fail → notify admin immediately

**File:** `src/bot.ts`

Find the User ID verification handler (search for `onboard:yes` or the handler that processes user ID text). After the User ID verification fails for the **first** time, add:

1. Send the user a message saying their User ID couldn't be verified and to contact admin
2. Send the admin a notification that a user has failed verification

Look for the handler that runs when the user sends text while in `awaiting_user_id` state (the text handler around lines 3680-3730). Where the user ID verification happens and fails, add:

```typescript
// Notify admin about verification failure
const adminId = getAdminId();
if (adminId) {
    const failCount = getUserIdFailCount(telegramId);
    bot.telegram.sendMessage(adminId,
        `⚠️ *User ID verification failed*\n\n` +
        `User: ${ctx.from!.id} (@${ctx.from!.username ?? 'no username'})\n` +
        `Attempt: ${failCount}\n` +
        `Last input: \`${lastInput}\``,
        { parse_mode: 'Markdown' }
    ).catch(() => {});
}
```

And after 3 failed attempts, send the user:

```typescript
await ctx.reply(
    '❌ *Couldn\\'t verify your User ID*\\.\n\n' +
    'Contact admin for manual verification 👇\n' +
    'They\\'ll help you get set up\\.',
    {
        parse_mode: 'MarkdownV2',
        reply_markup: { inline_keyboard: [[{ text: '👤 Contact Admin', url: ADMIN_CONTACT_LINK }]] },
    }
);
```

### B2. Show commands list after successful connect

**File:** `src/bot.ts`

In the `handleConnected` function or wherever the user gets marked as connected, after the "connected" message but before showing the main menu, add a one-time message listing available commands:

```typescript
await ctx.reply(
    `✅ *You're connected\\!*\n\n` +
    `Here are your commands:\n\n` +
    `/start — Open main menu\n` +
    `/refresh — Reset everything and start over\n` +
    `/connect — Reconnect your IQ Option account\n\n` +
    `Tap the menu button below to begin 👇`,
    { parse_mode: 'MarkdownV2', reply_markup: { inline_keyboard: [[{ text: '🏠 Menu', callback_data: 'ui:start' }]] } }
);
```

Find the right spot — this should be in `handleConnected()` in `src/onboarding.ts`, after the balance message.

### B3. Add /refresh command

**File:** `src/bot.ts`

Add a simple command handler. Near the `/start` handler:

```typescript
bot.command('refresh', async ctx => {
    const telegramId = ctx.from!.id;
    clearUserSsid(telegramId);
    setSsidValid(telegramId, 0);
    resetUser(telegramId); // clears onboarding state, resets user
    setOnboardingState(telegramId, null);
    await ctx.reply('🔄 *Reset complete*\\.\n\nUse /start to begin again\\.', { parse_mode: 'MarkdownV2' });
});
```

---

## Section C: Segment Lockdown — 3 segments, 3 flows

### C1. Segment detection function

**File:** `src/bot.ts` (or `src/db.ts`)

Add a function that returns a user's segment:

```typescript
type UserSegment = 'non_activated' | 'non_funded' | 'funded';

function getUserSegment(telegramId: number): UserSegment {
    const user = getUser(telegramId);
    if (!user) return 'non_activated';
    if (user.tier === 'PRO' || user.tier === 'MASTER') return 'funded';
    if (user.ssid_valid === 1 && user.ssid && user.ssid !== '') return 'non_funded';
    return 'non_activated';
}
```

### C2. Gate each automated flow to its segment

**Auto-broadcast** (`src/auto-broadcast.ts` — `fireBroadcast` function):
The `getBroadcastTargetIds()` function already returns funded users (those with valid SSID + PRO/MASTER tier). Verify this is correct. If it also includes non-funded users, change the query to only target funded users:

```sql
-- getBroadcastTargetIds should select users where ssid_valid=1 AND tier IN ('PRO','MASTER')
```

**Funding cycle** (`src/bot.ts` — `fireFundingCycle`):
Currently uses `getDemoUsersWithTrades()` which already excludes PRO/MASTER and requires `ssid_valid=1`. This is correct for `non_funded` segment.

Add an extra guard at the start of `fireFundingCycle`:

```typescript
// Only for non_funded segment
if (getUserSegment(telegram_id) !== 'non_funded') {
    upsertFundingCycle(telegram_id, cycle?.last_sent_at ?? null, cycle?.last_msg_id ?? null, isoNow(7 * 24 * 3_600_000)); // push far future
    continue;
}
```

**Reconnect flow** (`src/bot.ts` — `fireReconnectCycle`):
The queries like `getSsidExpiredUsers()`, `getUserIdRejectedUsers()`, etc. already target non-activated users by definition (no valid SSID, stuck in onboarding). These are correct for the `non_activated` segment.

Add an extra guard:

```typescript
// Only for non_activated segment
if (getUserSegment(telegram_id) !== 'non_activated') {
    upsertReconnectCycle(telegram_id, cycle?.last_state ?? null, cycle?.last_msg_id ?? null, isoNow(7 * 24 * 3_600_000));
    continue;
}
```

### C3. Migration between segments

Migration happens **naturally** based on user state changes. No separate migration function is needed because:

- User connects SSID → `ssid_valid = 1` AND `ssid` set → segment moves from `non_activated` to `non_funded`
- User funds → tier changes to PRO/MASTER → segment moves from `non_funded` to `funded`
- SSID expires → `ssid_valid = 0` → segment moves from `non_funded` back to `non_activated`

When a funded user's balance drops below the threshold (e.g. they withdraw everything), the `autoPromoteTier` function in the balance check (called on /start and SSID health check) will downgrade their tier back to DEMO, automatically migrating them to `non_funded`.

---

## Section D: LLM Brain Redesign

**File:** `src/classifier.ts`

### D1. Update system prompt

Replace the current system prompt to reflect:
- Works for connected AND non-connected users
- Non-activated: only prompt to link / User ID / create account
- Context-aware: checks SSID, flow state, error type
- If flow still active and message seems like a mistake → `flow_sleep` (no response)
- After 3 responses for non-activated users → `flow_done` (stop)

```typescript
const SYSTEM_PROMPT = `You are a flow router for a trading bot called "10x Bot".

A user has sent a casual message outside the button-based flow. Your job is to decide if they need help and what to do.

You receive: their message, their current state, and their connection status.

RULES:

1. CHECK if the user's current flow is still active and the message looks like a mistake (accidental text, gibberish, off-topic). If so → flow_sleep (no response needed, user is fine).

2. If the user IS connected (ssid_valid=1, has_ssid):
   - Check if their SSID is working. If expired → prompt reconnect.
   - Check if their current flow is broken (wrong state, stuck). If broken → prompt restart that flow.
   - Check if they made a client error (wrong amount, wrong pair). If so → correct them gently.
   - If all clear but they need help → route to appropriate flow.
   - Available flows: start_trading, reconnect, fund_account, go_home, help_contact, help_user_id.

3. If the user is NOT connected (no SSID, ssid_valid=0):
   - Only route to: link_account (prompt to connect IQ Option), verify_user_id (send User ID), create_account (affiliate link).
   - Count responses. After 3 responses to this user, stop responding (flow_done).

4. If the user just sent a greeting, thanks, or casual chat → flow_sleep (no response).

Respond with ONLY a JSON object:
{"flow": "flow_name", "message": "your reply", "shouldReply": true/false}

Use flow_sleep to silently ignore the message. Use flow_done to stop further responses after the non-activated limit.`;
```

### D2. Add non-activated response counter

Add to `UserContext` interface and tracking:

```typescript
export interface UserContext {
    onboarding_state: string | null;
    ssid_valid: number | null;
    has_ssid: boolean;
    demo_trade_count: number | null;
    tier: string;
    user_id_fail_count?: number;
    brain_response_count?: number;  // track for non-activated users
    is_activated: boolean;          // whether user has connected
}
```

### D3. Add counter persistence

In `db.ts` or `classifier.ts`, add a simple in-memory map (resets on restart — acceptable for rate limiting):

```typescript
const nonActivatedResponseCount = new Map<number, number>();
const MAX_NON_ACTIVATED_RESPONSES = 3;
```

In the text handler, before calling the brain:

```typescript
// Track brain responses for non-activated users
if (!isActivated) {
    const count = (nonActivatedResponseCount.get(telegramId) ?? 0) + 1;
    nonActivatedResponseCount.set(telegramId, count);
    if (count > MAX_NON_ACTIVATED_RESPONSES) return; // stop responding
}
```

### D4. Add context check before brain fires

**File:** `src/bot.ts` at the text handler (line 4333-4356).

Replace the current brain trigger with:

```typescript
// ── LLM brain — all users ─────────────────────────────────────────────────────
const user = getUser(ctx.from!.id);
const state = user?.onboarding_state;
const isSetupState = state && ['entry', 'awaiting_user_id', 'awaiting_email', 'awaiting_password', 'new_account_created'].includes(state);
const brainWiz = wizardSessions.get(chatId);
const isActivated = user?.ssid_valid === 1 && !!user?.ssid;

// Count brain responses for non-activated users
if (!isActivated) {
    const count = (nonActivatedResponseCount.get(ctx.from!.id) ?? 0) + 1;
    nonActivatedResponseCount.set(ctx.from!.id, count);
    if (count > MAX_NON_ACTIVATED_RESPONSES) return;
}

if (!brainWiz) {
    const brainCtx: UserContext = {
        onboarding_state: state ?? null,
        ssid_valid: user?.ssid_valid ?? null,
        has_ssid: !!user?.ssid,
        demo_trade_count: user ? getDemoTradeCount(user.telegram_id) : null,
        tier: user?.tier ?? 'DEMO',
        is_activated: isActivated,
    };
    const brainResult = await getBrainFlow(ctx.from!.id, text, brainCtx).catch(
        () => ({ flow: 'go_home', message: '', shouldReply: false })
    );

    if (brainResult.flow === 'flow_sleep' || brainResult.flow === 'flow_done') return;

    if (brainResult.shouldReply && brainResult.flow) {
        // Non-activated: only show link/User ID/create prompts
        if (!isActivated && !['link_account', 'verify_user_id', 'create_account'].includes(brainResult.flow)) {
            return;
        }
        const btn = FLOW_BUTTONS[brainResult.flow] ?? FLOW_BUTTONS.help_contact;
        const replyText = brainResult.message || btn.text;
        const replyMarkup = typeof btn.action === 'string'
            ? { inline_keyboard: [[{ text: btn.text, callback_data: btn.action }]] }
            : { inline_keyboard: [[{ text: btn.text, url: btn.action.url }]] };
        await ctx.reply(replyText, { reply_markup: replyMarkup });
    }
    return;
}
```

---

## Verification

1. `npx tsc --noEmit` — must pass with zero errors
2. `/start` on new user → branded intro → account choice → User ID flow
3. User ID fails → admin notified → user told to contact admin
4. Successful connect → commands list → main menu
5. Main menu: Stats gone, Upgrade shows tier explanation + fund/token, Help shows videos + 5 FAQs
6. `/refresh` → resets user, prompts /start
7. Auto-broadcast → only funded users (PRO/MASTER)
8. Funding cycle → only non_funded users (connected + DEMO)
9. Reconnect flow → only non_activated users
10. User sends text → brain triggers: connected users get full responses, non-activated users get max 3 link-only responses
