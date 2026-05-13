# Issue 41 — Activations: Show @username for pending manual approval users

**Problem:** The Activations admin screen shows `ID: 86737XXXXX` for pending users who need manual approval. The admin cannot click to message them directly.

The username IS being saved by the middleware (`bot.use()` at line 48–53 calls `saveUsername()`). The issue is that for users who have no Telegram @username set, the fallback shows a masked numeric ID which isn't actionable.

**Files to modify:**

### 1. `src/ui/admin.ts` — Button labels (line 151)

Current:
```typescript
const label = u.username ?? String(u.telegram_id);
```

Change to show last 4 digits of ID when no username:
```typescript
const label = u.username ?? `ID: ${String(u.telegram_id).slice(-4)}`;
```

### 2. `src/bot.ts` — Activations text message (line 1201)

Current:
```typescript
const name = u.username ? `@${u.username}` : `ID: ${maskUserId(u.telegram_id)}`;
```

Change to use a clickable mention link when no username:
```typescript
const name = u.username ? `@${u.username}` : `[User ${String(u.telegram_id).slice(-4)}](tg://user?id=${u.telegram_id})`;
```

This makes the name a clickable link that opens the chat with that user, even if they don't have a @username set.

### 3. `src/bot.ts` — Admin notification (lines 1931 and 1944)

These were already updated to show `@username` where available. No change needed unless the user has no username — the `[User](tg://user?id=...)` fallback there already handles it.
