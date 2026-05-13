# Issue 39: Smart Recovery Settings — available for all tiers + promo on loss

## Part A: Available for all users (not just Pro)

### File: src/ui/user.ts — `startKeyboard()` function

Remove the PRO-only guard. Show the settings button for everyone:

**Current:**
```typescript
if (isPro) {
    rows.push([{ text: '⚙️ Martingale Settings', callback_data: 'ui:martingale_settings' }]);
}
```

**Change to:**
```typescript
rows.push([{ text: '⚙️ Smart Recovery Settings', callback_data: 'ui:martingale_settings' }]);
```

Remove the `isPro` variable if it's no longer used elsewhere.

### File: src/bot.ts

**Change all display text references:**
- "Martingale Settings" → "Smart Recovery Settings" (in `ui:martingale_settings` handler)
- "Martingale" → "Smart Recovery" (in settings message titles)
- "Gale disabled" → "Smart Recovery disabled"
- "Disable gale" → "Disable Smart Recovery" (button text)

**Change the setting display text** — it currently says "Gale disabled" / "martingale strategy". Update to "Smart Recovery" terminology.

---

## Part B: Promo message when trade loses with Smart Recovery off

### File: src/bot.ts — `runMartingale` function

When a trade round ends in LOSS and the user has Smart Recovery disabled (`enabled: false` or `maxRounds: 1`), send a promotional message encouraging re-enabling it.

After the loss handling at line ~610, add a check:

```typescript
// After handling a LOSS round
if (result.status === 'LOSS' || result.status === 'ERROR') {
    const mgSettings = userMartingaleSettings.get(userId);
    const isRecoveryDisabled = mgSettings && !mgSettings.enabled;
    if (isRecoveryDisabled) {
        // Only send after first loss with recovery disabled
        await ctx.replyWithPhoto(ASSET('L11a.png')).catch(() => {}); // or use a relevant image
        await ctx.reply(
            `🏆 90% of trades recover and make more money using SMART RECOVERY 👾\n\n` +
            `ENABLE SMART RECOVERY 👇🔋`,
            {
                reply_markup: {
                    inline_keyboard: [[
                        { text: 'Enable Smart Recovery', callback_data: 'martingale:6' }
                    ]]
                }
            }
        );
    }
}
```

Also add a handler for a new "Enable Smart Recovery" action so users can also access it from this message:

```typescript
bot.action('enable_smart_recovery', async ctx => {
    await ctx.answerCbQuery();
    userMartingaleSettings.set(ctx.from!.id, { enabled: true, maxRounds: 6 });
    try { await ctx.editMessageText('✅ Smart Recovery enabled. Full 6-round protection active.'); } catch {}
});
```

(Note: the existing `martingale:6` action already does this — the button can just use `callback_data: 'martingale:6'`)

---

## Part C: Update the filename reference if needed

The internal function/variable names (`userMartingaleSettings`, `ui:martingale_settings`, `martingale:6`, etc.) can stay as-is in code — just change the **user-facing** text.

### Acceptance Criteria
- [ ] "⚙️ Smart Recovery Settings" button visible to ALL users (NEWBIE, PRO, DEMO)
- [ ] All user-facing text uses "Smart Recovery" not "Martingale"
- [ ] When a trade loses and Smart Recovery is off, promo message is sent
- [ ] Promo message has "Enable Smart Recovery" button → re-enables full 6-round recovery
- [ ] No functional change to how recovery works — only the messaging changes
