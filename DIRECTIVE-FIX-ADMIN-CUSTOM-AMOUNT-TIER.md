# DIRECTIVE: Admin Tier — Fix Custom Amount Timeframe Path

## Problem
Admin gets restricted to Demo-tier timeframes (only 5M) when entering a custom amount in the trade wizard.

## Root Cause
Two paths lead to timeframe selection:
1. **Preset amount** (line 1037-1039) — correctly checks `isAdmin` → gives `'MASTER'` tier ✅
2. **Custom amount** (line 3582-3585) — uses `getUser()` which returns `null` for admin → tier falls to `undefined` → defaults to Demo ❌

## Fix
In `src/bot.ts`, **line 3582-3585**, add admin check identical to the preset amount path:

### Current:
```ts
const tfWizUser = getUser(ctx.from!.id);
await ctx.reply(
    '⏱ Pick your expiry timeframe 👇\n⏱ Faster timeframes settle quicker.\n🐢 Longer timeframes ride bigger moves.',
    { reply_markup: timeframeKeyboard(tfWizUser?.tier ?? undefined) }
);
```

### New:
```ts
const isWizAdmin = ctx.from!.id === getAdminId();
const tfWizUser = isWizAdmin ? null : getUser(ctx.from!.id);
const tfWizTier = isWizAdmin ? 'MASTER' : tfWizUser?.tier ?? undefined;
await ctx.reply(
    '⏱ Pick your expiry timeframe 👇\n⏱ Faster timeframes settle quicker.\n🐢 Longer timeframes ride bigger moves.',
    { reply_markup: timeframeKeyboard(tfWizTier) }
);
```

## Also Verify
Admin should have full access at ALL points — not gated by any tier. Double-check:
- `mode:live` and `mode:demo` handlers — already fine (they don't gate by tier)
- `amount` keyboard — already fine (preset path has admin check)
- Martingale rounds — admin should get max rounds
- Any other tier-gated feature that might restrict admin
