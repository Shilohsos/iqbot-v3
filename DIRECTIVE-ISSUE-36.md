# Issue 36: PRO users need a UI to adjust martingale settings

## Background
Issue 35 (Part E) added the backend infrastructure:
- `userMartingaleSettings` map in `src/bot.ts`
- `martingaleRounds` parameter in `runMartingale()`
- Concurrency check uses tier

But there is **no way** for a PRO user to actually change their martingale settings. The adjustable option exists in code but has no user-facing UI.

## Required
Add a **Martingale Settings** option for PRO users to configure their gale rounds.

### Design

**Option A (recommended):** Add a "⚙️ Martingale" button to the start menu for PRO users. When clicked, shows buttons to set rounds.

In the start menu keyboard (`startKeyboard` in `src/ui/user.ts`), add a conditional martingale settings button for PRO users. Or simpler: add a dedicated settings handler that shows martingale options.

**Option B (simpler):** Add a `/martingale` command that accepts a number.

### Implementation

**In `src/ui/user.ts` — startKeyboard:**
```typescript
export function startKeyboard(tier?: string): IKMarkup {
    const isPro = (tier ?? '').toUpperCase() === 'PRO';
    // ... existing buttons ...
    if (isPro) {
        rows.push([{ text: '⚙️ Martingale Settings', callback_data: 'ui:martingale_settings' }]);
    }
    // ... back/other buttons ...
}
```

**In `src/bot.ts` — new handlers:**

```typescript
// Show martingale settings
bot.action('ui:martingale_settings', async ctx => {
    await ctx.answerCbQuery();
    const userId = ctx.from!.id;
    const settings = userMartingaleSettings.get(userId) ?? { enabled: true, maxRounds: 6 };
    await ctx.reply(
        `⚙️ *Martingale Settings*\n\n` +
        `Current: ${settings.enabled ? 'ON' : 'OFF'} · ${settings.maxRounds} rounds max\n\n` +
        `Choose your preferred martingale strategy:`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '🔁 Full (6 rounds)', callback_data: 'martingale:6' },
                        { text: '🔁 Medium (3 rounds)', callback_data: 'martingale:3' },
                    ],
                    [
                        { text: '⛔ Disable gale', callback_data: 'martingale:off' },
                    ],
                    [{ text: '🔙 Back', callback_data: 'ui:start' }],
                ]
            }
        }
    );
});

// Apply martingale setting
bot.action(/^martingale:(\d+|off)$/, async ctx => {
    await ctx.answerCbQuery();
    const userId = ctx.from!.id;
    const val = ctx.match[1];
    if (val === 'off') {
        userMartingaleSettings.set(userId, { enabled: false, maxRounds: 1 });
        await ctx.editMessageText('⛔ Gale disabled. Trades will run a single round with no recovery.');
    } else {
        const rounds = parseInt(val, 10);
        userMartingaleSettings.set(userId, { enabled: true, maxRounds: rounds });
        await ctx.editMessageText(`✅ Martingale set to ${rounds} rounds.`);
    }
});
```

**Also check the `pair:` handler** — currently it only reads `userMartingaleSettings.get(ctx.from!.id)?.maxRounds` but does NOT check `enabled`. If `enabled` is false, martingale should run 1 round (single trade, no recovery):

```typescript
const settings = userMartingaleSettings.get(ctx.from!.id);
let martingaleRounds: number | undefined;
if (settings) {
    martingaleRounds = settings.enabled ? settings.maxRounds : 1;
}
```

### Start menu
The start keyboard (`sendStartMenu` in bot.ts) already knows the user's tier at line 335. Pass it to the keyboard function so PRO users see the martingale settings button.

### Acceptance Criteria
- [ ] PRO users see "⚙️ Martingale Settings" button in their start menu
- [ ] Clicking it shows current settings (ON/OFF, rounds count)
- [ ] User can choose: Full (6), Medium (3), or Disable gale
- [ ] Setting takes effect on the next trade
- [ ] NEWBIE users do NOT see this button
- [ ] Setting persists in-memory for the session (no DB persistence needed for now)
