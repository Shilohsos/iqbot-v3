# Directive — Section 8: GITES Approval & Onboarding System

## Goal
Add a complete user onboarding, approval, and admin detection system to the V3 bot.

---

## 1. Admin Auto-Detection

**Current:** Admin must type `/admin` to access admin panel.

**Required:** When the admin's Telegram user clicks `/start`, the bot should auto-detect them as admin and show the full admin dashboard **instead** of the client onboarding flow.

- Admin Telegram ID stored in `.env` as `ADMIN_USER_ID`
- On `/start`, compare `ctx.from!.id` against `ADMIN_USER_ID`
- If match → show admin dashboard (current `/admin` response)
- If no match → show client onboarding flow (Section 2 below)

---

## 2. Client Onboarding Flow

When a non-admin user clicks `/start`:

### Step 1 — Ask account status
> "Do you have an IQ Option account?"
> [Yes, I have an account] [No, I need to create one]

### Step 2a — Has account
Prompt user to enter their IQ Option User ID with instructions:
> "Enter your IQ Option User ID.
> How to find it: Open IQ Option app → Profile → User ID (a number)"

### Step 2b — No account
> "Create an account using this link: [admin's IQ Option affiliate link]
> Once done, enter your User ID."

### Step 3 — Approval check (auto or manual)
After user submits User ID:
1. Bot checks the affiliate tracking channel (via Telethon — see Section 3)
2. If User ID found in channel → **auto-approved** ✅
3. If User ID NOT found → "Contact admin for manual approval at @admin_username"

### Step 4 — On successful approval
- Save user's Telegram ID + IQ Option User ID to database
- Present the trading menu (current `/start` response for connected users: Trade / History / Balance / Settings)

---

## 3. Telethon — Affiliate Tracking Channel Reader

**Purpose:** Read a Telegram channel where affiliate signups are tracked. The bot checks if a submitted User ID exists in that channel.

**Setup:**
- Bot uses a **Telethon session string** (a Pyrogram/Telethon string session) provided by the admin
- Bot is already a member of the tracking channel
- On each User ID submission, bot reads recent messages from the channel and checks if any message contains the submitted User ID

**What the channel tracks (per user):**
- User ID (numeric)
- Account creation/funding time
- First deposit amount
- (any other data visible in channel messages)

**Implementation notes:**
- Do NOT add full Telethon as dependency to the Node.js project
- Instead: create a **standalone Python script** (`scripts/check_affiliate.py`) that:
  - Takes a User ID as argument
  - Uses Telethon with the session string (from env var `TELETHON_SESSION`)
  - Connects to the tracking channel (channel ID from env var `AFFILIATE_CHANNEL_ID`)
  - Scans last N messages (configurable, default 1000)
  - Returns `true` + user data if found, `false` if not found
- Bot spawns child process to call this script when needed
- Session string stored in `.env` as `TELETHON_SESSION`

**Dependencies (Python):**
- `telethon`
- `python-dotenv`

---

## 4. Approval States

| State | Action |
|-------|--------|
| **Pending** | User submitted User ID, awaiting check |
| **Auto-approved** | User ID found in affiliate channel → trading enabled |
| **Manual approval** | User ID not found → admin must manually approve via `/admin approve <telegram_id>` |
| **Rejected** | Admin can reject via `/admin reject <telegram_id>` |

**Database columns to add to users table:**
- `iq_user_id` (number) — the user's IQ Option User ID
- `approval_status` (string) — `pending` | `approved` | `manual` | `rejected`
- `approved_at` (timestamp)
- `affiliate_data` (JSON) — data from affiliate channel if found

---

## 5. Admin Approval Commands

| Command | Action |
|---------|--------|
| `/admin` | Shows admin dashboard (only for admin Telegram ID) |
| `/admin users` | List all users with approval status |
| `/admin approve <telegram_id>` | Manually approve a user |
| `/admin reject <telegram_id>` | Reject/block a user |
| `/admin stats` | Show approval stats (approved, pending, manual, rejected) |

---

## 6. Environment Variables (new)

```
ADMIN_USER_ID=<admin_telegram_user_id>
AFFILIATE_LINK=https://iqoption.com/ref/<admin_ref>
TELETHON_SESSION=<telethon_session_string>
AFFILIATE_CHANNEL_ID=<channel_id>
```

---

## Phased Order

1. Admin auto-detection on `/start`
2. Client onboarding flow (Step 1 → Step 2a/2b → Step 3)
3. Telethon Python script for channel scanning
4. Approval state machine (auto + manual)
5. Admin approval commands
6. Full integration test
