# Issue 45 — /refresh should hard-reset: log off, revoke access, require full re-login

**Problem:** `/refresh` currently just clears session maps and shows the onboarding flow. But the user's SSID and approved status remain in the DB — they can still access the trading menu without reconnecting. It needs to be a hard gate.

**Fix in `src/bot.ts`:**

Replace the current `/refresh` handler with one that:

1. **Clears the user's SSID** in the DB — logs them off IQ Option
2. **Deletes the user or sets approval_status to 'pending'** — revokes feature access
3. **Clears all session maps** (onboard, wizard, connect, upgrade)
4. **Shows the onboarding flow** from the beginning

New handler:
```typescript
bot.command('refresh', async ctx => {
    const chatId = ctx.chat!.id;
    const telegramId = ctx.from!.id;

    // Clear all in-memory sessions
    onboardSessions.delete(chatId);
    wizardSessions.delete(chatId);
    connectSessions.delete(chatId);
    upgradeSessionsMap.delete(chatId);
    adminSessions.delete(chatId);

    // Hard reset: remove SSID and revoke approval so user must reconnect
    db.prepare('UPDATE users SET ssid = NULL, approval_status = \'pending\', last_used = datetime(\'now\') WHERE telegram_id = ?').run(telegramId);

    await ctx.reply('🔄 Session reset. Re-connect your account to continue.');
    await startOnboarding(ctx);
});
```

**Also needed in `src/db.ts`:**

Add a function:
```typescript
export function resetUserSession(telegramId: number): void {
    db.prepare(`UPDATE users SET ssid = NULL, approval_status = 'pending', last_used = datetime('now') WHERE telegram_id = ?`).run(telegramId);
}
```

Then in the handler use `resetUserSession(telegramId)` instead of raw `db.prepare`.

**Why this works:** `sendStartMenu()` at line 362 checks:
```typescript
if (!user || user.approval_status === 'pending') { await startOnboarding(ctx); return; }
```

Setting `approval_status` to `'pending'` means the next time the user sends any command (including `/start`), they'll be routed back to onboarding. No SSID means they can't skip to trading.
