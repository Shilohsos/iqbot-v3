# DIRECTIVE: Add Support Button to Upgrade UI

## File: `src/bot.ts`

**Change:** In the `ui:upgrade` handler (around line 1008-1017), add a clickable "Contact Support" URL button so users can tap to contact the admin instead of just reading plain text.

**Current code (line 1011-1016):**
```typescript
    await ctx.reply(
        `💡 *Upgrade Your Tier*\\n\\n` +
        `Enter your upgrade token below to unlock *PRO* tier. ⚡\\n\\n` +
        `Don't have a token? Contact support to get your token.`,
        { parse_mode: 'Markdown', reply_markup: backKeyboard() }
    );
```

**Replace with:**
```typescript
    await ctx.reply(
        `💡 *Upgrade Your Tier*\\n\\n` +
        `Enter your upgrade token below to unlock *PRO* tier. ⚡\\n\\n` +
        `Don't have a token? Tap the button below to contact support.`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '👤 Contact Support', url: ADMIN_CONTACT_LINK }],
                    [{ text: '🔙 Back', callback_data: 'ui:start' }],
                ]
            },
        }
    );
```

The `ADMIN_CONTACT_LINK` constant is already imported at line 43, so no new imports needed. This gives users a single-tap button to message the admin for a token.

## Verification
- [ ] Bot restarts cleanly
- [ ] Upgrade screen shows "Contact Support" button + "Back" button
- [ ] Tapping "Contact Support" opens DM with admin
- [ ] Token entry still works the same way
