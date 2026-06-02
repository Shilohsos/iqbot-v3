# Master Update Directive — IQ Bot V3

**IMPORTANT: Merge master first** — this branch does NOT include latest master.

This directive covers ALL planned updates. Implement in order listed.

---

## Table of Contents

1. [SSID Stability Overhaul](#1-ssid-stability-overhaul)
2. [Intelligent Onboarding + LLM Brain + Funding Sequence](#2-intelligent-onboarding--llm-brain--funding-sequence)
3. [Admin Media Library](#3-admin-media-library)
4. [New Features](#4-new-features)
5. [Admin UI Upgrades](#5-admin-ui-upgrades)

---

## 1. SSID Stability Overhaul

### 1a. Hourly SSID Health Check
- Run every 1 hour (setInterval in bot.ts)
- Test each user's SSID against IQ Option API
- Detect expired/stale SSIDs proactively (before a trade attempt fails)
- Store result in `users` table (add `ssid_valid` column: INTEGER, 1=valid, 0=expired, NULL=untested)
- Batch check in groups of 5 to avoid rate limits
- Add `ssid_last_checked` column (TEXT, timestamp)

### 1b. Auto-Reconnect (when cred exists)
- If user has `cred` field (base64 email:password) stored → silently re-login using IQ Option API
- Implementation: call `autoReconnect()` which logs in via email/password, extracts new SSID
- Save new SSID to DB, update `ssid_valid = 1`, `ssid_last_checked = now`
- User never notices anything happened
- If re-login fails → mark `ssid_valid = 0`, proceed to 1c

### 1c. Reconnect Prompt Flow (when cred missing or login fails)
- Initial message on detection: "Your session expired, tap here to reconnect" — **no auto-delete**
- Follow-up every 6 hours: new message sent, **previous one auto-deleted** (only one visible at a time)
- Keeps coming until user reconnects
- On reconnect → save `cred` so future expirations are silent
- Template message in `templates` table with key `ssid_expired` (already exists)

### 1d. Suppress Broadcasts for Disconnected Users
- Users with `ssid_valid = 0` → excluded from auto-broadcast target list
- They only receive reconnect follow-up messages, not marketing broadcasts
- Re-include them once `ssid_valid` becomes 1

### 1e. Fix `handlePossibleAuthExpiry` Order
- Currently clears SSID first, then tells user to reconnect
- Change order: try `autoReconnect()` first → if fails, then clear + prompt
- This eliminates unnecessary reconnect prompts for users with stored creds

### 1f. Admin Account Auto-Reconnect
- Same treatment for admin SSID
- Admin SSID stored in `config` table (key `admin_ssid`) — refresh on reconnect

**New DB columns needed:**
```sql
ALTER TABLE users ADD COLUMN ssid_valid INTEGER DEFAULT NULL;
ALTER TABLE users ADD COLUMN ssid_last_checked TEXT DEFAULT NULL;
```

---

## 2. Intelligent Onboarding + LLM Brain + Funding Sequence

### 2a. Architecture

**State Machine** — tracks each user's position in onboarding flow:
- `entry` — just joined, hasn't answered anything
- `new_user_watch_video` — said "I'm new", needs to watch video
- `returning_user_ask_account` — has traded before, asked if they have account
- `create_account` — needs to create IQ Option account via affiliate link
- `awaiting_user_id` — waiting for User ID input
- `awaiting_email` — waiting for email
- `awaiting_password` — waiting for password
- `connected` — SSID saved, can trade
- `funding` — in funding sequence loop
- `trading` — normal active state

Store in `users` table (add `onboarding_state` TEXT column).

**LLM Brain** — triggered when user sends free text or images not matching known commands:
1. Classifies intent using Gemini 2.5 Flash-Lite via OpenRouter
2. Returns one of 25 intent categories
3. Queries `templates` table for matching category
4. Delivers template message + optional button to user

**Template Library** — already in `templates` table:
- 195 templates across 25 intent categories
- Each has: key, category, state, message, button_text, button_url, auto_delete, delay_sec
- See `templates` table in DB

### 2b. New DB Columns
```sql
ALTER TABLE users ADD COLUMN onboarding_state TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN pidgin_enabled INTEGER DEFAULT 0;
```

### 2c. Onboarding Entry Flow

Trigger: User joins channel OR sends `/start` for first time

**Message 1 — Welcome (immediate, no auto-delete)**
```
@username You just secured your access to the hottest trading bot in the industry right now!

No jokes! On your command this bot can print you more money than you can imagine.

The bot is called THE 10x SPECIAL BOT.
```

**5 sec delay**

**Message 2 — What 10x bot does**
```
What can 10x bot do? 👾

The 10x bot is the smartest trading bot right now for trading IQ options OTC assets.

🟣Scans the market in real time
🟣Detects winning setups
🟣Executes smart trades automatically

You relax while 10x AI does the work. 🤖

DEMO — Practice risk-free
Pro — Best for $10+ accounts
Master — $50+ capital • Multiple trades • Advanced AI Analysis

✅Smart Recovery System
✅OTC Pairs Supported
✅Direct Withdrawals
```

**5 sec delay**

**Message 3 — Branch question** (with inline buttons)
```
Before we proceed any further! Are you new to trading or this is your first time hearing about trading?
```
Buttons: [ **I'm new to trading** ] [ **I have traded before** ]
Callback: `onboard:new` / `onboard:experienced`

Set state to `new_user_watch_video` or `returning_user_ask_account` based on choice.

### 2d. Branch: "I'm new to trading"

**Message — Video intro**
```
Alright @username, since you're new... strap in. 🚀

Before anything else, I need you to watch this short video.

It'll show you:
🎬 What IQ Option is
💳 How to create and fund your account
🤖 How to access the 10x Special Bot

5 minutes. That's all it takes to understand everything you need.

👇 Watch the video below:
[video link placeholder]
```
Button: [ **✅ I've watched it** ] → callback `onboard:watched_video`

Set state: `new_user_watch_video`

### 2e. "I've watched it" — Account Creation
```
Let's get this money @username. 💜

First thing — you need an IQ Option account to use the bot.

👇 Sign up here (2 minutes):
https://iqbroker.com/lp/regframe-01-light-nosocials/?aff=749367&aff_model=revenue

Once you're done, drop your User ID below so I can verify you.
```

**How to find your User ID:**
1. Open IQ Option website or app
2. Tap your profile picture (top-left or top-right corner)
3. Your User ID is displayed under your name — it's a 9-digit number
4. Copy that number and paste it here

Set state: `awaiting_user_id`

### 2f. Branch: "I have traded before"
```
You've traded before? Say less. 💜

We're skipping the basics.

👇 Do you have an IQ Option account or not?
```
Buttons: [ **✅ I have one** ] [ **🆕 Need a new one** ]
Callback: `onboard:have_account` / `onboard:need_account`

### 2g. "I have one" — Connect Direct
```
Bet. Let's link it up.

Drop your IQ Option User ID 👇
```

**How to find your User ID:**
1. Open IQ Option → Profile
2. Copy the 9-digit number under your name
3. Paste it here

Set state: `awaiting_user_id`

### 2h. "Need a new one" — Create Then Connect
```
Say less. 2 minutes and you're in.

👇 Create your free account here:
https://iqbroker.com/lp/regframe-01-light-nosocials/?aff=749367&aff_model=revenue

Use your real email. Once done, drop your User ID below.
```

State: `awaiting_user_id`

### 2i. User ID Verification Flow

User sends 9-digit number → bot verifies via IQ Option API

**Verifying:**
```
⏳ Verifying your account...
```

**On failure (first time):**
```
❌ We couldn't verify that User ID @username.

Double-check and send it again 👇
```
Button: [ **🔄 Try again** ]

**On failure (second time):**
```
❌ Still no luck @username.

Let's get you a fresh account the right way.

👇 Create one here:
https://iqbroker.com/lp/regframe-01-light-nosocials/?aff=749367&aff_model=revenue

Come back and drop your new User ID once done.
```

**On success:**
```
✅ Account verified! You're good to go.

📧 Now enter your IQ Option email:
```
State → `awaiting_email`

### 2j. Email → Password → Connect

**Email received:**
```
🔑 Now enter your password:
```
State → `awaiting_password`

**Password received:**
- Bot logs in via IQ Option API
- Saves SSID + `cred` (base64 email:password) + email
- Sets `onboarding_state = 'connected'`

```
✅ Connected @username! 💜

💰 Practice: $10,000.00

You're now locked in. The 10x Special Bot is live and ready.

👇 Tap below to take your first trade.
```
Button: [ Take a trade 👾 ] → callback `ui:trade`

### 2k. Re-engagement Follow-ups

**Rules:**
- Trigger: 6 hours since last user action in current state
- Frequency: every 6 hours until user responds
- Each new message auto-deletes the previous one
- After 2 weeks of no response: removed from broadcast list
- Messages include media from `sequence_media` table (if available)

Follow-up template keys in `templates` table:
- `state_entry_stuck` — never tapped new/experienced
- `state_video_stuck` — never tapped "I've watched it"
- `state_user_id_stuck` — never sent User ID
- `state_email_stuck` — User ID verified, no email yet
- `state_password_stuck` — email sent, no password yet
- `state_never_traded` — connected but hasn't taken a trade

### 2l. Post-Connect Funding Sequence

**Rules:**
- Starts after user connects and takes first trade
- Never stops until user funds their live account
- Triggers: every 2 demo trades, every 5 demo trades, every 10 demo trades + every 12h if idle
- Each new message auto-deletes the previous one
- If funded user's live balance hits $0 → sequence restarts
- Messages rotate between 6 templates
- Each message: media + short text + [ 💎 Fund now ] button
- Promo codes alternate: **10xfirst** (100% bonus) and **10xsecond** (150% bonus)

Funding templates already in `templates` table with category `funding`.

**Funding URL button:** `https://iqoption.com/pwa/payments/deposit`

### 2m. LLM Brain — Implementation

**Trigger:** Any user message that is NOT:
- A known command (/start, /signals, /help, etc.)
- A button callback
- A numeric input expected by current onboarding state (User ID, email, password)
- An image sent while not in onboarding state

**Flow:**
1. Bot receives free text (optionally with photo)
2. If photo present → pass to Gemini as vision input
3. Call Gemini 2.5 Flash-Lite via OpenRouter:

```
Model: google/gemini-2.5-flash-lite
API: https://openrouter.ai/api/v1/chat/completions
Authorization: Bearer {{OPENROUTER_API_KEY from .env}}
```

4. System prompt for classification:
```
You are an intent classifier for a trading bot called "10x Bot".
Classify the user's message into EXACTLY one of these categories:

greeting — Hello, hi, good morning, casual greeting
new_user_greeting — First message from someone who's new
returning_user — Has traded before, has an account
account_creation — How to create IQ Option account, sign up
connect_account — How to connect account to bot
bot_not_working — Bot stopped, no signals, something broken
ssid_connect_fail — Connection failed, wrong ID, auth error
how_bot_works — How does the bot work, what does it do
trading_explanation — CALL/PUT, expiry, how binary options work
funding_deposit — How to deposit, minimum, payment methods
withdrawal — How to withdraw, processing time
loss_recovery — Lost money, bad trades, red streak
risk_safety — Is it safe, can I lose, guaranteed profit?
bot_strategy — Win rate, strategy accuracy, indicators
pricing_tiers — Cost, PRO vs MASTER, what's included
promo_bonus — Promo codes, discounts, bonuses
upgrade_migration — Upgrade tier, migrate account
scam_legit — Is this a scam, proof, verification
need_time — I'll think about it, later, not ready
frustration_complaint — Angry, calling scam, cursing
referral_affiliate — Refer friends, affiliate program
talk_to_admin — Talk to human, support, real person
leaderboard_stats — My performance, PnL, how I'm doing
thanks_response — Thank you, ok, alright, got it
unrecognized — Catch-all for anything else

If the user sent an image, analyze what's in it and classify accordingly.

Respond with ONLY the category name in lowercase, nothing else.
```

5. Parse response → look up `templates` table where `category = response` AND `state = 'brain'`
6. Pick a random template from matching results (or first)
7. Send message + optional button
8. If image included and classification is unclear → send unrecognized template

**Error handling:**
- If Gemini API fails → fall back to `unrecognized` template
- If no templates match category → fall back to `unrecognized`
- Rate limit: max 1 LLM call per user per 5 seconds

### 2n. LLM Brain — New OpenRouter Config

Add to `.env`:
```
OPENROUTER_API_KEY=*** configured via Hermes system key
OPENROUTER_MODEL=google/gemini-2.5-flash-lite
```

The OpenRouter key is available in the Hermes system config at `/root/.hermes/.env` (OPENROUTER_API_KEY). Use this value directly in the bot's .env.

### 2o. New DB Table for Onboarding State
No new table needed — add `onboarding_state` column to `users` table. But create a new table for tracking re-engagement:

```sql
CREATE TABLE IF NOT EXISTS onboarding_tracking (
    telegram_id INTEGER PRIMARY KEY,
    entry_sent_at TEXT,
    state_changed_at TEXT,
    last_followup_at TEXT,
    followup_count INTEGER DEFAULT 0,
    last_activity_at TEXT,
    FOREIGN KEY (telegram_id) REFERENCES users(telegram_id)
);
```

---

## 3. Admin Media Library

### 3a. New DB Table
```sql
CREATE TABLE IF NOT EXISTS sequence_media (
    template_key TEXT PRIMARY KEY,
    media_type TEXT NOT NULL,      -- 'photo' or 'video'
    file_id TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 3b. Template Keys for Media
- `entry_stuck` — Welcome follow-up (win screenshot)
- `new_trader_video` — "I'm new" video reminder (TikTok/IG clip)
- `user_id_stuck` — User ID follow-up (payout screenshot)
- `email_stuck` — Email follow-up (withdrawal proof)
- `password_stuck` — Password follow-up (bot dashboard)
- `never_traded` — Connected but never traded (testimonial video)

### 3c. Admin Menu Button
Add to `adminKeyboard()`:
```
{ text: '📁 Media Library', callback_data: 'admin:media_library' }
```

### 3d. Media Library Flow
1. Admin taps `📁 Media Library`
2. Bot lists all template keys with current media status (✅ has media / ❌ none)
3. Admin taps template key → bot shows current media (if exists) + prompts: "Send new photo/video"
4. Admin sends media → bot saves `file_id` to `sequence_media` table
5. Confirmation with thumbnail preview
6. If media existed before, replaces it

### 3e. Fallback
- If no custom media uploaded for a template → message sends without media
- If custom media exists → bot sends message + media together

---

## 4. New Features

### 4a. Daily Performance Post to VIP Channel
- Bot generates daily stats summary every 24h
- Message format:
```
📊 *24h Performance Report*

📈 Signals sent: {count}
✅ Wins: {wins} ({win_rate}%)
❌ Losses: {losses}
💰 Total PnL: +${pnl}
👤 Active traders: {active_count}

Powered by 10x Bot 💜
```
- **Does NOT post automatically** — sends to Master for approval first
- Master receives the draft in DM with buttons: [ ✅ Post to Channel ] [ 🔄 Regenerate ] [ ❌ Cancel ]
- Only posted to VIP channel (`CHANNEL_ID`) on approval
- Reset timer after each post

### 4b. Educational Drip Campaign
- Once daily, send a short trading tip to all active users
- Rotating pool of 30+ tips stored in `motivational_messages` table
- Categories: risk management, psychology, strategy, platform tips
- Only send to users with `approval_status = 'approved'` AND valid SSID
- Respects test mode (only Shara when test mode ON)
- Tip messages are short (under 150 chars), no buttons needed

### 4c. Pidgin English Support (`/pidgin` toggle)
- New command: `/pidgin` — toggles pidgin mode for the user
- Store in `users` table: `pidgin_enabled INTEGER DEFAULT 0`
- When ON, key onboarding messages come in Pidgin English
- Pidgin templates stored in `templates` table with category containing `pidgin_` prefix
- OR implement via a mapping function that converts key messages
- Example key Pidgin translations:
  - "Drop your User ID" → "Abeg drop your User ID make I verify you"
  - "Let's get this money" → "Make we make this money together"
  - "Create an account" → "Create account, no be anything"
- When OFF → normal English messages
- Show current setting in /start menu or settings

---

## 5. Admin UI Upgrades

### 5a. SSID Health Dashboard
- New button in admin menu: `🔑 SSID Health` → callback `admin:ssid_health`
- Handler shows:
```
🔑 *SSID Health*

✅ Valid: {count}
❌ Expired: {count}
⬜ Missing: {count}
━━━━━━━━━━━━━━
Total with SSID: {total}

Tap below for details
```
- Button: [ ❌ View Expired ] → callback `admin:ssid_expired`
- Expired list shows users with expired SSIDs, tap user → quick actions

### 5b. User Detail Drilldown
- Modify `member:view` handler: when showing user list, make each entry tappable
- Callback: `user_detail:{telegram_id}`
- User detail card:
```
👤 *User Details*

ID: {masked_id}
Tier: {tier}
Status: {approval_status}
SSID: ✅ Valid / ❌ Expired / ⬜ None
Trades: {count}
Last active: {relative_time}
Referrals: {count}

*Quick Actions:*
```
- Buttons: [ ✅ Approve ] [ ⏸ Pause ] [ ✉️ Message ] [ 🔄 Reset SSID ] [ 📊 Trades ] [ 🔙 Back ]

### 5c. Funnel Dashboard Upgrade
- Replace `admin:funnel` handler
- Show conversion funnel:
```
🔻 *Conversion Funnel*

Clicks (ads): {clicks}
→ Joined channel: {joins} ({conv1}%)
→ Connected (SSID): {connected} ({conv2}%)
→ Traded: {traded} ({conv3}%)
→ Funded: {funded} ({conv4}%)

Biggest drop-off: {step_name} ({drop_off}%)
```
- Data from `funnel_events` table + `users` table
- Keep [ Set Landing Page URL ] button

### 5d. User Filters & Search
- Add filter buttons to member view:
```
Filters: [ All ] [ DEMO ] [ PRO ] [ MASTER ] [ Active ] [ Inactive ] [ Funded ]
```
- Callback: `member:filter:{filter_name}`
- Each filter requeries DB and shows filtered list
- Search by username: keep existing `admin:find_users` but enhance to search by username AND telegram ID

### 5e. Broadcast Analytics
- After broadcast completes (after `broadcast:send_now` or scheduled sends):
  - Reply with delivery summary:
  ```
  📬 *Broadcast Complete*
  
  ✅ Sent: {count}
  ❌ Failed: {failed}
  🎯 Target: {target_name}
  ```
- Add historical view: `admin:broadcast_history` button
- Shows last 10 broadcasts with: date, target, sent count, failed count

### 5f. LLM Template Preview
- New admin button: `🧠 LLM Templates` → callback `admin:llm_templates`
- Shows categories list with counts:
```
🧠 *LLM Template Library*

Categories:
{category_1}: {count}
{category_2}: {count}
...
```
- Tap category → shows templates in that category
- Tap template → preview message + button
- Button: [ ✏️ Edit ] → admin sends new text → updates template

### 5g. Onboarding Funnel Visual
- New admin button: `👣 Onboarding` → callback `admin:onboarding_funnel`
- Shows:
```
👣 *Onboarding Flow*

Entry: {count}
→ Watched Video: {count} ({pct}%)
→ Created Account: {count} ({pct}%)
→ Sent User ID: {count} ({pct}%)
→ Connected: {count} ({pct}%)
→ Traded: {count} ({pct}%)
→ Funded: {count} ({pct}%)
```
- Data from `onboarding_state` column in `users` table
- Also show "Stuck users" count per state

### 5h. Quick User Actions from List
- In `member:view` list, each user row shows:
  - Masked ID or username
  - Status badge (🟢✅🔴⏸)
- Tap user → inline action buttons (already covered in 5b)
- Also add from `admin:activations` view: tap pending user → approve/reject directly

### 5i. Tier Distribution Overview
- Add to `admin:back` dashboard or new button
- Current admin dashboard shows user counts. Add tier breakdown:
```
📊 *Tier Distribution*

👑 MASTER: {count} ({pct}%)
⚡ PRO: {count} ({pct}%)
🧪 DEMO: {count} ({pct}%)

Funded: {count}/{total} ({funded_pct}%)
```
- Can be added to the existing admin dashboard reply in `admin:back`

### 5j. Broadcast Preview Before Send
- After admin writes broadcast content and selects button, before send:
  - Show preview message with button exactly as users will see it
  ```
  📱 *Broadcast Preview*
  
  "{content}"
  
  ──────────────
  [ {button_text} ]
  ──────────────
  
  Send to: {target}
  ```
- Buttons: [ ✅ Send ] [ ✏️ Edit Content ] [ 🔙 Cancel ]
- Callback: `broadcast:preview_approve` / `broadcast:preview_edit`

---

## Implementation Notes

### Environment Variables to Add
```
OPENROUTER_API_KEY=*** already added to bot .env (VPS)***
OPENROUTER_MODEL=google/gemini-2.5-flash
```

### Templates Seed Data
- Templates schema + seed SQL at `db/templates-seed.sql`
- 195 brain templates (25 categories, 6 variants each) + onboarding + funding + re-engagement + SSID
- Include `seedTemplates()` function in `db.ts` that:
  1. Creates `templates` table if not exists
  2. INSERT OR IGNORE all seed data
  3. Call at bot startup
- The 195 brain templates from the DB are NOT in the SQL file (too large) — instead, add a second seed function `seedBrainTemplates()` that inserts the complete set. The full data is in the live SQLite DB on the VPS, or extract the INSERT statements from the db/export if needed.

### Key Files to Modify

### Key Files to Modify
- `src/bot.ts` — main handlers, new admin actions, new triggers
- `src/ui/admin.ts` — new keyboards
- `src/ui/user.ts` — user-facing keyboards if needed
- `src/db.ts` — new DB queries
- `src/llm.ts` — add Gemini classification (rename to classifier.ts or extend)
- `src/auto-broadcast.ts` — suppress for SSID-expired users

### New Files to Create
- `src/onboarding.ts` — onboarding state machine, re-engagement timers
- `src/classifier.ts` — LLM brain (Gemini classification + template selection)
- `src/pidgin.ts` — Pidgin string mapping

### Existing Templates
- 195 templates already in `templates` table across 25 categories
- Onboarding messages defined above should also be stored as templates
- Add onboarding entry messages to `templates` table with category `onboarding_entry`

---

## Build & Deploy
1. `npm run build`
2. `pm2 restart iqbot-v3-bot --update-env`
3. Verify: check admin menu for all new buttons
4. Verify: test onboarding flow as new user
5. Verify: test LLM brain with free text message
