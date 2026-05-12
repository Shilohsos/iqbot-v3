# Section 10 — Complete Admin Panel (10 modules)

## Overview

Replace the current minimal admin panel with a full 10-button admin menu. All admin commands are accessible only to the admin Telegram ID (`ADMIN_USER_ID`).

Admin accesses via `/start` (admin auto-detected) or `/admin` command.

---

## Admin Main Menu (10 buttons)

Layout (2 columns x 5 rows):

```
📊 Today      | 🔌 Activations
🔍 Find Users  | 🔑 Tokens
⚙️ System     | 📢 Broadcast
🏆 Top Traders | 🔻 Funnel
📋 Audits      | 🛡️ Admin
```

Each button maps to a callback: `admin:today`, `admin:activations`, etc.

---

## 1. Today — Top 20 Traders Today

Shows the top 20 users who have taken the **most trades today** (since midnight UTC).

Display format:
```
📊 *Today's Top Traders*

1. @username1 (ID: 18251****) — 15 trades
2. @username2 (ID: 93148****) — 12 trades
...
```

- Each entry shows: Telegram username + partial User ID (first 50% visible, rest masked with `X`)
- Sorted by trade count descending, limit 20
- "No trades today yet" if empty

### Data source
Need a new query: count trades per user where `created_at >= today 00:00 UTC`. Requires trades to have a `telegram_id` column (already added in Issue #19).

### New DB functions
```typescript
getTopTradersToday(limit: number): Array<{telegram_id: number; username: string; trades: number}>
```

---

## 2. Activations — User approvals & activations

Shows **all users** grouped by status. Displays both:
- Pending approvals (manual)
- Recently approved users

Format:
```
🔌 *Activations*

⏳ *Pending Manual Approval:*
@username1 (ID: 18251****)
@username2 (ID: 93148****)

✅ *Recently Approved (24h):*
@username3 (ID: 74829****)
```

Each entry shows Telegram username + partial User ID (masked).

---

## 3. Find Users — Search by ID or username

Admin types a User ID or Telegram username. Bot searches and returns matching user.

**Flow:**
1. Admin clicks "Find Users" → bot asks "Enter User ID or Telegram username to search:"
2. Admin types query → bot searches DB
3. If found: show user details + actions
4. If not found: "No user found"

**User detail display:**
```
🔍 *User Found*

Telegram: @username (ID: 16156****)
IQ User ID: 182511*** (masked)
Status: ✅ Approved
Tier: 🚀 NEWBIE
Trades: 15 (Win rate: 60%)
Last active: 2 hours ago

[Actions: Pause | Resume | Remove | Message]
```

### New DB functions
```typescript
findUserByTelegramId(id: number): UserRecord | undefined
findUserByUsername(username: string): UserRecord[]  // partial match
```

---

## 4. Tokens — Tier upgrade tokens

When a user clicks "Upgrade 💡" on their menu, they should be prompted to enter a token. The admin generates this token from the admin panel.

**Token generation:**
1. Admin clicks "Tokens" → bot shows current tokens + "Generate new token"
2. Admin clicks generate → bot asks "Select tier: Newbie → Pro"
3. Admin selects → bot generates a unique alphanumeric token (e.g., `10X-8F3A-2C91`)
4. Bot shows the token: "Token: 10X-8F3A-2C91 — Valid for 24 hours"
5. Admin gives token to the user manually

**Token redemption (user side):**
When user clicks "Upgrade 💡" on their menu, bot asks:
"Enter your upgrade token to unlock PRO tier:"
User enters token → bot validates → if valid and not expired → upgrade user to PRO

**Token storage:**
- Store in a `tokens` table:
  ```sql
  CREATE TABLE IF NOT EXISTS tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT UNIQUE NOT NULL,
    tier TEXT NOT NULL,
    used_by INTEGER,        -- telegram_id who used it
    used_at TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  ```

### New DB functions
```typescript
generateToken(tier: string): string
validateToken(token: string): { valid: boolean; tier?: string; error?: string }
useToken(token: string, telegramId: number): boolean
getTokens(): TokenRecord[]
```

### Admin token UI
```
🔑 *Token Manager*

Tokens Generated Today:
• 10X-8F3A-2C91 — PRO — ⏳ Unused (expires in 18h)
• 10X-7B21-9D44 — PRO — ✅ Used by @user1
• 10X-1C55-3E88 — NEWBIE — ❌ Expired

[Generate New Token]
```

---

## 5. System — Backend monitoring

Overview of system health:

```
⚙️ *System Status*

🤖 Bot: ✅ Online (uptime: 12h 34m)
🔄 Restarts today: 0
💾 Memory: 59.9 MB
👥 Total users: 24
📊 Total trades: 156
✅ Approved: 18 | ⏳ Pending: 4 | ❌ Rejected: 2

🔄 SDK Connections: OK
🌐 Telegram API: OK
📦 Database: OK (iqbot-v3.db)
```

- `uptime` can be fetched from the running process
- Other stats from DB queries

---

## 6. Broadcast — Send messages to users

### Broadcast menu (sub-menu)
```
📢 *Broadcast*

Select target:
• 🟢 Active Traders (traded < 5h ago)
• 🔴 Inactive Traders (no trade in 5h+)
• 👥 All Users
• 🔙 Back
```

### Active vs Inactive definition
- **Active**: User has at least one trade where `created_at` is within the last 5 hours
- **Inactive**: User has NO trades in the last 5 hours (or no trades at all)
- Data source: trades table, check per user

### Broadcast flow
1. Admin selects target group
2. Bot asks: "Send your broadcast message:"
3. Admin types message
4. Bot asks: "Auto-delete after? 5m | 15m | 1h | Never"
5. Admin selects duration
6. Bot confirms: "Broadcast sent to X users. Will auto-delete after [duration]."
7. Bot sends the message to each user in the target group
8. Bot schedules deletion using `setTimeout` or stores scheduled deletions in a table

### Auto-delete implementation
```typescript
// Store broadcast jobs in a new table or array
interface BroadcastJob {
    id: number;
    messageIds: number[];  // per-user message IDs
    deleteAfter: number;   // ms
    sentAt: Date;
}
```

On broadcast send:
- Send message to each target user via `bot.telegram.sendMessage(telegramId, text)`
- Capture returned `message_id` for each
- Schedule `setTimeout` to delete all messages after the specified duration

### New DB functions
```typescript
getActiveTraders(hours: number): number[]  // returns telegram_ids
getInactiveTraders(hours: number): number[]  // returns telegram_ids
getAllUserIds(): number[]
```

---

## 7. Top Traders — Leaderboard

### Global leaderboard (visible to ALL users via menu)

Add a "Leaderboard 🏆" button to the user's main menu (`startKeyboard`). All users can see the top traders.

### Leaderboard logic
- **Auto-update**: Every time a trade closes, the leaderboard data updates
- **Manual override**: Admin can add/edit leaderboard entries
- **Daily reset**: Clears every day at 12:00 AM UTC
- **Max 10 entries** per day total (auto + manual combined)
- **Display**: Shows partial User ID (first 50% visible + `XXXX`) + profit amount

### Auto-update
When a trade is won, the `pnl` is added to the trader's daily total. The leaderboard calculates profit for today (since midnight UTC).

### Manual override
Admin clicks "Top Traders" → shows current leaderboard + "Manual Add" option:
1. Admin enters User ID
2. Admin enters profit amount
3. Entry added to leaderboard
4. If manual amount > auto amount for same user, manual overrides
5. Manual entries appear above auto entries with same profit

### Display format (for all users)
```
🏆 *Today's Top Traders*

🥇 18251XXXX — +$45.20
🥈 93148XXXX — +$37.40
🥉 74829XXXX — +$22.10
...
```

### Daily reset
```typescript
// On bot start, check if we need to reset
// Or use a cron-like interval check
const today = new Date().toISOString().split('T')[0];
if (lastResetDate !== today) { resetLeaderboard(); }
```

### New DB table
```sql
CREATE TABLE IF NOT EXISTS leaderboard (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER NOT NULL,
    profit REAL NOT NULL DEFAULT 0,
    is_manual INTEGER NOT NULL DEFAULT 0,
    date TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(telegram_id, date)
);
```

### New DB functions
```typescript
updateLeaderboardAuto(telegramId: number, pnl: number): void
addLeaderboardManual(telegramId: number, profit: number): boolean  // returns false if max 10 reached
getLeaderboard(date?: string): Array<{partial_id: string; profit: number}>
resetLeaderboard(): void
```

### Mask User ID helper
```typescript
function maskUserId(id: number): string {
    const s = String(id);
    const half = Math.ceil(s.length / 2);
    return s.slice(0, half) + 'X'.repeat(s.length - half);
}
// 182511307 → 18251XXXX
```

---

## 8. Funnel — Landing page tracking integration

### Funnel menu
```
🔻 *Funnel Settings*

🌐 Landing Page URL: [current URL or "Not set"]
📊 Events Today: 0
⚙️ Connected Platforms: None

[Set Landing Page URL]
[View Events]
[Connect Platform]
```

### Features
1. **Set Landing Page URL**: Admin enters the URL of their landing page
2. **Track Events**: Track visits, clicks, starts from the landing page
3. **Platform Integration**: Generate events for ad platforms (Meta Ads, etc.)

### Implementation
- Store landing page URL in .env or config
- Basic webhook endpoint for tracking (extend the existing `:8090` funnel webhook if it exists)
- Simple event logging to DB

```sql
CREATE TABLE IF NOT EXISTS funnel_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,  -- 'visit', 'click_start', 'signup'
    ip_address TEXT,
    user_agent TEXT,
    referrer TEXT,
    metadata TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

---

## 9. Audits — 24-hour summary

Shows a complete audit summary of everything in the past 24 hours:

```
📋 *Audit Report (Last 24h)*

👥 New Users: 5
✅ Auto-Approved: 3
⏳ Manual Pending: 2
❌ Rejected: 0

📊 Trading Activity:
• Total Trades: 47
• Wins: 28 (59.6%)
• Losses: 17 (36.2%)
• Ties: 2 (4.2%)
• Total PnL: +$342.50

🔄 Martingale Runs: 12
   - Recovered: 9
   - Failed: 3

🏆 Top Performer: @user1 (+$127.50)
```

### Data source
All from existing DB tables, filtered by `created_at >= datetime('now', '-1 day')`.

### New DB functions
```typescript
getAuditReport(): AuditReport
```

---

## 10. Admin — Full member management

### Admin member management menu
```
🛡️ *Member Management*

👥 Total Members: 24
✅ Active: 18
⏸️ Paused: 2
❌ Suspended: 4

[View All Members]
[Add Member]
[Pause Member]
[Resume Member]
[Remove Member]
[Message Member]
```

### Features per member

**View All Members**: List all users with status
```
👥 *All Members*

✅ @user1 (ID: 18251XXXX) — PRO — Last trade: 2m ago
✅ @user2 (ID: 93148XXXX) — NEWBIE — Last trade: 1h ago
⏸️ @user3 (ID: 74829XXXX) — DEMO — Paused
❌ @user4 (ID: 55781XXXX) — DEMO — Suspended
```

**Add Member**: Manually add a user by Telegram ID
**Pause Member**: Set a user's status to paused (can't trade)
**Resume Member**: Set a paused user back to active
**Remove Member**: Delete user from database
**Message Member**: Send a direct message to a specific user

### Pause/Resume
Add a `status` column to the users table or reuse `approval_status` with new values:
```typescript
// Additional statuses
'paused'  // temporarily blocked from trading
```

Trade gateway check: when a user tries to trade (ui:trade handler), check if user.status === 'paused' and reject if so.

### New DB functions
```typescript
addMember(telegramId: number, tier: string): void
pauseMember(telegramId: number): void
resumeMember(telegramId: number): void
removeMember(telegramId: number): void
getMemberDetail(telegramId: number): MemberDetail
messageMember(telegramId: number, text: string): void
getAllMembersWithDetails(): MemberDetail[]
```

---

## Files to change

- `src/bot.ts` — 10 admin action handlers, token redemption on user upgrade, leaderboard button in user menu, pause check in trade gateway
- `src/ui/admin.ts` — Rewrite `adminKeyboard()` to 10-button layout, add all sub-menus
- `src/ui/user.ts` — Add "Leaderboard 🏆" button to `startKeyboard()`
- `src/db.ts` — New tables (tokens, leaderboard, funnel_events), new queries for all admin features

---

This is the final section. Once completed, the bot is feature-complete.
