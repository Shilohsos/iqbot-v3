# Issue 47 — Simplify onboarding: remove "Three ways to start" tier selection

**Problem:** New users see two screens on `/start`:
1. L3 — "Connect your IQ Option account" 
2. L2 — "Three ways to start" with Demo/Newbie/Pro tier selection

This is confusing and unnecessary. Every new user should just connect their account directly.

**Fix in `src/bot.ts`:**

In `startOnboarding()` (lines 428-459), remove the L2/tier section. Keep L1 welcome and L3 connect.

Replace the function with:
```typescript
async function startOnboarding(ctx: Context): Promise<void> {
    // L1 — welcome
    try { await ctx.replyWithPhoto(ASSET('L1.png')); } catch {}
    await ctx.reply(
        `I'm 10x Special Bot.\n\n` +
        `The smartest semi auto-trading bot for IQ Option OTC pairs.\n\n` +
        `I scan markets. I read signals. I place trades.\n` +
        `You sit back and watch the wins land.`
    );
    // L3 — Link Your Account
    try { await ctx.replyWithPhoto(ASSET('L3.png')); } catch {}
    await ctx.reply(
        `Connect your IQ Option account.\n\n` +
        `Free signup · 60 seconds · Linked instantly.\n` +
        `Bot trades on your account. Money stays yours.\n\n` +
        `Link your account to get started 👇`,
        { reply_markup: onboardKeyboard() }
    );
}
```

Key changes:
- Removed L2 image send (`ASSET('L2.png')`)
- Removed "Three ways to start" text and `tierKeyboard()`
- Changed connect message from "Pick what fits 👇" to "Link your account to get started 👇" (since there's no tier to pick)
- The user clicks "Link My Account" on the onboard keyboard → enters User ID → email → password

**Additional cleanup (if any of these now go unused):**
- In `src/bot.ts`: remove `tierKeyboard` from the import at line 23
- In `src/menu.ts`: `tierKeyboard()` can remain (it's used by the admin panel for manual tier assignment elsewhere, check first)
