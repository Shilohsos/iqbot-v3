# Reconnect flow: Unified reconnection loop for disconnected users

---

## IMPORTANT: Merge master first

Before working, ensure you're on master with the latest merge.

---

## What this does

A background loop that checks every 60s for users in any disconnected/failed state and sends them a tailored reconnect message. Each user gets one message per hour, and each new message deletes the previous one. State is persisted in the DB so the loop survives restarts.

---

## States covered

| # | State | Detection | Message |
|---|---|---|---|
| 1 | SSID expired | `ssid_valid = 0` AND user has a stored SSID (was connected) | Session expired — 3-step reconnect |
| 2 | User ID rejected | `user_id_fail_count >= 3` AND stuck in `awaiting_user_id` | Couldn't verify User ID — retry or create account |
| 3 | Login failed | `onboarding_state = 'awaiting_password'` untouched >1h | Login didn't go through — check email/password |
| 4 | Onboarding abandoned | `onboarding_state` in setup states, untouched >6h | Didn't finish setup — 60 seconds to complete |
| 5 | Never connected | `approval_status = 'approved'` AND no SSID AND no onboarding activity | Approved but not connected — link account |

---

## Implementation

### 1. Add DB table and helpers

**File:** `src/db.ts`

Add table:

```sql
CREATE TABLE IF NOT EXISTS reconnect_cycle (
    telegram_id   INTEGER PRIMARY KEY,
    last_state    TEXT,
    last_msg_id   INTEGER,
    next_run_at   TEXT
);
```

Add helpers:

```typescript
export function getReconnectCycle(telegramId: number): { last_state: string | null; last_msg_id: number | null; next_run_at: string | null } | undefined {
    return db.prepare('SELECT last_state, last_msg_id, next_run_at FROM reconnect_cycle WHERE telegram_id = ?').get(telegramId) as any;
}

export function upsertReconnectCycle(telegramId: number, last_state: string | null, last_msg_id: number | null, next_run_at: string): void {
    db.prepare(`
        INSERT INTO reconnect_cycle (telegram_id, last_state, last_msg_id, next_run_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(telegram_id) DO UPDATE SET
            last_state  = excluded.last_state,
            last_msg_id = excluded.last_msg_id,
            next_run_at = excluded.next_run_at
    `).run(telegramId, last_state, last_msg_id, next_run_at);
}

export function getReconnectCycleDueUsers(): Array<{ telegram_id: number }> {
    return db.prepare(`SELECT telegram_id FROM reconnect_cycle WHERE next_run_at IS NOT NULL AND next_run_at <= datetime('now')`).all() as any;
}
```

Add queries for each state:

```typescript
export function getSsidExpiredUsers(): Array<{ telegram_id: number }> {
    return db.prepare(`SELECT telegram_id FROM users WHERE ssid_valid = 0 AND ssid IS NOT NULL AND ssid != '' AND approval_status = 'approved'`).all() as any;
}

export function getUserIdRejectedUsers(): Array<{ telegram_id: number }> {
    return db.prepare(`SELECT telegram_id FROM users WHERE user_id_fail_count >= 3 AND onboarding_state = 'awaiting_user_id'`).all() as any;
}

export function getLoginFailedUsers(): Array<{ telegram_id: number }> {
    return db.prepare(`SELECT telegram_id FROM users WHERE onboarding_state = 'awaiting_password' AND updated_at < datetime('now', '-1 hour')`).all() as any;
}

export function getAbandonedOnboardingUsers(): Array<{ telegram_id: number }> {
    return db.prepare(`SELECT telegram_id FROM users WHERE onboarding_state IN ('awaiting_user_id', 'awaiting_email', 'awaiting_password') AND updated_at < datetime('now', '-6 hours')`).all() as any;
}

export function getNeverConnectedUsers(): Array<{ telegram_id: number }> {
    return db.prepare(`SELECT telegram_id FROM users WHERE approval_status = 'approved' AND (ssid IS NULL OR ssid = '') AND (onboarding_state IS NULL OR onboarding_state = '') AND updated_at > datetime('now', '-30 days')`).all() as any;
}
```

### 2. Add the reconnect loop

**File:** `src/bot.ts`

Add near the bottom, after the existing reconnect-prompt loop (which should be replaced/removed). The new loop handles all 5 states:

```typescript
// ─── Unified reconnect flow (every 1h, persistent) ────────────────────────────

type ReconnectState = 'ssid_expired' | 'user_id_rejected' | 'login_failed' | 'onboarding_abandoned' | 'never_connected';

interface ReconnectMessage {
    state: ReconnectState;
    text: string;
    button: { text: string; action: string | { url: string } };
}

async function fireReconnectCycle(bot: Telegraf): Promise<void> {
    if (getConfig('features_paused') === '1') return;
    const now = Date.now();

    // Gather all users in disconnected states
    const all: Array<{ telegram_id: number; state: ReconnectState }> = [
        ...getSsidExpiredUsers().map(u => ({ telegram_id: u.telegram_id, state: 'ssid_expired' as ReconnectState })),
        ...getUserIdRejectedUsers().map(u => ({ telegram_id: u.telegram_id, state: 'user_id_rejected' as ReconnectState })),
        ...getLoginFailedUsers().map(u => ({ telegram_id: u.telegram_id, state: 'login_failed' as ReconnectState })),
        ...getAbandonedOnboardingUsers().map(u => ({ telegram_id: u.telegram_id, state: 'onboarding_abandoned' as ReconnectState })),
        ...getNeverConnectedUsers().map(u => ({ telegram_id: u.telegram_id, state: 'never_connected' as ReconnectState })),
    ];

    // Deduplicate — if a user matches multiple states, use the first (highest priority)
    const seen = new Set<number>();
    const unique = all.filter(u => {
        if (seen.has(u.telegram_id)) return false;
        seen.add(u.telegram_id);
        return true;
    });

    for (const { telegram_id, state } of unique) {
        try {
            const cycle = getReconnectCycle(telegram_id);
            if (cycle?.next_run_at && new Date(cycle.next_run_at).getTime() > now) continue;

            const msg = getReconnectMessage(telegram_id, state);
            if (!msg) continue;

            // Delete previous reconnect message
            if (cycle?.last_msg_id) {
                bot.telegram.deleteMessage(telegram_id, cycle.last_msg_id).catch(() => {});
            }

            const sent = await bot.telegram.sendMessage(telegram_id, msg.text, {
                reply_markup: { inline_keyboard: [[msg.button]] },
                parse_mode: 'Markdown',
            }).catch(() => undefined);

            if (sent) {
                upsertReconnectCycle(telegram_id, state, sent.message_id, new Date(Date.now() + 3_600_000).toISOString().replace('T', ' ').split('.')[0]);
            }
        } catch (err) {
            console.error(`[reconnect] error for ${telegram_id}:`, err instanceof Error ? err.message : err);
        }
    }
}

function getReconnectMessage(telegramId: number, state: ReconnectState): ReconnectMessage | null {
    switch (state) {
        case 'ssid_expired':
            return {
                state,
                text: `🟣 *Your session expired*\n\nNo panic. Just reconnect.\n\n1️⃣ Tap 🔗 Reconnect below\n2️⃣ Enter your email and password\n3️⃣ Back to winning 💜`,
                button: { text: '🔗 Reconnect', action: 'ui:connect' },
            };

        case 'user_id_rejected':
            return {
                state,
                text: `🟣 *We couldn't verify that User ID*\n\n✅ Make sure it's the number under your profile name in IQ Option\n✅ Copy and paste it — no spaces, no dashes\n\nTry again 👇`,
                button: { text: '📝 Send User ID', action: 'ui:start' },
            };

        case 'login_failed':
            return {
                state,
                text: `🟣 *Login didn't go through*\n\nDouble-check your IQ Option email and password.\n\n1️⃣ Tap 🔗 Connect below\n2️⃣ Enter the correct email and password\n3️⃣ We'll handle the rest`,
                button: { text: '🔗 Connect', action: 'ui:connect' },
            };

        case 'onboarding_abandoned':
            return {
                state,
                text: `🟣 *You didn't finish setting up*\n\nYour account is waiting. Takes 60 seconds.\n\n1️⃣ Tap ▶️ Continue below\n2️⃣ Pick up where you stopped`,
                button: { text: '▶️ Continue', action: 'ui:start' },
            };

        case 'never_connected':
            return {
                state,
                text: `🟣 *You're approved but not connected*\n\nLink your IQ Option account to start trading with 10x Bot 💜\n\n1️⃣ Tap 🔗 Connect below\n2️⃣ Enter your IQ Option email and password\n3️⃣ Let the bot work`,
                button: { text: '🔗 Connect', action: 'ui:connect' },
            };

        default:
            return null;
    }
}

function seedReconnectCycle(): void {
    const all: Array<{ telegram_id: number }> = [
        ...getSsidExpiredUsers(),
        ...getUserIdRejectedUsers(),
        ...getLoginFailedUsers(),
        ...getAbandonedOnboardingUsers(),
        ...getNeverConnectedUsers(),
    ];
    const seen = new Set<number>();
    for (const { telegram_id } of all) {
        if (seen.has(telegram_id)) continue;
        seen.add(telegram_id);
        if (!getReconnectCycle(telegram_id)) {
            upsertReconnectCycle(telegram_id, null, null, new Date(Date.now() + 300_000).toISOString().replace('T', ' ').split('.')[0]);
        }
    }
}

function startReconnectLoop(bot: Telegraf): void {
    const dueNow = getReconnectCycleDueUsers();
    if (dueNow.length > 0) {
        console.log(`[reconnect] startup: ${dueNow.length} users due`);
        fireReconnectCycle(bot);
    }
    setInterval(() => { fireReconnectCycle(bot); }, 60_000);
}
```

### 3. Remove old reconnect-prompt loop

Find and remove the existing reconnect-prompt loop (the block starting with `// ─── Reconnect-prompt loop (hourly tick, 6h cadence per user)` and ending at the next section). This is fully replaced by the new unified loop.

Also remove the `setReconnectPrompt` and `clearReconnectPrompt` usage in that old loop — keep `autoReconnect` and `clearReconnectPromptMessage` for the SSID health check but remove the old prompt-sending loop.

### 4. Wire up on startup

After the existing `startFundingLoop(bot)` call, add:

```typescript
seedReconnectCycle();
startReconnectLoop(bot);
```

Also ensure the detection query for `getUserIdRejectedUsers` is correct — if `user_id_fail_count` column doesn't exist yet on the users table, add it:

```sql
ALTER TABLE users ADD COLUMN user_id_fail_count INTEGER DEFAULT 0;
```

If this column already exists (check first), skip the ALTER TABLE.

---

## Priority order

If a user matches multiple states, the first match wins (SSID expired > User ID rejected > Login failed > Onboarding abandoned > Never connected). This ensures the most relevant message is shown.

---

## Behaviour summary

| Aspect | Old reconnect | New reconnect |
|---|---|---|
| States covered | SSID expired only | 5 states (expired, rejected, failed, abandoned, never connected) |
| Cadence | 6h per user | 1h per user |
| Auto-delete | Yes | Yes |
| Persist across restart | No (in-memory tracking) | Yes (DB-backed) |
| Message | Static text | Tailored to each state |
| Check interval | Every 1h | Every 60s |

---

## Verification

1. `npx tsc --noEmit` — must pass with zero errors
2. On startup, seedReconnectCycle creates entries for existing disconnected users
3. First reconnect messages fire ~5 min after startup (seeded stagger)
4. Users in each state get the correct message
5. Each subsequent message deletes the previous one
6. Bot restart preserves timing
7. If a user's state changes (e.g. from "login failed" to "connected"), they stop getting messages
