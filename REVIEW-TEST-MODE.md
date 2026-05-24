# Test Mode Gating — Directive for Claude

## Goal
Implement a test mode that redirects all mass sends to a single test user instead of the live audience. This prevents sending untested broadcasts, giveaway activations, promo code blasts, marathons, and notifications to 70+ users.

## Test User Config
Already stored in the `config` table:
- Key: `test_user` → Value: `6622587977` (Shara 🌺)

## Implementation

### 1. Expose test_mode + test_user in db.ts

Add two functions:

```ts
export function getTestUserId(): number | null {
    const row = db.prepare("SELECT value FROM config WHERE key = 'test_user'").get() as { value: string } | undefined;
    return row ? Number(row.value) || null : null;
}

export function setTestUser(id: number | null): void {
    if (id) {
        db.prepare("REPLACE INTO config (key, value) VALUES ('test_user', ?)").run(String(id));
    } else {
        db.prepare("DELETE FROM config WHERE key = 'test_user'").run();
    }
}
```

### 2. Gate ALL mass-send paths

**Pattern:** At the start of each function below, read `getTestUserId()`. If it returns a non-null value, replace the target audience with `[testUserId]` instead (send only to that one user). This applies even during an already-live activation.

Affected functions (all in `giveaway.ts`):

| Function | Lines | What it does |
|---|---|---|
| `activateGiveaway()` | 60-90 | Notifies all approved PRO/MASTER users about a new giveaway |
| `activatePromoCode()` | 249-276 | Notifies all approved users about a new promo code |
| `activateMarathon()` | 278-309 | Notifies all approved users about a new marathon |
| `sendMotivationalMessages()` | 222-247 | Sends motivational messages to giveaway participants |
| `processUpdateQueue()` social proof block | 398-420 | Sends "X users now participating" bursts to participants |
| `processNotificationsQueue()` | 423-445 | Sends queued notifications from DB |

Also:
| `auto-broadcast.ts:startAutoBroadcast()` | 18-82 | Sends broadcast images to inactive traders |

For `auto-broadcast.ts`, if test user is set, send only to the test user.

For `processNotificationsQueue`, if test user is set, only send notifications meant for the test user (skip all others).

### 3. How it works in practice

1. Admin activates a giveaway → `activateGiveaway()` reads `test_user` → sends only to Shara
2. Shara reviews the message
3. Master approves
4. Admin runs a command (e.g. `/admin releasegiveaway`) OR sets `test_user = ''` in config
5. Next activation goes to everyone

### 4. Admin command (nice-to-have)

Add a button in the admin panel:
- `/admin testmode on` / `/admin testmode off` — sets/clears the test user from config
- Shows current test user status when toggled

### Important notes
- The test mode should NOT silently skip sending — it should log `[test-mode] sending only to test user 6622587977` so it's obvious in PM2 logs
- The test user must receive the EXACT same message content the real users would get
- Do NOT modify the notification insertion logic (still insert into DB for all users) — only gate the actual `telegram.sendMessage()` calls
- For `processNotificationsQueue`, skip notifications not meant for the test user (don't mark them sent — leave them pending for when test mode is off)
