# IQ Bot V3 → V4 — Complete Specification & Architecture Plan

**Date:** 2026-05-21  
**Status:** PLANNING — No code written  
**Author:** Wizard (Hermes Agent)  
**Target:** Push to GitHub for Claude implementation

---

## 1. THREE-TIER SYSTEM (Replaces current NEWBIE/PRO)

### 1.1 Tier Definitions

| Feature | Demo Trader | Pro Trader | Master Trader |
|---------|:---:|:---:|:---:|
| Pairs available | 2 | 4 | All |
| Concurrent trades | 1 | 2 | Up to 5 |
| Timeframes | 5M only | 1M, 5M | 30s, 1M, 5M |
| Smart Recovery | 6 or 3 gale only | 6 or 3 gale only | Can turn off entirely |
| Leaderboard | ❌ | ✅ | ✅ |
| Giveaway participation | View only | ✅ Participate | ✅ Participate |
| History | ✅ | ✅ | ✅ |
| Stats | ✅ | ✅ | ✅ |
| Help & FAQ | ✅ | ✅ | ✅ |
| Support | ✅ | ✅ | ✅ |

### 1.2 Pair Assignments

| Pair | Demo | Pro | Master |
|------|:---:|:---:|:---:|
| EUR/USD-OTC | — | ✅ | ✅ |
| GBP/USD-OTC | — | ✅ | ✅ |
| EUR/JPY-OTC | ✅ | ✅ | ✅ |
| GBP/JPY-OTC | — | ✅ | ✅ |
| USD/CAD-OTC | ✅ | ✅ | ✅ |
| AUD/USD-OTC | — | — | ✅ |
| EUR/GBP-OTC | — | — | ✅ |
| All others | — | — | ✅ |

### 1.3 DB Changes

```sql
ALTER TABLE users ADD COLUMN tier TEXT NOT NULL DEFAULT 'DEMO';
-- Values: 'DEMO', 'PRO', 'MASTER'
-- Migrate existing: 'NEWBIE' → 'DEMO', 'PRO' stays 'PRO'
```

### 1.4 Trade Restrictions Enforcement

In `src/bot.ts`:
- `mode:demo|live` handler → check tier, restrict timeframe keyboard
- `tf:*` handler → validate timeframe against tier
- `pair:*` handler → validate pair against tier, validate concurrent count
- `runMartingale` → if Master + gale off, skip martingale entirely
- `ui:leaderboard` → hide/show based on tier
- `ui:upgrade` → show 3 tiers with token activation

---

## 2. AUTO ACCOUNT CREATION FOR FAILED VERIFICATION

### 2.1 Flow

```
User enters IQ User ID → fails verification
  ↓
User creates account → enters new ID → fails again
  ↓
Bot: "Would you like us to create an account for you?"
  → User provides email (must be unused)
  → Bot calls IQ Option API to register account
  → Returns email + password to user
  → Auto-approves
  → SSID connected automatically
  → User can trade immediately
```

### 2.2 Technical

Requires IQ Option API endpoint for account creation. Currently using Quadcode SDK — need to verify if the SDK or HTTP API supports account registration.

Alternative: If IQ Option API doesn't support programmatic account creation, direct user to IQ Option signup with affiliate link.

### 2.3 New Files

- `src/account-creator.ts` — Account creation logic
- Integration with `/connect` onboarding flow

---

## 3. GIVEAWAY SYSTEM V2

### 3.1 Giveaway Types

| Type | Eligibility | Action on Participate |
|------|-----------|----------------------|
| **Open** | Pro + Master only | Just clicks participate |
| **New Users** | Pro + Master, account < 1 week old | Age check |
| **Balance Required** | Pro + Master, live balance >= $X | Balance check via SDK, denied + deposit link if below |
| **Top Traders** | Pro + Master, top N by trade count in 24h | Bot monitors trades, martingale excluded |

### 3.2 Participation Flow

```
Admin schedules giveaway with criteria
  ↓
Bot broadcasts giveaway to eligible users (random intervals, batched)
  ↓
Users see "Participate" button
  ↓
On click:
  - Check tier (Pro/Master only, Demo gets "upgrade to participate")
  - Check criteria (age, balance, etc.)
  - If fail: show reason + CTA (deposit, etc.)
  - If pass: add to participants list
  ↓
During giveaway:
  - Bot sends motivational messages at random intervals
  - "Giveaway still on, participate now for chance to win $XXX"
  - Live participant count updates (batched, random intervals)
  ↓
When giveaway ends:
  - Select winners based on criteria
  - Notify winners
  - Post results
```

### 3.3 Batched Update Logic

When a giveaway is active, update participants in staggered batches:

```
Total participants: 70
  Minute 0:  Notify 16 people (random)
  +40s:      Notify 2 people
  +4 min:    Notify 28 people
  +2 min:    Notify 8 people
  +30s:      Notify 6 people
  +5 min:    Notify 10 people
```

Each batch: random size (2-30), random interval (30s - 5min between batches).

### 3.4 Motivational Messages

Auto-generated at random intervals during active giveaway:

| Trigger | Template |
|---------|----------|
| Giveaway still open | "⚡ Giveaway is still ON. You still have a chance to win ${prize}. Participate now." |
| Time running out | "⏰ Winners selected soon. Last chance to join. ${prize} could be yours." |
| Low participation | "👀 Only ${count} traders participating. Your odds are incredible right now." |
| Trade contest reminder | "📊 ${user} just hit ${trades}/10 trades. You're at ${userTrades}. Keep going." |

### 3.5 DB Tables

```sql
CREATE TABLE giveaways (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,           -- 'open', 'new_users', 'balance', 'top_traders'
    prize_description TEXT,
    prize_amount REAL,
    criteria_json TEXT,           -- { min_balance: 20, max_account_age_days: 7, min_trades: 10 }
    starts_at TEXT,
    ends_at TEXT,
    status TEXT DEFAULT 'scheduled',  -- 'scheduled', 'active', 'ended'
    created_by INTEGER,          -- admin telegram_id
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE giveaway_participants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    giveaway_id INTEGER REFERENCES giveaways(id),
    telegram_id INTEGER,
    status TEXT DEFAULT 'pending',  -- 'pending', 'accepted', 'denied', 'winner'
    deny_reason TEXT,
    trade_count INTEGER DEFAULT 0, -- for top_traders type
    joined_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE giveaway_updates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    giveaway_id INTEGER REFERENCES giveaways(id),
    batch_size INTEGER,
    sent_at TEXT DEFAULT (datetime('now'))
);
```

---

## 4. AUTOMATED BROADCAST SYSTEM

### 4.1 Fixed Promotional Messages (10 daily, random intervals)

Messages auto-broadcast to all users inactive for >= 2 hours:

| # | Message |
|---|---------|
| 1 | "👀 Want to see the bot actually trade? Demo mode is risk-free. One tap, one signal, one trade. Watch it work 👇" |
| 2 | "💸 Another 10x user just banked +$270 CASH. Same bot. Same signals. Real money. You're still on demo coins. Switch up 👇" |
| 3 | "📊 71% of demo users upgraded to LIVE this week. They didn't guess. They watched the bot win on demo first. Then they switched. Run your demo trade 👇" |
| 4-10 | (To be composed, similar persuasive style) |

Each message includes an image. Admin provides the image files.

### 4.2 LLM-Powered Motivational Messages (Admin Approval)

Admin flow:

```
Admin clicks "Send Motivational" button
  ↓
Bot: "Choose category: [Reviews] [Motivation] [Trade Wins] [Life Wins] [Other]"
  ↓
Bot: "Describe in 10 words or less:"
  Admin: "made $263 within 2 weeks of trading"
  ↓
LLM generates message (catchy, persuasive)
  ↓
Bot: "Add image? Upload or skip"
  ↓
Bot: "Approve? [Send] [Edit] [Cancel]"
  ↓
On approval: "Send to: [Channel only] [Bot users only] [Both]"
  ↓
Broadcast to selected targets
```

### 4.3 LLM Integration

```
OpenRouter API: https://openrouter.ai/api/v1/chat/completions
Model: deepseek/deepseek-v4-flash (free) or gemini-2.0-flash-001
Prompt template: "Write a persuasive, catchy Telegram message for a trading bot community. Topic: {topic}. Description: {description}. Style: motivational, pushes intent to trade. Under 200 words."
```

### 4.4 Scheduled Broadcast System

Admin can schedule broadcasts:
- Type: "Automated" (fixed messages) or "Manual" (admin-composed)
- Interval: random within configured window
- Target: all users inactive > N hours
- Or: specific tiers only

---

## 5. CHANNEL INTEGRATION

### 5.1 Auto-Approve Channel Join Requests

```
User clicks funnel link → lands on channel join page
  → Clicks "Join Channel" (approval-only link)
  → Bot detects chat_join_request update
  → Auto-approves user
  → Bot sends welcome message with /start CTA
```

Telegram Bot API: `approveChatJoinRequest` + `chat_join_request` update handler.

### 5.2 Meta Ads Pixel Integration

When a user joins the channel via funnel link, send conversion event to Meta pixel:

```
POST https://www.facebook.com/tr?id={PIXEL_ID}&ev=Lead&noscript=1
```

This feeds Meta's algorithm with actual conversion data.

### 5.3 Auto-Message New Members

```
User joins channel → auto-approved → immediate welcome message:
"Welcome to 10x Signals! 🚀 Tap /start to begin trading. 
The bot will guide you through setup."
```

If no user interaction within 20 minutes → follow-up: "Need help? Contact admin: @shiloh_is_10xing"

New users who haven't completed onboarding yet get a simplified CTA that leads directly to account connection.

---

## 6. LLM SYSTEM MONITOR

### 6.1 Purpose

An LLM-trained monitoring agent that watches the entire system. When any major functionality drops, it notifies Telegram immediately.

### 6.2 Monitored Metrics

- Bot online/offline status
- PM2 process health
- IQ Option API reachability
- Database integrity
- Telegram API connectivity
- Trade execution success rate
- Callback handler error rate
- SDK pool connection health

### 6.3 Implementation

Cron job (every 5 minutes) that:
1. Checks all health metrics
2. Feeds status to LLM via OpenRouter
3. LLM determines if alert is needed
4. If alert: sends graded message to admin
   - 🔴 CRITICAL: immediate ping
   - 🟡 WARNING: single message
   - 🟢 INFO: summary every 6 hours

### 6.4 Alert Templates

```
🔴 CRITICAL: IQ Option API unreachable for 10+ minutes.
Last successful connection: 15 min ago.
Affected users: 75. Restarting bot automatically.

🟡 WARNING: 3 users experienced trade timeouts in last hour.
Error rate: 4% (threshold: 2%).

🟢 INFO: System healthy. 75 users, 24 trades today, 92% win rate.
Uptime: 48h. Memory: 62MB.
```

---

## 7. MAJOR UI/UX UPDATE

### 7.1 Areas to Improve

1. **Button responsiveness** — Already addressed (SDK pool + webhook option)
2. **Error messages** — More specific, actionable (e.g., "Your balance is $8. Deposit $12 more to trade" instead of generic error)
3. **Onboarding flow** — Smoother, fewer steps, auto-detect account creation
4. **Trade feedback** — Real-time trade progress, better win/loss animations
5. **Menu organization** — Cleaner tier-aware menus, fewer buttons
6. **Giveaway UX** — Interactive participation with live updates
7. **Settings page** — Consolidated, tier-aware settings

### 7.2 Proposed Menu Structure

```
10x — Home
├── Tier: ⚡ MASTER | Balance: $1,234.56
├── Session: 12 trades · +$456.78
│
├── [🎯 Trade]           → Trade wizard
├── [📊 History]          → Recent trades
├── [📈 Stats]            → Win rate, PnL, graphs
├── [🏆 Leaderboard]      → Top traders (Pro+ only)
├── [🎁 Giveaways]        → Active + upcoming (View for Demo, Participate for Pro+)
├── [⚙️ Settings]          → Smart Recovery, account, tier
├── [💡 Upgrade]          → Token entry
├── [❓ Help & FAQ]       → FAQ text
└── [🔋 Support]          → Admin contact
```

---

## 8. IMPLEMENTATION ORDER (Dependencies)

### Phase 1: Foundation
1. **Tier system DB migration** (add new tier values, migrate existing)
2. **Tier-aware menus** (show/hide based on tier)
3. **Tier-aware trade restrictions** (pairs, concurrent, timeframes)
4. **Account auto-creation** (IQ Option API integration)

### Phase 2: Giveaways
5. **Giveaway DB schema** (tables)
6. **Admin giveaway scheduling UI**
7. **Giveaway participation flow**
8. **Batched update notification system**
9. **Motivational message scheduler**

### Phase 3: Broadcasts
10. **Fixed message library** (10 messages + images)
11. **Inactivity detection** (>2h check)
12. **Random interval scheduler**
13. **LLM message generation module**
14. **Admin approval flow**

### Phase 4: Channel
15. **Channel join request handler**
16. **Auto-approval logic**
17. **Meta pixel integration**
18. **Welcome message funnel**

### Phase 5: Monitoring
19. **System health cron job**
20. **LLM monitor agent**
21. **Alert system**

### Phase 6: UI/UX Polish
22. **Menu redesign**
23. **Error message overhaul**
24. **Trade flow improvements**

---

## 9. FILES TO CREATE

| File | Purpose |
|------|---------|
| `src/tiers.ts` | Tier definitions, restrictions, pair assignments |
| `src/giveaways-v2.ts` | New giveaway system |
| `src/broadcasts.ts` | Automated broadcast scheduler |
| `src/llm.ts` | OpenRouter LLM integration |
| `src/channel.ts` | Channel integration handlers |
| `src/monitor.ts` | LLM system monitor |
| `src/account-creator.ts` | IQ Option account auto-creation |

## 10. DB MIGRATIONS

```sql
-- Tiers
ALTER TABLE users ADD COLUMN tier TEXT NOT NULL DEFAULT 'DEMO';
UPDATE users SET tier = 'DEMO' WHERE tier = 'NEWBIE';

-- Giveaways V2
CREATE TABLE IF NOT EXISTS giveaways_v2 (...);
CREATE TABLE IF NOT EXISTS giveaway_participants (...);
CREATE TABLE IF NOT EXISTS giveaway_updates (...);

-- Broadcasts
CREATE TABLE IF NOT EXISTS broadcast_messages (...);

-- Channel
CREATE TABLE IF NOT EXISTS channel_members (...);
```

---

## 11. OPEN QUESTIONS

1. **IQ Option account creation API** — Does the Quadcode SDK or IQ Option HTTP API support programmatic account registration? If not, alternative is affiliate link redirect.

2. **LLM model choice** — Which OpenRouter model for message generation? Deepseek V4 Flash (free, fast) or Gemini 2.0 Flash (cheap, good creative writing)?

3. **Channel ID** — What's the channel username/ID to integrate?

4. **Meta Pixel ID** — Need the pixel ID for conversion tracking.

5. **Budget** — All OpenRouter calls cost tokens. Estimate: ~1,000 messages/month × ~200 tokens = 200K tokens. Deepseek V4 Flash is free on OpenRouter free tier.

---

**Status:** READY FOR CLAUDE IMPLEMENTATION  
**Next step:** Push to GitHub. Claude implements Phase 1 (Tiers + Account Creation).
