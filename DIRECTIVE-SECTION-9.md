# Directive — Section 9: Full Telegram UI Overhaul + Image Integration

## Goal
Replace the current text-only Telegram UI with an image-driven, rich flow for both client and admin panels.

## Image Assets
All images stored in `/root/iqbot-v3/assets/`:
- L1.png through L13.png
- L9a.png, L9b.png (2 images for L9)
- L11a.png, L11b.png, L11c.png (3 images for L11)

Send images using `ctx.replyWithPhoto({ source: '/root/iqbot-v3/assets/L1.png' })`.

---

## 1. Client Flow — Full Overhaul

### On `/start` (unapproved user)

**Step 1 — Welcome (L1 + L2)**
```
[Send L1.png]
Msg: I'm 10x Special Bot.

The smartest semi auto-trading bot for IQ Option OTC pairs.

I scan markets. I read signals. I place trades.
You sit back and watch the wins land.

[Send L2.png]
Msg: ⚡ Built for serious traders.
🎯 Trades 8+ OTC pairs.
🛡️ Smart Gale recovery.
💰 Withdraws straight to your own IQ Option account.
```

**Step 2 — Tier Selection (L3)**
```
[Send L3.png]
Msg: Three ways to start 👾

✅ The bot itself is completely free.

What you fund is your own IQ Option trading capital.
It stays in your account, you trade with it, you withdraw it.

🧪 DEMO — try the bot risk-free
🚀 Newbie — trade with $20+ capital
⚡ PRO — trade with $100+ capital

How are you starting? 👇

Buttons: [🧪 DEMO — try the bot risk-free] [🚀 Newbie — trade with $20+ capital] [⚡ PRO — trade with $100+ capital]
```
On click, save tier to user state. All three tiers proceed to same account connection flow.

**Step 3 — Account Connection (L3)**
```
Msg: Connect your IQ Option account.

Free signup · 60 seconds · Linked instantly.
Bot trades on your account. Money stays yours.

Pick what fits 👇

Buttons:
[✅ I have an IQ Option account]
[🆕 Create one free (takes 2 min)]
```

**Step 3a — I have an account**
```
Msg: 🔢 Enter your IQ Option User ID

How to find it:
Open IQ Option → Profile → copy the numeric User ID 🆔

Then paste that here 👇👾
```
User inputs User ID. On text received, run `checkAffiliate(iqUserId)` (existing GramJS function).

**User ID approved** → proceed to /connect step (email/password)
**User ID not found** →
```
Msg: ⏳ We were not able to confirm your User ID.

Please consider creating a new account the right way using our link 👇👾

You can as-well contact admin 👇💜

Buttons:
[🆕 Create free account (takes 2 min)]
[👾 Contact admin]
```

**Step 3b — Create free account (or clicked from failure msg)**
```
Msg: 👉 Create your IQ Option account
👉 [Create your IQ Option Account](https://iqbroker.com/lp/regframe-01-light-nosocials/?aff=749367&aff_model=revenue)
Click Above 👆🏼👾

🔢 Once your account is created, enter your User ID here:

How to find it:
Open IQ Option → Profile → copy the numeric User ID 🆔

Then paste that here 👇👾
```

**Step 4 — /connect (auto-triggered after User ID approval)**
```
Msg: ✅ Account verified! You're all set.

📧 Enter your IQ Option email:
```
User enters email.
```
Msg: 🛡️ Your password is safe

We use the official IQ Option API.
We can't read or store it.
Your message auto-deletes from this chat in 10 seconds.

[Send L4.png]
```
User enters password. Delete password message immediately (existing). On success:
```
Msg: ✅ Connected!

🎮 Practice: $X.XX
💎 Live: $X.XX
```
On failure:
```
Msg: Sorry we're unable to retrieve your account details 😨

Please re-check your account email or password and try again 👇

(If it fails again, immediately):
Msg: Seems you're having trouble logging into your IQ Options Account 👾😨

No worries we're here to assist you. Contact admin below 👇💜

Button: [👾 Contact admin]
```

**Step 5 — Main Menu (after successful login)**
```
Msg: MoneyGBT — Home

Tier: 🧪 Newbie  ·  
Mode: Newbie
Balance: Practice $9,937.22 | Real $293,939
Session: 1 trades  ·  +$4.60

What now? 👇

Buttons:
[Take a trade 👾]
[History 📆]
[Stats 📈]
[Upgrade 💡]
[Help & FAQ ❓]
[Support 🔋]
```
- Upgrade → Contact admin
- Help & FAQ → FAQ text
- Support → Admin contact link

---

### 2. Trade Flow

**Step 1 — Trade / Demo toggle (L4)**
```
[Send L4.png]
Msg: Trade live | Trade Demo

Buttons: [Trade Live] [Trade Demo]
```
User selection stored as mode.

**Step 2 — Amount (L5)**
```
[Send L5.png]
Msg: Enter amount

Amount keyboard (existing)
```
Demo max: $20. Live: unlimited.

**Step 3 — Timeframe (L6)**
```
[Send L6.png]
Msg: Pick your expiry timeframe 👇
⏱ Faster timeframes settle quicker.
🐢 Longer timeframes ride bigger moves.

Buttons: [30s] [1m] [5m]
```

**Step 4 — Pair selection (L7)**
```
[Send L7.png]
Msg: Top picks ready 🎯

Highest chance to win right now:

🏆 EUR/GBP OTC — Win rate ≈83%
✅ EUR/USD OTC — Win rate ≈78%
✅ AUD/USD OTC — Win rate ≈70%
✅ USD/BRL OTC — Win rate ≈66%

🚀 Make your choice below 👇

Pair keyboard (existing 8 OTC pairs)
```
(Replace USD/BRL with actual highest-confidence pair from analysis if available)

**Step 5 — Confirmation (L8)**
```
[Send L8.png]
Msg: Selected: EUR/USD OTC
Confidence: 78%

How much do you want to trade?
demo max amount is $20, live max amount is limitless
```
On amount click:
```
[Send L9a.png or L9b.png based on direction]
Msg: 🔍 Scanning markets...
```
(Pause for analysis, then)
```
[Send L8.png again? Or L9 specific signal image]

Msg: OPPORTUNITY FOUND
Confidence: 78%  ·  Bot is ready to execute.

🔴 PUT SIGNAL or 🟢 CALL SIGNAL

🔷 Trading pair: EUR/USD OTC
🔷 Amount: $5.00 USD
🔷 Expiration: 30s
🔷 Strategy: High-Profit ⚡
```

---

### 3. Martingale Display — New Format

Replace current martingale messages with:

**Trade starting:**
```
✦ Trade session initialized…
⚡ Trade 1|Step 1|🟡 $5.00 → in flight
```

**On loss (enter gales):**
```
[Send L10.png]
Msg: SMART RECOVERY ACTIVATED
Bumping the next stake. Bot fights back.

✦ Trade session initialized…
⚡ Trade 1|Step 1|🔴 $5.00 → -$5.00
⚡ Trade 1|Step 2|🟡 $11.50 → in flight
```

**On win (martingale complete):**
```
[Send L11a/b/c as appropriate]

🏆 +$7.83 added to your balance.

Recovery complete on step 3/6.

💸 You just made +$7.83
```

**Direct win (first round):**
```
✦ Trade session initialized…
⚡ Trade 1|Step 1|🟢 $5.00 → +$4.60

🏆 +$4.60 added to your balance.

💸 You just made +$4.60
```

**Loss after all rounds:**
```
Msg: Lost this one 💔! Remain confident! New setup loading 👾
```

**Winning streak:**
Use L11a (win), L11b, L11c as appropriate.

---

### 4. Demo → Live Upsell (L12, L13)

Only shown if user is trading on DEMO.

```
[Send L12.png]
Msg: WHAT IF THIS WAS REAL?

While you read this…

real 10x users just banked +$7.83 CASH from the exact same setup.

Every minute on demo = real profit lost.

[Send L13.png]
Msg: Time to earn real money.
Fund your IQ Option account, wins land in your bank, withdraw anytime.

Switch to LIVE in 1 tap 👇

Buttons:
[Switch to live 🔋 earn real money]
[Continue demo 🪫 keep testing]
```

Switch to Live → toggle mode to 'live' for next trade.
Continue Demo → dismiss, next trade stays demo.

---

## 5. Admin UI (To Be Defined Later)

Section 10 will cover the admin dashboard overhaul. For now, admin dashboard stays as-is with the basic stats and user management.

---

## Implementation Order

1. Update bot.ts: import assets, send images in flow
2. Update menu.ts: new keyboards (tier selection, trade/demo toggle)
3. Update ui/user.ts: new main menu keyboard (Take a trade, History, Stats, Upgrade, Help, Support)
4. Update onboarding flow: tier selection → account connection → /connect
5. Update trade flow: pair selection → L4-L9 images → new martingale messages
6. Update martingale display: new format with L10-L11 images
7. Add demo→live upsell: L12-L13 after demo trades
8. Update env vars for affiliate link change (iqbroker.com instead of iqoption.net)

## New/Changed Env Vars
```
AFFILIATE_LINK=https://iqbroker.com/lp/regframe-01-light-nosocials/?aff=749367&aff_model=revenue
ADMIN_CONTACT_LINK=https://t.me/shiloh_is_10xing
```
