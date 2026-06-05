# Directive: 3-Variant Re-engagement Templates + Cycling

## IMPORTANT: Merge master first
Before working on this branch, make sure you're on the latest master:
```
git checkout master && git pull origin master
git checkout -b claude/reengage-3-variants-YmW2G
```

---

## Change 1: Add `variant` column to `reengage_tracking`

**File:** `src/db.ts`

Somewhere near the existing `reengage_tracking` CREATE TABLE (around line 192), add a migration:

```typescript
// Migration: add variant column for 3-message cycling
const rtCols = (db.prepare('PRAGMA table_info(reengage_tracking)').all() as { name: string }[]).map(c => c.name);
if (!rtCols.includes('variant')) {
    db.exec('ALTER TABLE reengage_tracking ADD COLUMN variant INTEGER NOT NULL DEFAULT 0');
}
```

---

## Change 2: New helper functions in `src/db.ts`

```typescript
export function getReengageVariant(telegramId: number): number {
    const row = db.prepare(
        'SELECT variant FROM reengage_tracking WHERE telegram_id = ?'
    ).get(telegramId) as { variant: number } | undefined;
    return row?.variant ?? 0;
}

export function cycleReengageVariant(telegramId: number): number {
    const current = getReengageVariant(telegramId);
    const next = (current + 1) % 3;
    db.prepare(`
        INSERT INTO reengage_tracking (telegram_id, variant, updated_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(telegram_id) DO UPDATE SET variant = excluded.variant, updated_at = excluded.updated_at
    `).run(telegramId, next);
    return next; // Return the NEW variant (the one that should be used for this send)
}
```

Export both in the imports used by `auto-broadcast.ts` / `bot.ts`.

---

## Change 3: Update re-engagement loop in `src/bot.ts`

### 3a. Update Segment 1 (around line 4785)

Replace the current key lookup:
```typescript
const key = getReengageTemplateKey(user.onboarding_state ?? 'entry_branch_sent');
```

With variant cycling:
```typescript
const baseKey = getReengageTemplateKey(user.onboarding_state ?? 'entry_branch_sent');
const variant = cycleReengageVariant(chatId);
const suffix = ['_a', '_b', '_c'][variant];
const key = baseKey + suffix;
```

Make sure this happens AFTER `chatId` is assigned (currently chatId is assigned at line 4789 — move the key resolution to after chatId or reorder).

### 3b. Update Segment 2 (around line 4822)

Replace the hardcoded key:
```typescript
const key = 'reengage_never_traded';
```

With:
```typescript
const chatId = user.telegram_id; // already there
const variant = cycleReengageVariant(chatId);
const suffix = ['_a', '_b', '_c'][variant];
const key = 'reengage_never_traded' + suffix;
```

**Important:** Both segments call `cycleReengageVariant()` which increments the counter. This is correct — each segment has its own variant cycling. However, since both segments run in the same loop iteration, a user who is in BOTH Segment 1 state `connected` AND Segment 2 (connected non-trader) would get variant-cycled twice. This is a non-issue because `getStuckOnboardingUsers()` requires `ssid IS NULL` while `getConnectedNonTraders()` requires `ssid IS NOT NULL` — they are mutually exclusive sets.

### 3c. Update the template key resolution for media (both segments)

In Segment 1 (line 4794):
```typescript
const mediaKey = key.replace(/^reengage_/, '').replace(/_[abc]$/, '');
```

In Segment 2 (line 4831):
```typescript
const mediaKey = key.replace(/^reengage_/, '').replace(/_[abc]$/, '');
```

This strips the `_a`/`_b`/`_c` suffix so media lookup uses the base key (e.g. `entry_stuck`).

---

## Change 4: Add 12 new templates to the seed

**File:** `src/db.ts`, near the existing template seed section.

The existing `reengage_*` templates become the `_a` variants. Add `_b` and `_c` variants for all 6 Segment 1 keys + the Segment 2 key.

Use `INSERT OR IGNORE` so existing DB content is preserved.

### Template content — Segment 1 (6 states × 3 variants = 18 templates)

**Note:** `{{username}}` is the template placeholder that gets resolved at send time.

---

**`reengage_entry_stuck_a`** (current, keep as-is)
```
{{username}} people are literally printing money with 10x right now.

Check this out 👆

While you're sitting here deciding, someone just cashed out.

👇 You new or you've traded before?
```

**`reengage_entry_stuck_b`**
```
{{username}} this isn't a maybe thing.

Every minute you wait, someone else is locking in profits.

The bot is running. The market is moving. You're just watching.

👇 New or experienced?
```

**`reengage_entry_stuck_c`**
```
{{username}} real talk — the only difference between you and everyone cashing out...

is one click.

Don't overthink it.

👇 Let's go — new or you've traded before?
```

---

**`reengage_video_stuck_a`** (current)
```
{{username}} still haven't watched the video?

Real 10x users don't wait. They stack.

👇 5 minutes and you'll understand everything:
[video link]

External proof:
📱 TikTok: [link]
📸 Instagram: [link]
```

**`reengage_video_stuck_b`**
```
{{username}} skip the video, here's the short version:

10x AI finds high-probability trades.
You copy. You profit. Simple.

85% win rate. 5-minute charts. Real results.

👇 Ready? Watch or skip, just start.
[video link]
```

**`reengage_video_stuck_c`**
```
{{username}} every single person who watched that video is already trading.

You're the only one still sitting on the fence.

It's 5 minutes of your life.

👇 Watch it here:
[video link]
```

---

**`reengage_userid_stuck_a`** (current)
```
{{username}} while you're holding your User ID...

Someone else just hit +$2,400 today using 10x.

Your account is 2 minutes away from being in that same leaderboard.

Drop your User ID 👇
```

**`reengage_userid_stuck_b`**
```
{{username}} this is where it gets real.

Without your User ID, I can't connect you.

And without connecting, you can't trade.

It takes 10 seconds to find.

👇 1️⃣ Open IQ Option
2️⃣ Tap profile icon
3️⃣ Drop the number here
```

**`reengage_userid_stuck_c`**
```
{{username}} you're literally one number away from making money.

That User ID you're ignoring?

Someone else just used theirs to bank $900.

👇 Copy and paste it here:
```

---

**`reengage_email_stuck_a`** (current)
```
{{username}} drop that email.

Your account is one step away from being activated.

👇 Enter your IQ Option email:
```

**`reengage_email_stuck_b`**
```
{{username}} no email = no connection.

No connection = no trades.

It's literally the only thing standing between you and the leaderboard.

👇 Type your IQ Option email:
```

**`reengage_email_stuck_c`**
```
{{username}} quick one — what email did you use for IQ Option?

That's all I need from you right now.

Everything else is automated after this.

👇 Email:
```

---

**`reengage_password_stuck_a`** (current)
```
{{username}} one password away.

You've done the hard part — just finish the login.

👇 Enter your password:
```

**`reengage_password_stuck_b`**
```
{{username}} don't stop now.

User ID ✅
Email ✅
Password — last step.

30 seconds and you're in.

👇 Enter your password:
```

**`reengage_password_stuck_c`**
```
{{username}} final step.

Type your password and I'll handle the rest.

Your account will be live instantly.

👇 Password:
```

---

**`reengage_never_traded_a`** (current)
```
{{username}} you're connected but you haven't taken a single trade.

The bot is ready when you are.

👇 Tap to start:
[button: 🚀 Trade Now]
```

**`reengage_never_traded_b`**
```
{{username}} your account is live, funded, and ready.

10x AI is scanning the markets for your next trade right now.

All you have to do is press start.

👇 Trade now:
[button: 🚀 Trade Now]
```

**`reengage_never_traded_c`**
```
{{username}} I've been watching the charts for you.

There's been 3 high-probability setups in the last hour alone.

Don't let them pass.

👇 One tap:
[button: 🚀 Trade Now]
```

---

### Seed SQL

```typescript
// Add alongside existing template seeding
const reengageVariants = [
  ['reengage_entry_stuck_a', 'entry_branch_sent', "{{username}} people are literally..."],
  ['reengage_entry_stuck_b', 'entry_branch_sent', "{{username}} this isn't a maybe thing..."],
  ['reengage_entry_stuck_c', 'entry_branch_sent', "{{username}} real talk..."],
  ['reengage_video_stuck_a', 'new_user_watch_video', "{{username}} still haven't watched..."],
  ['reengage_video_stuck_b', 'new_user_watch_video', "{{username}} skip the video..."],
  ['reengage_video_stuck_c', 'new_user_watch_video', "{{username}} every single person..."],
  ['reengage_userid_stuck_a', 'awaiting_user_id', "{{username}} while you're holding..."],
  ['reengage_userid_stuck_b', 'awaiting_user_id', "{{username}} this is where it gets real..."],
  ['reengage_userid_stuck_c', 'awaiting_user_id', "{{username}} you're literally one number away..."],
  ['reengage_email_stuck_a', 'awaiting_email', "{{username}} drop that email..."],
  ['reengage_email_stuck_b', 'awaiting_email', "{{username}} no email = no connection..."],
  ['reengage_email_stuck_c', 'awaiting_email', "{{username}} quick one..."],
  ['reengage_password_stuck_a', 'awaiting_password', "{{username}} one password away..."],
  ['reengage_password_stuck_b', 'awaiting_password', "{{username}} don't stop now..."],
  ['reengage_password_stuck_c', 'awaiting_password', "{{username}} final step..."],
  ['reengage_never_traded_a', 'connected', "{{username}} you're connected..."],
  ['reengage_never_traded_b', 'connected', "{{username}} your account is live..."],
  ['reengage_never_traded_c', 'connected', "{{username}} I've been watching..."],
];
```

Use `INSERT OR IGNORE` with the full message text. Only the `_a` variants may already exist (from previous seeds), the `_b` and `_c` are new.

**Important:** Do NOT seed `_b`/`_c` variants with `button_text` or `button_url` fields for the non-trade templates (entry, video, userid, email, password). Only `never_traded` variants should have the Trade Now button.

**For `never_traded` variants:** All 3 should have button text "🚀 Trade Now" with callback_data "ui:trade".

---

## Verification

1. Build: `npx tsc --noEmit`
2. Restart: `pm2 restart iqbot-v3-bot --update-env`
3. Check logs: should seed new `_b` and `_c` templates on restart (if using INSERT OR IGNORE, they'll be new rows)
4. Verify DB: `sqlite3 iqbot-v3.db "SELECT key FROM templates WHERE key LIKE 'reengage_%' ORDER BY key"` should show all 18 templates
5. Test mode: send to Shara — after removing previous re-engage message, watch 3 cycles to confirm variant cycling
