# Directive: Fix `@username` Literal Text in Funding Cycle & verify_fail_3

**IMPORTANT: Merge master first** — this branch must include latest master changes.

## Problem

`resolveUsername()` exists in `pidgin.ts` and works correctly in `onboarding.ts`'s `sendTemplate()`, but two code paths in `bot.ts` bypass it entirely, sending literal `@username` text to users:

1. **verify_fail_3 handler** (bot.ts ~line 4651): has `ctx.from?.first_name` available but sends `vf3.message` raw
2. **fireFundingCycle** (bot.ts ~line 5026): sends funding templates via `bot.telegram.sendMessage/Photo/Video` without username replacement — only has `telegram_id`, no `ctx`

## Fix Requirements

### Fix 1: verify_fail_3

In the handler for `verify_fail_3` template sending (around bot.ts line 4651-4656):

```typescript
// BEFORE
await ctx.reply(vf3.message || 'Having trouble connecting?...', markup3);

// AFTER
import { resolveUsername } from './pidgin.js';
// ... 
const resolvedMsg = resolveUsername(vf3.message || 'Having trouble connecting?...', ctx.from?.first_name ?? ctx.from?.username ?? 'there');
await ctx.reply(resolvedMsg, markup3);
```

### Fix 2: fireFundingCycle — resolve @username

In `fireFundingCycle()` (around bot.ts line 5021-5044), the template message is constructed as:

```typescript
const msg = (template.message ?? '').replace(/10xfirst|10xsecond/g, promo);
```

This needs `@username` resolution too. Since this function has `bot: Telegraf` and `telegram_id: number` (no `ctx`), you need to resolve the name via Telegram API:

```
bot.telegram.getChat(telegram_id) → chat.first_name
```

Apply `resolveUsername()` to the template message after promo code substitution. Cache the result to avoid excessive API calls (e.g., a Map with TTL).

Example approach:

```typescript
const nameCache = new Map<number, { name: string; expires: number }>();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

async function resolveUsernameForTelegramId(bot: Telegraf, telegramId: number): Promise<string> {
    const cached = nameCache.get(telegramId);
    if (cached && cached.expires > Date.now()) return cached.name;
    try {
        const chat = await bot.telegram.getChat(telegramId);
        const name = chat.first_name ?? 'there';
        nameCache.set(telegramId, { name, expires: Date.now() + CACHE_TTL });
        return name;
    } catch {
        return 'there';
    }
}
```

Then before sending:
```typescript
const name = await resolveUsernameForTelegramId(bot, telegram_id);
const msg = resolveUsername(template.message ?? '', name)
    .replace(/10xfirst|10xsecond/g, promo);
```

### Files to modify
- `bot.ts` — verify_fail_3 handler and fireFundingCycle function
- Import `resolveUsername` from `./pidgin.js` (already imported at line 118 but never used — verify it's imported)

## Verification
1. Check PM2 logs for any errors after restart
2. Verify `@username` is replaced with actual name in both funding cycle messages and verify_fail_3
3. Confirm no rate-limit issues from `getChat()` calls (testing only)
