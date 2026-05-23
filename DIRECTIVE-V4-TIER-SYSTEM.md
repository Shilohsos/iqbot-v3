# DIRECTIVE: V4 Tier System + Auto-Account Creation

## Context

Current bot has 2 tiers: NEWBIE (default) and PRO (token-upgraded). This directive rewrites to 3 tiers with proper enforcement.

## 1. Database Changes

### A. Add new columns to `users` table

```sql
-- Run migration at top of db.ts
ALTER TABLE users ADD COLUMN simultaneous_trades INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN gale_disabled INTEGER NOT NULL DEFAULT 0;
```

The `tier` column will serve as `DEMO | PRO | MASTER`. Existing `NEWBIE` rows become `DEMO`.

### B. New table: `giveaway_events`

```sql
CREATE TABLE IF NOT EXISTS giveaway_events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type      TEXT    NOT NULL, -- 'giveaway' | 'promo_code' | 'marathon'
    title           TEXT    NOT NULL,
    description     TEXT,
    criteria_type   TEXT,   -- 'new_user' | 'min_balance' | 'top_trader'
    criteria_value  TEXT,   -- e.g. '7' (days) | '20' (dollars) | '10' (trades)
    prize_pool      REAL,
    prize_per_winner REAL,
    max_winners     INTEGER,
    status          TEXT    NOT NULL DEFAULT 'pending', -- 'pending' | 'active' | 'completed'
    starts_at       TEXT,
    ends_at         TEXT,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
```

### C. New table: `giveaway_participants`

```sql
CREATE TABLE IF NOT EXISTS giveaway_participants (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    giveaway_id     INTEGER NOT NULL REFERENCES giveaway_events(id),
    telegram_id     INTEGER NOT NULL,
    trade_count     INTEGER NOT NULL DEFAULT 0,
    eligible        INTEGER NOT NULL DEFAULT 1,
    joined_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);
```

### D. New table: `broadcast_messages`

```sql
CREATE TABLE IF NOT EXISTS broadcast_messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    type            TEXT    NOT NULL, -- 'auto' | 'approved'
    category        TEXT,            -- 'motivation' | 'review' | 'trade_win' | 'life_win'
    content         TEXT    NOT NULL,
    image_file_id   TEXT,
    enabled         INTEGER NOT NULL DEFAULT 1,
    last_sent_at    TEXT,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
```

### E. New table: `channel_approvals`

```sql
CREATE TABLE IF NOT EXISTS channel_approvals (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id     INTEGER NOT NULL UNIQUE,
    approved        INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
```

## 2. Tier Enforcement (Core Logic — Replace in bot.ts, menu.ts, trade.ts)

### Tier definitions — create `src/tiers.ts`

```typescript
export interface TierConfig {
  label: string;
  pairs: string[];           // subset of OTC_PAIRS
  analyzerTier: 'DEMO' | 'PRO' | 'MASTER';
  maxConcurrentTrades: number;
  allowedTimeframes: number[]; // 30, 60, 300
  allowedGaleOptions: number[]; // [3, 6] or [3, 6] or [0, 3, 6] where 0 = off
  galeCanDisable: boolean;
  defaultGaleRounds: number;
  canViewLeaderboard: boolean;
  canParticipateGiveaway: boolean;
  demoUpsellEnabled: boolean;
}

export const TIER_CONFIGS: Record<string, TierConfig> = {
  DEMO: {
    label: 'Demo Trader',
    pairs: ['EURUSD-OTC', 'GBPUSD-OTC'],  // 2 pairs only
    analyzerTier: 'DEMO',
    maxConcurrentTrades: 1,
    allowedTimeframes: [300],  // 5M only
    allowedGaleOptions: [3, 6],
    galeCanDisable: false,
    defaultGaleRounds: 6,
    canViewLeaderboard: false,
    canParticipateGiveaway: false,
    demoUpsellEnabled: true,
  },
  PRO: {
    label: 'Pro Trader',
    pairs: ['EURUSD-OTC', 'GBPUSD-OTC', 'EURJPY-OTC', 'GBPJPY-OTC'],  // 4 pairs
    analyzerTier: 'PRO',
    maxConcurrentTrades: 2,
    allowedTimeframes: [60, 300],  // 1M & 5M
    allowedGaleOptions: [3, 6],
    galeCanDisable: false,
    defaultGaleRounds: 6,
    canViewLeaderboard: true,
    canParticipateGiveaway: true,
    demoUpsellEnabled: false,
  },
  MASTER: {
    label: 'Master Trader',
    pairs: ['EURUSD-OTC', 'GBPUSD-OTC', 'EURJPY-OTC', 'GBPJPY-OTC', 'AUDUSD-OTC', 'USDCAD-OTC', 'EURGBP-OTC', 'USDCHF-OTC'],  // all 8
    analyzerTier: 'MASTER',
    maxConcurrentTrades: 5,
    allowedTimeframes: [30, 60, 300],  // 30s, 1M & 5M
    allowedGaleOptions: [0, 3, 6],  // 0 = can disable
    galeCanDisable: true,
    defaultGaleRounds: 6,
    canViewLeaderboard: true,
    canParticipateGiveaway: true,
    demoUpsellEnabled: false,
  },
};
```

**TBD — MASTER analysis:** Currently only 2 tiers in analysis.ts (NEWBIE=2 indicators/50%, PRO=4 indicators/75%). MASTER should use the PRO path (4 indicators) at 75% threshold, same as PRO. If Master needs stricter analysis (5 indicators, 80% threshold), specify.

### Changes to `menu.ts`

- `pairKeyboard(tier)` → use `TIER_CONFIGS[tier].pairs` instead of hardcoded NEWBIE_PAIRS
- `timeframeKeyboard(tier)` → only show timeframes in `allowedTimeframes`
- `startKeyboard(tier)` → hide Leaderboard for DEMO
- Martingale settings menu → conditionally show/hide "Disable" option based on `galeCanDisable`

### Changes to `trade.ts`

- `maxConcurrent` check in pair handler → use `TIER_CONFIGS[tier].maxConcurrentTrades`
- Timeframe validation → check against `allowedTimeframes`
- Gale settings menu → enforce `allowedGaleOptions` (show only configured options)

### Changes to `analysis.ts`

- The existing DEMO/PRO paths cover the analysis needs. No change needed.
- MASTER uses the same path as PRO (4 indicators, 75% threshold).

### Token generation

- Current token system generates `NEWBIE` or `PRO` tokens. Change to `DEMO`, `PRO`, `MASTER`.
- Admin can choose tier when generating tokens.
- Users apply token → `setUserTier(tid, tier)` sets their tier.
- Migration: existing `NEWBIE` users → `DEMO`, existing `PRO` users → `PRO`.

## 3. Auto-Account Creation

### Flow

In `bot.ts`, onboarding handlers:

1. User taps "I have an account" → enter User ID
2. User ID fails verification (not found or invalid)
3. User taps "Create an account" → redirected to affiliate link
4. User tries again, User ID fails again
5. **NEW option**: "Let us create an account for you"
6. User provides a fresh email address
7. Bot attempts to create IQ Option account via browser automation or API

**TBD: This requires IQ Option to support programmatic account creation. The Quadcode SDK does NOT expose a registration endpoint. Approaches:**
- **Browser automation** (Playwright) — navigate to IQ Option registration, fill form, submit
- **Reverse-engineer the IQ Option web registration API** — POST to registration endpoint
- **Scan affiliate signups** — user creates via affiliate link, bot detects new account

**Default:** Implement as a placeholder that logs the email and notifies the admin to manually create. When we confirm IQ Option supports API registration, swap the implementation.

### Implementation

Add to onboarding wizard:
- New `OnboardStep`: `'auto_create_email'`
- After 2nd User ID failure, show email input
- Accept email → attempt creation (or log + notify admin)
- On success → save SSID, approve user, show success message "Account created! Email: X, Password: Y"
- On failure → contact admin

## 4. Migration Path

- All current NEWBIE users → DEMO
- All current PRO users → PRO
- No users get MASTER automatically (token-gated like current PRO)
- Existing DB `tier` values: `'NEWBIE'` → `'DEMO'`, `'PRO'` → `'PRO'`

## 5. Files to Change

| File | Changes |
|------|---------|
| `src/tiers.ts` | NEW — tier configuration map |
| `src/db.ts` | Add migrations + new table schemas |
| `src/menu.ts` | Tier-aware pairKeyboard, timeframeKeyboard, startKeyboard |
| `src/ui/user.ts` | Tier-conditional buttons |
| `src/ui/admin.ts` | Token tiers updated (DEMO/PRO/MASTER) |
| `src/bot.ts` | Replace hardcoded tier checks with TIER_CONFIGS, add auto-account flow |
| `src/trade.ts` | Timeframe validation per tier |

---

**Deploy:** `npx tsc && pm2 restart iqbot-v3-bot`

**Test:** Verify each tier sees correct pairs, timeframes, concurrency limits, leaderboard visibility.
