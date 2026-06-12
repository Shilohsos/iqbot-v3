# MASTER DIRECTIVE — Product Restructure: Signals, AI Trading, Auto Trading

**IMPORTANT: Merge master first** — this directive is pushed to master. If you're on a feature branch, `git merge origin/master` before implementing.

---

## Overview

Replace the tier system (DEMO/PRO/MASTER) with a product-based access model. Users get access to **Signals**, **AI Trading**, or **Auto Trading** based on their funded balance — not by tier tiers. This simplifies the UX and creates a clear upgrade ladder.

**Products:**
| Product | What it does | Min Balance | Max Daily Signals |
|---------|-------------|-------------|-------------------|
| Signals | Displays analysis results only (no trade execution) | $0 (anyone) | 30 unfunded / unlimited funded |
| AI Trading | Current semi-auto trading system (analyze + execute with settings) | $30 funded | — |
| Auto Trading | Full autonomous trading — picks assets, timeframes, executes continuously | $100 funded | — |

**Gate logic:**
- **$0 balance**: Signals only (30/day cap)
- **Any funded ($1+)**: Signals unlimited (no cap)
- **$30+ funded**: AI Trading unlocked (alternative: upgrade token)
- **$100+ funded**: Auto Trading unlocked (alternative: upgrade token)
- **Upgrade tokens** still work for AI Trading ($30 equivalent) and Auto Trading ($100 equivalent) — override the balance check

---

## Section 1: Remove Tier System

### 1.1 Delete `src/tiers.ts`
The entire file goes away. Every import of `getTierConfig`, `normalizeTier`, `autoPromoteTier`, `TIER_CONFIGS`, `convertToUsd`, `TierConfig` from other files must be replaced.

### 1.2 DB changes
Remove/ignore the `tier` column from `users` table. Add these new columns:
- `access_level` TEXT DEFAULT 'signals' — one of: `signals`, `ai_trading`, `auto_trading`
- `signals_used_today` INTEGER DEFAULT 0
- `signals_date` TEXT — tracks date for daily reset
- `funded_balance_usd` REAL DEFAULT 0 — cached USD equivalent of funded balance

Migration query:
```sql
ALTER TABLE users ADD COLUMN access_level TEXT NOT NULL DEFAULT 'signals';
ALTER TABLE users ADD COLUMN signals_used_today INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN signals_date TEXT;
ALTER TABLE users ADD COLUMN funded_balance_usd REAL NOT NULL DEFAULT 0;
```

### 1.3 Remove all tier-related code
Everywhere in bot.ts, db.ts, menu.ts, ui/user.ts, ui/admin.ts that references:
- `tier` column (replace with `access_level`)
- `getTierConfig()` (replace with product access check)
- `normalizeTier()` (no longer needed)
- `autoPromoteTier()` (no longer needed)
- `TIER_CONFIGS` (delete)
- `TierConfig` interface (delete)
- `canViewLeaderboard` / `canParticipateGiveaway` / `demoUpsellEnabled` — simplify or remove
- The periodic tier check loop (bot.ts ~5425-5450) — remove entirely
- All auto-promotion logic in /start and /balance handlers — remove entirely

### 1.4 What replaces the tier config
Create a new `src/access.ts` with:
```typescript
export type Product = 'signals' | 'ai_trading' | 'auto_trading';

export interface ProductConfig {
    label: string;
    maxConcurrentTrades: number;
    allowedTimeframes: number[];
    allowedGaleOptions: number[];
    galeCanDisable: boolean;
    defaultGaleRounds: number;
    pairs: string[];
}

export const PRODUCT_CONFIGS: Record<Product, ProductConfig> = {
    signals: {
        label: 'Signals',
        maxConcurrentTrades: 0, // signals don't trade
        allowedTimeframes: [30, 60, 300],
        allowedGaleOptions: [0, 3, 6],
        galeCanDisable: true,
        defaultGaleRounds: 6,
        pairs: ['EURUSD-OTC', 'GBPUSD-OTC', 'EURJPY-OTC', 'GBPJPY-OTC', 'AUDUSD-OTC', 'USDCAD-OTC', 'EURGBP-OTC', 'USDCHF-OTC'],
    },
    ai_trading: {
        label: 'AI Trading',
        maxConcurrentTrades: 5,
        allowedTimeframes: [30, 60, 300],
        allowedGaleOptions: [0, 3, 6],
        galeCanDisable: true,
        defaultGaleRounds: 6,
        pairs: ['EURUSD-OTC', 'GBPUSD-OTC', 'EURJPY-OTC', 'GBPJPY-OTC', 'AUDUSD-OTC', 'USDCAD-OTC', 'EURGBP-OTC', 'USDCHF-OTC'],
    },
    auto_trading: {
        label: 'Auto Trading',
        maxConcurrentTrades: 1, // 1 position at a time
        allowedTimeframes: [30, 60, 300],
        allowedGaleOptions: [0, 3, 6],
        galeCanDisable: true,
        defaultGaleRounds: 6,
        pairs: ['EURUSD-OTC', 'GBPUSD-OTC', 'EURJPY-OTC', 'GBPJPY-OTC', 'AUDUSD-OTC', 'USDCAD-OTC', 'EURGBP-OTC', 'USDCHF-OTC'],
    },
};

export function getProduct(accessLevel: string): Product {
    const key = accessLevel?.toLowerCase() ?? 'signals';
    if (key === 'auto_trading' || key === 'ai_trading') return key as Product;
    return 'signals';
}
```

### 1.5 Balance gating function
Add to `src/access.ts`:
```typescript
export function getAccessLevel(fundedUsd: number): 'signals' | 'ai_trading' | 'auto_trading' {
    if (fundedUsd >= 100) return 'auto_trading';
    if (fundedUsd >= 30) return 'ai_trading';
    return 'signals';
}
```

---

## Section 2: New Menu System

### 2.1 /start menu
Replace the current menu with:
```
10x — Home

Access: Signals 📡
Balance: Practice $X | Real ₦X
Session: X trades · +/-$X

⚡ Signals   🤖 AI Trading   🚀 Auto Trading
🎁 Giveaways   ❓ Help & FAQ   🔋 Support
```

Locked products show as `🔒 AI Trading` or `🔒 Auto Trading` with a note saying the minimum deposit needed.

Show the remaining daily signals count when on Signals access: `"30 signals remaining today"`

### 2.2 `sendStartMenu()` function
Rewrite to check the user's `access_level` from DB and display the appropriate menu. Remove all tier references.

The menu keyboard function (`startKeyboard`) should render buttons based on what's unlocked:
- If `access_level === 'signals'`: show Signals unlocked, AI/Auto locked
- If `access_level === 'ai_trading'`: show Signals + AI unlocked, Auto locked
- If `access_level === 'auto_trading'`: show all three unlocked

---

## Section 3: Signals System

### 3.1 Signals flow
When user taps **Signals** from menu:
1. Check daily signal count (if unfunded, max 30/day)
2. If over limit: "You've used all 30 signals today. Fund $10+ for unlimited signals."
3. If under limit: run the same analysis as current system
4. Display the result as a formatted signal card (analysis ONLY — no trade execution)
5. Increment `signals_used_today` counter
6. Offer button: "Get Another Signal 🔄"

### 3.2 Signal card format
```
📡 EURUSD-OTC SIGNAL

🎯 Accuracy: 87%

⏳ Expiry: 2 minutes
📈 Direction: CALL 🟢
➡️ Entry: 7:37 PM

↪️ Smart Recovery:
• Level 1 → 7:39 PM
• Level 2 → 7:41 PM
• Level 3 → 7:43 PM

— Signal 3/30 today —
```

Master said: "Can be better" — add whatever visual improvements Claude thinks fit.

### 3.3 Signal execution vs display
Signals do NOT execute trades. They ONLY run analysis and display the result. No amount selection, no currency selection, no balance type selection.

### 3.4 Daily signal limit
- Track in `signals_used_today` and `signals_date` columns
- Reset daily (compare `signals_date` against today's date)
- **If user has any funded balance** (`funded_balance_usd > 0`), no limit
- **If user has no funded balance** ($0), cap at 30/day

### 3.5 Signal counter display
Show remaining signals in the menu and signal card.

---

## Section 4: AI Trading System

### 4.1 What it is
The **current trading system** — essentially unchanged. User selects asset, timeframe, amount, currency, sets martingale, and the bot executes.

### 4.2 Changes needed
- Remove tier-based restrictions on pairs/timeframes (all pairs and timeframes available since tiers are gone)
- Keep max concurrent trades at 5 (from product config)
- Gate access: only available if user's `access_level >= 'ai_trading'` (funded $30+)
- If locked: show "🔒 AI Trading requires $30+ funded. Fund your account or use an upgrade token."

### 4.3 Flow
Same as current: mode → currency → amount → timeframe → pair → analysis → trade → result

---

## Section 5: Auto Trading System

### 5.1 What it is
Full autonomous trading. User sets parameters once, the bot runs continuously.

### 5.2 Auto Trading menu
When user taps **Auto Trading** from main menu:
```
🚀 Auto Trading

Status: ⏸️ Stopped

Configure your auto trader below.
```

Buttons:
```
▶️ Start Auto Trading
⚡ Auto God Mode
🔧 Settings
📊 Performance
```

### 5.3 Start flow
When user taps **Start Auto Trading**:

1. **Select Currency** — same currency selection as current system (NGN/USD/EUR/GBP)
2. **Enter Amount** — amount per trade (same amount selection as current system)
3. **Select 3 Assets** — user picks 3 assets from the full pair list that the AI will trade
4. **Select Timeframe** — 30s / 1m / 5m
5. **Select Smart Recovery**:
   - 0 — No smart recovery
   - 3 — 3 rounds
   - 6 — 6 rounds
6. **Confirmation screen** showing all settings:
   ```
   🚀 Auto Trading Configuration
   
   Currency: $ USD
   Amount: $25 per trade
   Assets: EURUSD, GBPUSD, AUDUSD
   Timeframe: 1m
   Smart Recovery: 3 rounds
   
   ▶️ Start Trading
   ```
7. User confirms → trading begins

### 5.4 Auto Trading execution rules
- Only **1 position open at a time** — never open a second trade while one is running (across ALL selected assets)
- **No duplicate asset trades** — don't open an EURUSD trade if EURUSD is already in position
- Trades cycle through the 3 selected assets in order
- After a trade closes (win/loss/tie), wait for next candle before opening the next
- **Smart Recovery** applies when enabled: if a trade loses, martingale on the same asset until recovery or max rounds hit, then move to next asset
- The bot should handle the case where all assets have been traded and cycle back to the first
- **No demo/live mode selection** — Auto Trading always trades on **LIVE** balance only

### 5.5 Auto Trading state persistence
- Store active auto trading sessions in a new DB table `auto_trading_sessions`:
  ```sql
  CREATE TABLE auto_trading_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id INTEGER NOT NULL UNIQUE,
      currency TEXT NOT NULL,
      amount REAL NOT NULL,
      assets TEXT NOT NULL, -- JSON array of 3 asset names
      timeframe INTEGER NOT NULL,
      gale_rounds INTEGER NOT NULL DEFAULT 3,
      status TEXT NOT NULL DEFAULT 'running', -- running, paused, stopped
      current_asset_index INTEGER NOT NULL DEFAULT 0,
      trades_done INTEGER NOT NULL DEFAULT 0,
      pnl REAL NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_trade_at TEXT,
      UNIQUE(telegram_id)
  );
  ```

### 5.6 Stop/control
- User can stop auto trading from the Auto Trading menu
- Stop after current trade finishes (no force-close)
- When stopped, save state so user can resume later

---

## Section 6: Auto God Mode ⚡

### 6.1 What it is
Account analysis that creates a complete trading plan for the user. One-click setup.

### 6.2 Flow
When user taps **Auto God Mode**:

1. Bot fetches user's live balances via SDK (`sdk.balances()`)
2. Analyzes the account:
   - **Detect currency** automatically (from real balance currency)
   - **Recommended amount per trade**: 2-5% of real balance
   - **Recommended 3 assets**: pick the 3 most volatile OTC pairs currently (closest to 50 RSI for mean-reversion or trending strongly)
   - **Recommended timeframe**: based on balance size (smaller balance → shorter TF for faster compounding)
   - **Recommended smart recovery**: based on risk assessment
3. Shows the user a plan:
   ```
   ⚡ Auto God Mode — Your Trading Plan
   
   💰 Account: ₦512,350.00 NGN
   📊 Recommended amount: ₦12,000/trade (2.3%)
   🎯 Recommended assets: EURUSD-OTC, GBPUSD-OTC, AUDUSD-OTC
   ⏳ Recommended timeframe: 1m
   🔄 Smart Recovery: 3 rounds
   
   ✅ Approve & Start
   🔧 Customize
   ```
4. User can **Approve & Start** (executes immediately) or **Customize** (modify any setting)
5. God mode should adapt recommendations based on account size — bigger accounts get more conservative amounts

---

## Section 7: Existing User Migration

For all current users in the DB:

| Current Tier | Current Balance | New Access Level |
|-------------|----------------|-----------------|
| DEMO | Any | `signals` (AI/Auto locked, 30 signals/day) |
| PRO | Any | `ai_trading` unlocked. Auto locked unless balance >= $100 |
| MASTER | Any | `ai_trading` unlocked. Auto locked unless balance >= $100 |
| Any | No SSID / not connected | `signals` (30/day) |
| Any | Has $100+ real balance | `auto_trading` (unlock all) |

Migration query:
```sql
UPDATE users SET access_level = 'ai_trading' WHERE tier IN ('PRO', 'MASTER');
-- users with $100+ real balance get auto_trading (handled by balance check on next /start)
```

After migration, the `tier` column can remain in the DB (ignore it) or be dropped — Claude's call.

---

## Section 8: Additional Notes

### 8.1 Giveaways
Keep the existing giveaway system. Giveaway participation should check:
- All users can participate in giveaways (no tier/product restriction)
- Winner selection stays the same

### 8.2 Leaderboard
Keep leaderboard. Remove the PRO-only gate in `updateLeaderboardAuto()` — all users can appear on leaderboard.

### 8.3 Upgrade tokens
Keep the token system. Tokens now unlock products instead of tiers:
- `token_tier:AI_TRADING` → unlocks AI Trading
- `token_tier:AUTO_TRADING` → unlocks Auto Trading

### 8.4 Admin panel
Update the admin panel:
- Remove tier management buttons
- Add: View user's access level, manually upgrade access level
- Add: Signal stats (how many signals used today across all users)

### 8.5 Menu structure
```
Signals | AI Trading | Auto Trading | Giveaways | Help & FAQ | Support
```

Each product has its own submenu when tapped.

---

## Implementation Order (Claude's discretion)

1. Create `src/access.ts` with product configs and gating logic
2. DB migration — add columns, migrate existing users
3. Rewrite `sendStartMenu()` and menu keyboard
4. Build Signals flow (analysis display only + daily limit)
5. Refit current trading flow as AI Trading (remove tier gates)
6. Build Auto Trading system (new)
7. Build Auto God Mode
8. Update admin panel
9. Remove deleted tier code, clean up imports
10. Remove periodic tier check loop
11. Test and verify

---

## Claude's Freedom

**Add whatever you think will make this better.** If you see edge cases, UX improvements, or technical refinements that Master didn't explicitly mention but would appreciate — implement them. Use your judgment on:
- Visual improvements to the signal card
- Better menu layouts
- Error handling patterns
- Performance optimization
- Edge cases around balance detection (SDK fails, network issues, etc.)

## 💾 IMPORTANT: Do NOT push this branch yet after implementation
After implementing, commit the work and push the branch. Wizard will handle merging and deployment.
