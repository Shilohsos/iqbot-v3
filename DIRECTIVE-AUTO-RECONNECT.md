# Directive: Silent SSID Auto-Reconnect

## Problem
When a user's IQ Option SSID expires, the bot clears it and forces the user to manually `/connect` again — entering email + password each time. This creates friction, especially for live traders who need the bot running.

## Solution
Store credentials silently during `/connect`, auto-reconnect on auth failure, never tell the user.

## Changes

### 1. DB: Add credential columns to `users` table

In `src/db.ts`, add migration:
```typescript
{
    const cols = (db.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map(c => c.name);
    if (!cols.includes('cred')) db.exec('ALTER TABLE users ADD COLUMN cred TEXT');
    if (!cols.includes('email')) db.exec('ALTER TABLE users ADD COLUMN email TEXT');
}
```

- `cred` — base64-encoded `email:password` (not plain text — avoids accidental exposure in logs)
- `email` — stored separately for display/reference

### 2. /connect: Save credentials, delete chat evidence

In `src/bot.ts`, modify the connect password handler (~line 3734-3740):

**After successful login**, save credentials:
```typescript
const encoded = Buffer.from(`${email}:${text}`).toString('base64');
saveUser({ telegram_id: ctx.from!.id, cred: encoded, email });
```

**Delete the password message** to hide the credential from chat history:
Already exists at line 3737: `try { await ctx.deleteMessage(); } catch {}`

Also delete the email message:
```typescript
// After saving email in step 'email' handler
try {
    const msgs = await ctx.telegram.getUpdates();
    // better: just delete using the reply chain
} catch {}
```

Actually, simplest approach: when the user sends their email, after processing, delete both the user's email message and the bot's password prompt.

### 3. Auto-reconnect on auth failure

In the `isAuthExpiredError` handler (~line 544), replace silent SSID clearing with auto-reconnect:

```typescript
// Try auto-reconnect first
const user = getUser(telegramId);
if (user?.cred) {
    try {
        const [email, password] = Buffer.from(user.cred, 'base64').toString().split(':');
        const { ssid } = await withTimeout(loginAndCaptureSsid(email, password), 10_000, 'auto_reconnect');
        saveUser({ telegram_id: telegramId, ssid });
        logger.info('auth', `auto-reconnected user ${telegramId}`);
        return; // success — no notification needed
    } catch {
        // Auto-reconnect failed — clear SSID, prompt reconnect
        logger.warn('auth', `auto-reconnect failed for ${telegramId}`);
    }
}
// Fall through to existing clear + prompt logic
clearUserSsid(telegramId);
```

### 4. Same for periodic auto-promote check

In the background balance check (~line 1454), same logic — try auto-reconnect, only clear + notify if it fails.

## Security Notes
- `cred` is base64, not plaintext — prevents casual log exposure
- Never log the credential value
- Chat messages containing email/password are deleted after processing
- User experience: they see nothing — SSID refreshes silently in the background

## Files to Modify
- `src/db.ts` — add credential columns migration
- `src/bot.ts` — /connect handler (save creds), isAuthExpiredError handler (auto-reconnect), periodic check (auto-reconnect)

## Testing
1. Connect with valid email+password → cred stored in DB
2. Wait for SSID expiry (or manually invalidate) → bot auto-reconnects silently
3. Verify chat history shows no credentials
4. Change password → auto-reconnect fails → user gets reconnect prompt (existing behavior)
