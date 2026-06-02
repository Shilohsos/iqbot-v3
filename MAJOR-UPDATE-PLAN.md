# Major Update Plan — IQ Bot V3

**Status:** Collecting updates. Directives not yet written.
**Authority:** Master Ferdinand Shiloh Hart

---

## Update #4 — New Features (Added 2026-05-30)

### 4a. Daily Performance Post to VIP Channel
...

### 4b. Educational Drip Campaign
...

### 4c. Pidgin English Support (`/pidgin` toggle)
...

---

## Update #5 — Admin UI Upgrades (Added 2026-05-30)

### 5a. SSID Health Dashboard
- New admin button: `🔑 SSID Health`
- Shows: valid SSIDs, expired SSIDs, users without SSID
- Click expired → list users affected
- Click user → option to send reconnect prompt

### 5b. User Detail Drilldown
- Tap any user from member list → full profile card
- Shows: tier, approval status, SSID valid/expired, trade count, last active, referral info
- Quick actions: [Approve] [Pause] [Message] [View Trades] [Reset SSID]

### 5c. Funnel Upgrade
- Replace bare "Set Landing Page URL" with full funnel dashboard
- Visual conversion: Clicks → Joins → Connected → Traded → Funded
- Drop-off rate per step

### 5d. User Filters & Search
- Filter by: tier (DEMO/PRO/MASTER), status (active/paused/rejected), activity (active/inactive 24h), funded status
- Search by username or telegram ID

### 5e. Broadcast Analytics
- After broadcast: show delivery count, failed count, pending
- Historical: tap past broadcast → see stats

### 5f. LLM Template Preview
- New admin button: `🧠 LLM Templates`
- Browse all 195 templates by category
- Preview message text + button
- Edit template text (admin override)

### 5g. Onboarding Funnel Visual
- Dashboard view: Users at each stage of onboarding
- Entry → Video → User ID → Email → Password → Connected → Funded
- Count per stage, drop-off percentage

### 5h. Quick User Actions from List
- From member list: tap user → inline action buttons
- Approve / Pause / Message / SSID Reset in 1-2 taps
- No need to navigate to separate menus

### 5i. Tier Distribution Overview
- Added to admin dashboard or new button
- Bar/visual: DEMO / PRO / MASTER counts + conversion rates

### 5j. Broadcast Preview Before Send
- Before sending, show exactly how message + button renders
- Approve or edit before delivery

---

## Update #1 — SSID Stability Overhaul

**Status:** ✅ Agreed — ready for directive

### Components:

**1a. Hourly SSID Health Check**
- Run every 1 hour
- Test each user's SSID against IQ Option API
- Detect expired/stale SSIDs proactively (before a trade fails)

**1b. Auto-Reconnect (when cred exists)**
- If user has `cred` (base64 email:password) stored → silently re-login using `autoReconnect`
- Save new SSID to DB
- User never notices anything happened

**1c. Reconnect Prompt Flow (when cred missing or password changed)**
- Initial message on detection: "Your session expired, tap here to reconnect" — **no auto-delete**
- Follow-up every 6 hours: new message sent, **previous one auto-deleted** (only one visible at a time)
- Keeps coming until user reconnects
- On reconnect → save `cred` so future expirations are silent

**1d. Suppress Broadcasts for Disconnected Users**
- Users with no valid SSID → excluded from auto-broadcast target list
- They only receive reconnect follow-up messages, not marketing broadcasts
- Re-include them once they reconnect successfully

**1e. Fix `handlePossibleAuthExpiry`**
- Currently clears SSID first, then tells user to reconnect
- Change order: try `autoReconnect` first → if fails, then clear + prompt

**1f. Admin account auto-reconnect**
- Same treatment for admin SSID (Shilohx436@gmail.com)

---

## Update #2 — Intelligent Onboarding Sequence (LLM-Powered)

**Status:** 🔄 Discussing — not yet agreed

**Architecture:**
- **Templates library** — pre-written messages for every state/scenario. Hand-crafted, zero hallucination risk.
- **LLM brain (free OpenRouter models)** — reads user context, selects correct template to send. Does NOT generate message text.
- **State machine** — tracks each user's position in the onboarding flow per user session.

### 3-Pillar Sequence:

| Pillar | Content | Trigger |
|--------|---------|---------|
| 1 — Brand (Shield) | Who Master is, the 10x story, trust building | First `/start` or channel join |
| 2 — Bot Proof | Wins, leaderboard, social proof, how bot works | After pillar 1 completes |
| 3 — Connect | Prompt to connect IQ Option account | After pillar 2 completes |

**LLM brain responsibilities:**
- Track which user is in which pillar/state
- Detect stuck users → select "unstuck" template
- Handle off-flow messages → classify intent → route to correct template
- Personalize template with user context (name, time elapsed, etc.)
- Re-engagement triggers when user goes silent

**NOT in scope for LLM:**
- Generating message text (templates only)
- Trade execution
- Account creation (to be added later as optional flow)

### Data backing:
- 426 joined channel last 7 days
- Only 104 (24%) became approved users — cold onboarding is the bottleneck
- 75 traded, only 16 funded — nurture gap between connect and fund
- LLM routing is cheaper and more reliable than LLM generation

### Drafted Sequences:

**Entry Flow (triggers on channel join or first `/start`)**

**Message 1 — Welcome (immediate)**
```
@username You just secured your access to the hottest trading bot in the industry right now!

No jokes! On your command this bot can print you more money than you can imagine.

The bot is called THE 10x SPECIAL BOT.
```

**5 sec delay ↓**

**Message 2 — What 10x bot does (immediate)**
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

**5 sec delay ↓**

**Message 3 — Branch question**
```
Before we proceed any further! Are you new to trading or this is your first time hearing about trading?
```

[ **I'm new to trading** ] [ **I have traded before** ]

---

**Branch: "I'm new to trading"**

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

[ **✅ I've watched it** ]

---

**Branch: "I have traded before"**

```
You've traded before? Say less. 💜

We're skipping the basics.

👇 Do you have an IQ Option account or not?
```

[ **✅ I have one** ] [ **🆕 Need a new one** ]

---

**✅ I have one flow:**

```
Bet. Let's link it up.

Drop your IQ Option User ID 👇
```

**How to find your User ID:**
1. Open IQ Option → Profile
2. Copy the 9-digit number under your name
3. Paste it here

**User pastes User ID → bot verifies**

*(if verified — continues to email → password → connect flow)*

*(if verification fails — one retry, then create new account)*

---

**🆕 Need a new one flow:**

```
Say less. 2 minutes and you're in.

👇 Create your free account here:
https://iqbroker.com/lp/regframe-01-light-nosocials/?aff=749367&aff_model=revenue

Use your real email. Once done, drop your User ID below.
```

*(same User ID → verify → email → password → connect flow)*

---

**After "I've watched it" — Account creation + connect**

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

**User pastes User ID**

```
⏳ Verifying your account...
```

*(if verification fails)*

```
❌ We couldn't verify that User ID @username.

Double-check and send it again 👇
```

[ **🔄 Try again** ]

**User retries → if verification fails again:**

```
❌ Still no luck @username.

Let's get you a fresh account the right way.

👇 Create one here:
https://iqbroker.com/lp/regframe-01-light-nosocials/?aff=749367&aff_model=revenue

Come back and drop your new User ID once done.
```

*(same connect flow after successful verification)*

*(if verified)*

```
✅ Account verified! You're good to go.

📧 Now enter your IQ Option email:
```

**User sends email**

```
🔑 Now enter your password:
```

**User sends password**

*(bot logs in, saves SSID + cred)*

```
✅ Connected @username! 💜

💰 Practice: $10,000.00

You're now locked in. The 10x Special Bot is live and ready.

👇 Tap below to take your first trade.

[ Take a trade 👾 ]
```

---

### Re-engagement Follow-ups (when user is unresponsive for 6h)

**Rules:**
- Trigger: 6 hours since last user action
- Frequency: every 6 hours until user responds
- Each new message auto-deletes the previous one
- After 2 weeks of no response: removed from broadcast list until they respond
- Messages include media (images, videos, TikTok/IG links) for FOMO

**📍 Stuck at: Entry (never tapped new/experienced)**

```
@username people are literally printing money with 10x right now.

Check this out 👆

While you're sitting here deciding, someone just cashed out.

👇 You new or you've traded before?
```

[ **I'm new** ] [ **I've traded before** ]
*[Image: win screenshot / lifestyle]*

**📍 Stuck at: "I'm new" video (never tapped "I've watched it")**

```
@username still haven't watched the video?

Real 10x users don't wait. They stack.

👇 5 minutes and you'll understand everything:
[video link]

External proof:
📱 TikTok: [link]
📸 Instagram: [link]
```

[ **✅ I've watched it** ]
*[Video: TikTok/IG clip]*

**📍 Stuck at: User ID (never sent it)**

```
@username while you're holding your User ID...

Someone else just hit +$2,400 today using 10x.

Your account is 2 minutes away from being in that same leaderboard.

Drop your User ID 👇
```
*[Image: leaderboard / payout screenshot]*

**📍 Stuck at: Email (after User ID verified)**

```
@username your account is verified. Door is open.

Just need your email and you're in.

Check what other 10x users are pulling daily 📸👇
📱 TikTok: [link]
📸 Instagram: [link]

Drop that email.
```
*[Image: withdrawal proof / funded account screenshot]*

**📍 Stuck at: Password (after email sent)**

```
@username one password away from being locked in.

The bot is live. Signals are hot.

Don't sit this one out. 🔑
```
*[Image: bot dashboard / trade wins]*

**📍 Connected but never traded**

```
@username you're connected but you haven't taken a single trade yet.

While you wait, 10x users are stacking daily.

📱 See what they're saying: [link]
📸 Real results: [link]

👇 Tap below. First trade is on the house.
```

[ **Take a trade 👾** ]
*[Video: TikTok/IG testimonial]*

---

### Post-Connect Funding Sequence

**Rules:**
- Starts after user connects and takes first trade
- Never stops until user funds their live account
- Triggers: every 2 demo trades, every 5 demo trades, every 10 demo trades + every 12h if idle
- Each new message auto-deletes the previous one
- If funded user's live balance hits $0 → sequence restarts
- Messages rotate between 6 templates (reviews, wins, lifestyle)
- Each message: media + short text + [ 💎 Fund now ] button → `https://iqoption.com/pwa/payments/deposit`
- Promo codes alternate: **10xfirst** (100% bonus) and **10xsecond** (150% bonus)

**Message 1 — Win screenshot**

```
@username this is what a funded account looks like.

Real money. Real withdrawal. Real life.

Use promo code 10xfirst for a 100% bonus when you fund 👇
```
[Image: big payout / withdrawal proof]

**Message 2 — Lifestyle video**

```
@username demo money disappears.

Real money buys real things.

Big difference.

Use code 10xsecond — 150% bonus on your first deposit.
```
[Video: luxury lifestyle / travel / car]

**Message 3 — Testimonial / review**

```
@username this could be your caption next week.

Same bot. Same strategy. Real results.

Promo: 10xfirst gives you 100% extra.
```
[Image: user testimonial / review screenshot]

**Message 4 — Payout proof**

```
@username imagine waking up to this.

Every. Single. Week.

That's what funded 10x users do.

Get 150% more with code 10xsecond 👇
```
[Image: withdrawal confirmation]

**Message 5 — Lifestyle photo**

```
@username the goal isn't more demo wins.

The goal is this. Right here.

One fund away. Use 10xfirst for 100% bonus.
```
[Image: nice car / dining / vacation]

**Message 6 — User result video**

```
@username real person. Real 10x user. Real money.

Your turn.

Don't forget: code 10xsecond doubles your deposit + 50%.
```
[Video: short testimonial clip / TikTok]

**Restart trigger:**
- System detects PRO/MASTER user with live balance ≤ $0
- Bot resets their funding sequence state
- Funding messages resume as if they just connected

**After 2 weeks of no response:**
No message. Removed from broadcast list. Re-included when user responds to any bot message.

---

## Update #3 — Admin Media Library

**Status:** ✅ Agreed

### Components:

**3a. New DB table: `sequence_media`**
- Columns: `id`, `template_key`, `media_type` (photo/video), `file_id`, `updated_at`
- One row per template key

**3b. New admin menu button: `[ 📁 Media Library ]`**
- Located in admin panel alongside existing tools

**3c. Template selection interface**
- Lists all re-engagement templates by name
- Admin taps template → bot shows current media (or "None") + prompts for new media

**Template keys:**
- `entry_stuck` — Welcome follow-up (win screenshot)
- `new_trader_video` — "I'm new" video reminder (TikTok/IG clip)
- `user_id_stuck` — User ID follow-up (payout screenshot)
- `email_stuck` — Email follow-up (withdrawal proof)
- `password_stuck` — Password follow-up (bot dashboard)
- `never_traded` — Connected but never traded (testimonial video)

**3d. Upload flow**
- Admin sends photo or video → bot saves `file_id` to `sequence_media` table for that template
- If media existed before, replaces it
- Confirmation message with thumbnail preview

**3e. Automatic fallback**
- If no custom media uploaded for a template → uses default placeholder
- If custom media exists → picks `file_id` from DB when sending follow-up

**3f. Future: Preview button** (optional enhancement)
- "Preview" next to each template shows what the message + media looks like
