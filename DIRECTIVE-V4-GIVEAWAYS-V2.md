# DIRECTIVE: V4 Giveaways V2 — Scheduled, Criteria-Gated, Participatory

## Context

Current giveaway system: simple one-shot — admin picks target (all/24h), bot broadcasts winner IDs. No participation tracking, no scheduling, no criteria.

V4 giveaway is a complete replacement: scheduled giveaways, promo codes, and marathons with eligibility criteria, live randomized participant updates, and motivational push messages.

## 1. Database Tables

### `giveaway_events` — schedule + criteria

```sql
CREATE TABLE IF NOT EXISTS giveaway_events (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type        TEXT    NOT NULL DEFAULT 'giveaway',  -- 'giveaway' | 'promo_code' | 'marathon'
    title             TEXT    NOT NULL,
    description       TEXT,
    criteria_type     TEXT,    -- 'new_user' | 'min_balance' | 'top_traders'
    criteria_value    TEXT,    -- '7' (days), '20' (dollars), '10' (trades)
    prize_pool        REAL,
    prize_per_winner  REAL,
    max_winners       INTEGER NOT NULL DEFAULT 1,
    status            TEXT    NOT NULL DEFAULT 'pending',   -- 'pending' | 'active' | 'completed'
    starts_at         TEXT,    -- ISO timestamp
    ends_at           TEXT,
    winner_count      INTEGER NOT NULL DEFAULT 0,
    created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);
```

### `giveaway_participants` — who joined + progress

```sql
CREATE TABLE IF NOT EXISTS giveaway_participants (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    giveaway_id     INTEGER NOT NULL REFERENCES giveaway_events(id),
    telegram_id     INTEGER NOT NULL,
    trade_count     INTEGER NOT NULL DEFAULT 0,
    eligible        INTEGER NOT NULL DEFAULT 1,   -- 0 if disqualified mid-contest
    disqualify_reason TEXT,
    winner          INTEGER NOT NULL DEFAULT 0,
    joined_at       TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(giveaway_id, telegram_id)
);
```

### `giveaway_updates` — batched real-time update queue

```sql
CREATE TABLE IF NOT EXISTS giveaway_updates (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    giveaway_id     INTEGER NOT NULL REFERENCES giveaway_events(id),
    participant_id  INTEGER NOT NULL REFERENCES giveaway_participants(id),
    update_type     TEXT    NOT NULL,  -- 'joined' | 'progress' | 'won' | 'disqualified'
    update_text     TEXT,
    sent            INTEGER NOT NULL DEFAULT 0,
    send_at         TEXT    NOT NULL DEFAULT (datetime('now')),
    created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
```

### `motivational_messages` — reusable templates

```sql
CREATE TABLE IF NOT EXISTS motivational_messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    category        TEXT    NOT NULL,  -- 'persuasion' | 'urgency' | 'social_proof'
    content         TEXT    NOT NULL,
    enabled         INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
```

### `notifications_queue` — general push queue

```sql
CREATE TABLE IF NOT EXISTS notifications_queue (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id     INTEGER NOT NULL,
    message         TEXT    NOT NULL,
    reply_markup    TEXT,   -- JSON
    image_file_id   TEXT,
    delete_after_seconds INTEGER DEFAULT NULL,
    priority        INTEGER NOT NULL DEFAULT 0,
    status          TEXT    NOT NULL DEFAULT 'pending',  -- 'pending' | 'sent' | 'failed'
    send_after      TEXT,   -- delay send until
    created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
```

Add indexes:

```sql
CREATE INDEX IF NOT EXISTS idx_gp_giveaway_id ON giveaway_participants(giveaway_id);
CREATE INDEX IF NOT EXISTS idx_gp_telegram_id ON giveaway_participants(telegram_id);
CREATE INDEX IF NOT EXISTS idx_gu_send_at ON giveaway_updates(send_at, sent);
CREATE INDEX IF NOT EXISTS idx_nq_status ON notifications_queue(status, send_after);
```

## 2. src/giveaway.ts — Core Giveaway Engine

Create new file. Export these functions:

### `createGiveawayEvent(event)` — admin creates

```typescript
interface GiveawayEventInput {
  event_type: 'giveaway' | 'promo_code' | 'marathon';
  title: string;
  description?: string;
  criteria_type?: 'new_user' | 'min_balance' | 'top_traders';
  criteria_value?: string;
  prize_pool?: number;
  max_winners: number;
  starts_at?: string;  // if scheduled future
  ends_at?: string;
}

function createGiveawayEvent(input: GiveawayEventInput): number
// Returns new event ID
```

### `activateGiveaway(giveawayId)` — admin triggers active

- Sets status → 'active'
- Notifies ALL users (not just participants) with giveaway announcement
- Only Pro and Master tiers see "Participate" button (Demo sees "Not eligible" text)

### `participate(giveawayId, telegramId)` — user joins

- Check tier (Demo → denied with "Only Pro and Master can participate")
- Check criteria:
  - `new_user`: user.created_at < giveaway.starts_at + criteria_value days → return "Giveaway only for new users"
  - `min_balance`: fetch live balance via SDK pool → if below threshold → return "Insufficient balance. Fund your account to participate." + deposit link button
  - `top_traders`: no balance check, just enroll + start tracking trade count
- If eligible → INSERT into `giveaway_participants`
- Queue a 'joined' update via `queueParticipantUpdate`

### `recordTrade(tradeResult, telegramId)` — called after every trade

- Find all active giveaways where user is participating
- For `top_traders` giveaways: increment `trade_count` (skip martingale trades)
- Queue periodic progress updates

### `selectWinners(giveawayId)` — admin triggers, or auto at ends_at

For `min_balance` / `new_user` giveaways: random selection from eligible participants.
For `top_traders` giveaways: top N by trade_count.

### `queueParticipantUpdate(giveawayId, participantId, type, text)`

- Inserts into `giveaway_updates` with a RANDOM send_at in the future (within next 30 seconds to 5 minutes)
- This creates the staggered update effect

### `sendMotivationalMessage(giveawayId)` — sends to ALL participants of active giveaway

- Uses `motivational_messages` table templates
- Sends persuasive reminders like:
  - "Giveaway is still on, you still have a chance to win $X"
  - "Participate now — winners will be selected soon"

### `processUpdateQueue()` — run every 30 seconds (setInterval in index.ts)

- SELECT from `giveaway_updates` WHERE `sent = 0` AND `send_at <= now()`
- Send each update to the participant
- Also sends random batch (2-16 users) the current participant count: "🔥 16 people just joined the giveaway" or "📊 28 users now participating"
- Mark as sent

### `processNotificationsQueue()` — run every 30 seconds

- SELECT from `notifications_queue` WHERE `status = 'pending'` AND `send_after <= now()`
- Send messages with backoff on failure
- Track to avoid flooding users

## 3. Admin UI — src/ui/admin.ts

### New Giveaway menu (replaces current single button)

```
adminKeyboard() additions:
+ [🎁 Giveaways V2    → admin:giveaways]
```

### `admin:giveaways` handler → shows:

```
🎁 *Giveaway Manager*

Active: 2 | Scheduled: 1 | Completed: 5

[➕ New Giveaway]
[📋 View Active]
[📅 Scheduled]
[✅ Pick Winners]
[🔙 Admin Menu]
```

### Create giveaway wizard steps (new admin session steps):

Step 1: Type → `giveaway_type` — 'giveaway' / 'promo_code' / 'marathon'
Step 2: Title → `giveaway_title` — text input
Step 3: Description → `giveaway_desc` — text input (optional, type 'skip')
Step 4: Criteria → `giveaway_criteria` — 'none' / 'new_user' / 'min_balance' / 'top_traders'
Step 5: Criteria value → e.g. '7' (days), '20' (dollars), '10' (trades)
Step 6: Number of winners → `giveaway_max_winners` — integer
Step 7: Prize pool → `giveaway_prize` — dollar amount
Step 8: Schedule → now or future (ISO or delay like '2h')
Step 9: Confirm → summary + send

### Pick winners

Lists active giveaways, admin selects, winners auto-selected.

## 4. User UI Changes

### Giveaway card (appears when giveaway is active)

When user opens the bot (sendStartMenu), check for active giveaways. Display:

```
🎁 *LIVE GIVEAWAY*
{title}
Prize Pool: ${amount}
{criteria description}
{participant count} participating

[Participate 👇]
```

- Demo tier: shows giveaway info + "Upgrade to PRO to participate" + upgrade button
- Pro/Master: shows "Participate" button

### `giveaway:participate:<id>` handler

- Call `participate(giveawayId, telegramId)`
- Return result message (success / denied with reason)

### Live update notifications

Bot auto-sends to participants at random intervals:
- "🔥 {name} just joined. {N} users now competing."
- "⏱ Winners selected in {time}. You still have time."
- "💪 {N} participants. Your odds: {1/N}%"

Text from `motivational_messages` table.

## 5. Files to Change

| File | Action |
|------|--------|
| `src/giveaway.ts` | **NEW** — core giveaway engine |
| `src/db.ts` | Add new tables/migrations, export new CRUD functions |
| `src/bot.ts` | Add giveaway handlers, wire trade recording, update sendStartMenu to show active giveaways |
| `src/ui/admin.ts` | New giveaways menu + create wizard keyboards |
| `src/ui/user.ts` | Add participate button to startKeyboard |
| `src/menu.ts` | Participatory giveaway keyboards |
| `src/index.ts` | Add `processUpdateQueue()` and `processNotificationsQueue()` via setInterval |

## 6. Motivational Message Templates (Pre-Seeded)

Seed these into `motivational_messages` on first run:

| Category | Content |
|----------|---------|
| persuasion | "Giveaway is still on — you still have a chance to win *${prize_per_winner}*. Don't sit this one out 👇" |
| urgency | "⏳ Winners will be selected soon. You can still participate and claim your share of *${prize_pool}*." |
| social_proof | "🔥 *${count}* traders already joined this giveaway. Every second you wait = less chance to win." |
| persuasion | "Someone's going to win *${prize_per_winner}*. Why not you? Join now 👇" |
| urgency | "🚨 Last chance! Winners picked in *${time_left}*. Tap Participate now." |
| social_proof | "💸 *${recent_winner}* just claimed a prize last giveaway. This could be you next." |
| persuasion | "Trade more, win more. The *${title}* giveaway rewards the most active traders 🏆" |
| urgency | "Not in yet? *${spots_left}* winners will split *${prize_pool}*. Your move 👇" |

---

**Deploy:** `npx tsc && pm2 restart iqbot-v3-bot`

**Test:** Admin creates giveaway → users see announcement → Pro joins → Demo denied → updates flow → winners selected → notifications delivered.
