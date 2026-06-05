# Directive: Fix Trade Gate + LLM Brain for No-SSID Users

**IMPORTANT: Merge master first**

## Problem

The previous fix (`DIRECTIVE-SSID-TRADE-GATE.md`) only handles **expired** SSIDs (`ssid_valid === 0`). It does NOT handle users with **no SSID at all** (17 approved users in DB). These users see Trade buttons → click → "Could not connect" — same fail loop.

Additionally, the LLM brain sometimes routes no-SSID users to `start_trading` instead of `reconnect` because Rule 4 ("hasn't traded → start_trading") competes with Rule 2 ("no SSID → reconnect") and the model picks wrong.

## Changes Required

### 1. Fix `ui:trade` gate in `src/bot.ts` — catch both missing AND expired SSIDs

**Current code (lines 1593-1600):**
```typescript
    const user = getUser(ctx.from!.id);
    if (user?.ssid && user.ssid_valid === 0) {
        await ctx.reply(
            '🔌 Your IQ Option session expired. Reconnect to continue trading 👇',
            { reply_markup: { inline_keyboard: [[{ text: '🔗 Reconnect', callback_data: 'ui:connect' }]] } }
        );
        return;
    }
```

**Replacement:**
```typescript
    const user = getUser(ctx.from!.id);
    const hasValidSsid = user?.ssid && user.ssid_valid !== 0;
    if (!hasValidSsid) {
        const isExpired = !!user?.ssid;
        const msg = isExpired
            ? '🔌 Your IQ Option session expired. Reconnect to continue trading 👇'
            : '⚠️ You need to connect your IQ Option account first.\nTap Connect below to get started 👇';
        const btnText = isExpired ? '🔗 Reconnect' : '🔗 Connect Account';
        await ctx.reply(msg, { reply_markup: { inline_keyboard: [[{ text: btnText, callback_data: 'ui:connect' }]] } });
        return;
    }
```

### 2. Fix `/trade` gate in `src/bot.ts`

**Current code (around lines 1848-1855):**
Find the non-admin `/trade` handler section where the SSID check was added. Same pattern — replace with the `hasValidSsid` logic from above.

### 3. Add pre-check in `src/classifier.ts` — bypass DeepSeek for no-SSID users

Add a reliable code-level check in `getBrainFlow()` that routes to `reconnect` before calling DeepSeek. This is more reliable than relying on the LLM to follow rule ordering.

**Current `getBrainFlow()` (around line 130):**
```typescript
export async function getBrainFlow(
    userId: number,
    text: string,
    context: UserContext,
): Promise<BrainResult> {
    if (getConfig('features_paused') === '1') return { flow: 'go_home', message: '', shouldReply: false };
    if (!checkRateLimit(userId)) return { flow: 'go_home', message: '', shouldReply: false };

    return await classifyFlow(text, context);
}
```

**Replacement:**
```typescript
export async function getBrainFlow(
    userId: number,
    text: string,
    context: UserContext,
): Promise<BrainResult> {
    if (getConfig('features_paused') === '1') return { flow: 'go_home', message: '', shouldReply: false };
    if (!checkRateLimit(userId)) return { flow: 'go_home', message: '', shouldReply: false };

    // Pre-check: user has no valid SSID → always route to reconnect
    // This is more reliable than relying on LLM rule ordering
    if (!context.has_ssid || context.ssid_valid === 0) {
        return {
            flow: 'reconnect',
            message: context.has_ssid
                ? 'Your IQ Option session expired. Tap Reconnect to sign back in 👇'
                : 'You need to connect your IQ Option account. Tap Connect to get started 🟣',
            shouldReply: true,
        };
    }

    return await classifyFlow(text, context);
}
```

Also update the system prompt to remove rule 2 (no longer needed since it's handled in code), and clarify the remaining rules:

**Update the SYSTEM_PROMPT to remove the redundant rule 2:**
Find and remove or comment out:
```
2. If user has no SSID or ssid_valid=0 → reconnect
```

And update the remaining rules to be renumbered:
```
Rules:
1. If the message is a number with 7-10 digits → verify_user_id
2. If user is in an onboarding state (entry, awaiting_email, etc.) → continue_onboarding
3. If user hasn't traded (demo_trade_count=0 or null) → start_trading
4. If user asks about funding/deposit → fund_account
5. If user is angry or needs admin → help_contact
6. For anything else → go_home
```

## How It Works

| Scenario | Before | After |
|----------|--------|-------|
| No SSID, clicks "Start Trading" | Shows Trade buttons → fail | ✅ "Connect your IQ Option account" + [Connect] button |
| Expired SSID, clicks "Start Trading" | Shows reconnect (from previous fix) | ✅ Same (preserved) |
| No SSID, sends "Hello" | LLM brain sends start_trading | ✅ Pre-check routes to reconnect BEFORE DeepSeek |
| Expired SSID, sends any message | LLM brain may route wrong | ✅ Pre-check routes to reconnect BEFORE DeepSeek |
| Valid SSID, hasn't traded | LLM brain sends start_trading | ✅ Same (no change) |

## Verification

1. `npx tsc --noEmit` — must pass with zero errors
2. Find a user in DB with `ssid IS NULL AND approval_status='approved'`
3. Click "Start Trading" → must see connect prompt, not trade buttons
4. User with `ssid_valid=0` → same reconnect prompt as before
5. User with valid SSID → trade options as normal
6. Send "Hello" as no-SSID user → must see reconnect/connect message
