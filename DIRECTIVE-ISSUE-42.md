# Issue 42 — Persist onboarding/trade sessions to DB (survive restarts)

**Problem:** Every bot restart wipes all in-memory session state, leaving users in the middle of onboarding or trading flows with no way to continue. The bot receives their next message but has no session context, so it silently ignores it.

**Affected Maps in `src/bot.ts`:**

| Line | Map | Use |
|------|-----|-----|
| 64 | `sessionStats` | Per-session trade stats (trades/pnl count) |
| 78 | `wizardSessions` | Trade flow: mode → amount → timeframe → pair |
| 88 | `onboardSessions` | **Onboarding: user_id → email → password** |
| 92 | `connectSessions` | Standalone /connect: email → password |
| 121 | `adminSessions` | Admin flows: find users, broadcast, funnel, etc. |
| 124 | `upgradeSessions` | Token upgrade flow |
| 133 | `pendingBroadcasts` | In-flight broadcast payloads per admin chat |
| 154 | `scheduledBroadcasts` | Scheduled broadcast timers |
| 160 | `userMartingaleSettings` | Per-user martingale config (enabled, maxRounds) |

**Fix approach:**

Add a `sessions` table to the DB and a set of helper functions in `src/db.ts`:

```typescript
// New table
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    key           TEXT PRIMARY KEY,
    value         TEXT NOT NULL,
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

export function setSession(key: string, value: unknown): void {
  db.prepare(`
    INSERT INTO sessions (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).run(key, JSON.stringify(value));
}

export function getSession<T>(key: string): T | undefined {
  const row = db.prepare('SELECT value FROM sessions WHERE key = ?').get(key) as { value: string } | undefined;
  if (!row) return undefined;
  try { return JSON.parse(row.value) as T; } catch { return undefined; }
}

export function deleteSession(key: string): void {
  db.prepare('DELETE FROM sessions WHERE key = ?').run(key);
}

// Clean up stale sessions (older than 24 hours)
export function cleanStaleSessions(): void {
  db.prepare("DELETE FROM sessions WHERE updated_at < datetime('now', '-24 hours')").run();
}
```

**Key format:** `session:{type}:{chatId}` where type is one of:
- `wizard` (WizardState)
- `onboard` (OnboardState)
- `connect` (ConnectState)
- `admin` (AdminSessionState)
- `upgrade` (boolean)
- `martingale` (martingale settings)
- `stats` (session trade stats)

**In `src/bot.ts`:**

Replace every `map.set(key, val)` / `map.get(key)` / `map.delete(key)` pattern with the corresponding `setSession/getSession/deleteSession` calls. The pattern is:

- **Get:** `const val = sessionMap.get(chatId)` → `const val = getSession<Type>(`session:type:${chatId}`)`
- **Set:** `sessionMap.set(chatId, val)` → `setSession(`session:type:${chatId}`, val)`
- **Delete:** `sessionMap.delete(chatId)` → `deleteSession(`session:type:${chatId}`)`

For `upgradeSessions` (Set), it's a simpler pattern:
- **Check:** `upgradeSessions.has(chatId)` → `getSession<boolean>(`session:upgrade:${chatId}`) ?? false`
- **Add:** `upgradeSessions.add(chatId)` → `setSession(`session:upgrade:${chatId}`, true)`
- **Remove:** `upgradeSessions.delete(chatId)` → `deleteSession(`session:upgrade:${chatId}`)`

For `userMartingaleSettings`, persist as `session:martingale:{telegramId}`.

For `sessionStats`, persist as `session:stats:{telegramId}`.

**Important:** Call `cleanStaleSessions()` once at bot startup so old orphaned sessions don't accumulate.

**The Maps can remain as in-memory caches** (read from DB on miss, write to both DB and Map on update) for faster access during active flows, but the DB must be the source of truth. This way:
1. During normal operation, the Maps are used (fast, no DB reads)
2. On restart, the Maps are rebuilt from the DB on first access

Or alternatively, simpler approach: **just always read/write from DB directly**, removing the in-memory maps entirely. The DB calls are fast enough for low-frequency operations like onboarding (not a hot path like trade execution).
