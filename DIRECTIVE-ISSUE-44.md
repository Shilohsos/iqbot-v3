# Issue 44 — Fix session persistence + add /refresh command

## Problem 1: Session step changes not persisted to DB

The onboarding flow modifies `ob.step` in-place without persisting to the DB, so the session can revert to a stale state if the cache misses.

**Fix in `src/bot.ts`:**

After line 1938 (`ob.step = 'connect_email';`), add:
```typescript
onboardSessions.set(chatId, ob);
```

After line 1981 (`ob.step = 'connect_password';`), add:
```typescript
onboardSessions.set(chatId, ob);
```

This ensures the DB is updated whenever the onboarding step advances, so the session survives cache misses and restarts.

## Problem 2: No way to recover when session is stuck

When a user's session gets into a bad state (e.g., step is wrong, session lost, any issue), they have no way to recover. They're stuck with a non-responsive bot.

**Fix:** Add a `/refresh` command that resets the user's session completely and restarts onboarding from scratch.

**In `src/bot.ts`:**

Add after the `/start` command handler (line 706):
```typescript
bot.command('refresh', async ctx => {
    const chatId = ctx.chat!.id;
    // Clear any existing session
    onboardSessions.delete(chatId);
    wizardSessions.delete(chatId);
    connectSessions.delete(chatId);
    upgradeSessions.delete(chatId);
    await startOnboarding(ctx);
});
```

This:
1. Clears all sessions for this chat (onboard, wizard, connect, upgrade)
2. Calls `startOnboarding(ctx)` which sends the welcome flow (L1, L3, L2 images + tier selection + connect prompt)

The user just types `/refresh` and gets sent back to the beginning of the onboarding flow to connect their account again.
