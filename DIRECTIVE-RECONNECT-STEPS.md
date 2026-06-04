# Update: Reconnect prompt — add step-by-step instructions

**IMPORTANT: Merge master first**

## Change

Update all 3 reconnect prompt messages to include step-by-step reconnect instructions.

**Old message (all 3 locations):**
```
🔐 Your IQ Option session expired. Reconnect to keep the bot trading for you.
[🔗 Reconnect]
```

**New message:**
```
🔐 Your session expired.

Reconnect in 3 steps:
1️⃣ Tap the 🔗 Reconnect button below
2️⃣ Enter your IQ Option email and password
3️⃣ Get back to trading instantly

[🔗 Reconnect]
```

## Locations

**File:** `src/bot.ts`

### Location 1 — Line 650 (auto-reconnect fallback)

```typescript
    await ctx.reply(
        '🔐 Your IQ Option session expired.\nReconnect to keep trading.',
        { reply_markup: { inline_keyboard: [[{ text: '🔗 Reconnect', callback_data: isAdmin ? 'admin:trade_connect' : 'ui:connect' }]] } }
    ).catch(() => {});
```

Replace with:

```typescript
    await ctx.reply(
        '🔐 Your session expired.\n\nReconnect in 3 steps:\n1\uFE0F\u20E3 Tap the 🔗 Reconnect button below\n2\uFE0F\u20E3 Enter your IQ Option email and password\n3\uFE0F\u20E3 Get back to trading instantly',
        { reply_markup: { inline_keyboard: [[{ text: '🔗 Reconnect', callback_data: isAdmin ? 'admin:trade_connect' : 'ui:connect' }]] } }
    ).catch(() => {});
```

### Location 2 — Line 3313 (admin "Prompt Expired Users" button)

```typescript
            const m = await bot.telegram.sendMessage(
                user.telegram_id,
                '🔐 Your IQ Option session expired. Reconnect to keep the bot trading for you.',
                { reply_markup: { inline_keyboard: [[{ text: '🔗 Reconnect', callback_data: 'ui:connect' }]] } }
            );
```

Replace with:

```typescript
            const m = await bot.telegram.sendMessage(
                user.telegram_id,
                '🔐 Your session expired.\n\nReconnect in 3 steps:\n1\uFE0F\u20E3 Tap the 🔗 Reconnect button below\n2\uFE0F\u20E3 Enter your IQ Option email and password\n3\uFE0F\u20E3 Get back to trading instantly',
                { reply_markup: { inline_keyboard: [[{ text: '🔗 Reconnect', callback_data: 'ui:connect' }]] } }
            );
```

### Location 3 — Line 4701 (automatic reconnect-prompt loop)

```typescript
                const sent = await bot.telegram.sendMessage(
                    user.telegram_id,
                    '🔐 Your IQ Option session expired.\nReconnect to keep the bot trading for you.',
                    { reply_markup: { inline_keyboard: [[{ text: '🔗 Reconnect', callback_data: 'ui:connect' }]] } }
                );
```

Replace with:

```typescript
                const sent = await bot.telegram.sendMessage(
                    user.telegram_id,
                    '🔐 Your session expired.\n\nReconnect in 3 steps:\n1\uFE0F\u20E3 Tap the 🔗 Reconnect button below\n2\uFE0F\u20E3 Enter your IQ Option email and password\n3\uFE0F\u20E3 Get back to trading instantly',
                    { reply_markup: { inline_keyboard: [[{ text: '🔗 Reconnect', callback_data: 'ui:connect' }]] } }
                );
```

## Verification

1. `npx tsc --noEmit` — must pass
2. Expired SSID user receives message with 3-step instructions and Reconnect button
3. Tapping Reconnect starts the email/password flow
