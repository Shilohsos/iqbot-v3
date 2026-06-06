# Directive: Add /confirmed Command for Manually Verified Users

**Authority:** Master Ferdinand Shiloh Hart  
**From:** Wizard  
**Date:** 2026-06-06

IMPORTANT: Merge master first before implementing.

---

## Feature

`/confirmed` command — a streamlined connect flow for users who've been manually verified by admin. Skips onboarding gates, collects User ID first (for admin records), then proceeds to email/password → IQ Option connection.

## Flow

1. User sends `/confirmed`
2. Bot: "🟢 You've been pre-approved. Let's get you connected.\n\nStep 1: Send your IQ Option User ID (the number under your profile name)."
3. User sends User ID (e.g. `183456789`)
4. Bot stores `iq_user_id` in users table. Reply: "✅ User ID saved.\n\nStep 2: Enter your IQ Option email address."
5. User sends email
6. Bot stores email. Reply: "Step 3: Enter your IQ Option password."
7. User sends password
8. Bot calls `loginAndCaptureSsid()` → connects account → shows balance

## Implementation

**File: `src/bot.ts`**

### 1. Register command handler (alongside other start/connect handlers)

```typescript
bot.command('confirmed', async ctx => {
    const chatId = ctx.chat!.id;
    // Ensure user exists in DB (create if not)
    const existing = getUser(ctx.from!.id);
    if (!existing) {
        saveUser({ telegram_id: ctx.from!.id, ssid: '' });
    }
    // Set session state to 'confirmed_user_id'
    connectSessions.set(chatId, { step: 'confirmed_user_id' });
    await ctx.reply(
        '🟢 *You\'ve been pre-approved*\n\n' +
        'Step 1: Send your IQ Option User ID.\n' +
        '_(The number under your profile name in the IQ Option app)_'
    );
});
```

### 2. Add step handling in the text message handler (alongside existing connect steps)

In the main text handler where `connectSessions` steps are processed (around line 4508), add before the existing `email` and `password` steps:

```typescript
// /confirmed flow — collect User ID first
if (conn.step === 'confirmed_user_id') {
    const userId = text.trim();
    if (!/^\d{6,12}$/.test(userId)) {
        await ctx.reply('❌ Please send a valid IQ Option User ID (numbers only).');
        return;
    }
    conn.iqUserId = userId;
    conn.step = 'confirmed_email';
    saveUserIqUserId(ctx.from!.id, userId);
    connectSessions.set(chatId, conn);
    await ctx.reply('✅ User ID saved.\n\nStep 2: Enter your IQ Option email address.');
    return;
}

if (conn.step === 'confirmed_email') {
    conn.email = text.trim();
    conn.step = 'confirmed_password';
    connectSessions.set(chatId, conn);
    await ctx.reply('Step 3: Enter your IQ Option password.');
    return;
}

if (conn.step === 'confirmed_password') {
    const email = conn.email!;
    const iqUserId = conn.iqUserId;
    connectSessions.delete(chatId);
    await ctx.reply('🔐 Logging in...');
    try {
        const { ssid, sdk } = await withTimeout(loginAndCaptureSsid(email, text), 15_000, 'login');
        saveUser({ telegram_id: ctx.from!.id, ssid });
        saveUserCred(ctx.from!.id, Buffer.from(`${email}:${text}`).toString('base64'), email);
        setSsidValid(ctx.from!.id, 1);
        await clearReconnectPromptMessage(ctx.from!.id);
        let msg = '✅ *Connected!*\\n\\n';
        try {
            const all = (await withTimeout(sdk.balances(), 5_000, 'balance')).getBalances();
            const demo = all.find(b => b.type === BalanceType.Demo);
            const real = all.find(b => b.type === BalanceType.Real);
            if (real?.currency) saveUserCurrency(ctx.from!.id, real.currency);
            else if (demo?.currency) saveUserCurrency(ctx.from!.id, demo.currency);
            if (demo) msg += `🎮 Practice: ${fmtBalance(demo)}\\n`;
            if (real) msg += `💎 Live: ${fmtBalance(real)}\\n`;
        } finally {
            sdk.shutdown().catch(() => {});
        }
        await ctx.reply(msg, { parse_mode: 'Markdown' });
    } catch (err: unknown) {
        const isTimeout = err instanceof Error && err.message.startsWith('SDK timeout');
        await ctx.reply(isTimeout
            ? '⚠️ IQ Option is taking too long. Please try again.'
            : `❌ Connection failed: ${err instanceof Error ? err.message : 'Unknown error'}`
        );
    }
    return;
}
```

### 3. Add `saveUserIqUserId()` to `src/db.ts`

```typescript
export function saveUserIqUserId(telegramId: number, iqUserId: string): void {
    db.prepare('UPDATE users SET iq_user_id = ? WHERE telegram_id = ?').run(iqUserId, telegramId);
}
```

### 4. Extend the connect session type

Ensure `ConnectSession` interface includes optional `iqUserId` field:

```typescript
interface ConnectSession {
    step: string;
    email?: string;
    iqUserId?: string;
}
```

## Verification

1. User sends `/confirmed` → bot asks for User ID
2. User sends `183456789` → bot saves it, asks for email
3. User sends email → bot asks for password
4. User sends password → bot logs in and shows balance
5. User is connected with `iq_user_id` stored in DB for admin lookup
