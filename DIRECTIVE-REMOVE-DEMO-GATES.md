# Directive: Remove Demo Tier Feature Gates

**Authority:** Master Ferdinand Shiloh Hart  
**From:** Wizard  
**Date:** 2026-06-06

IMPORTANT: Merge master first before implementing.

---

## Context

The 10-trade daily cap (`daily_demo_tracking`) is now the primary gate for demo users. Since they can only take 10 trades per day regardless, there's no need to also lock timeframes, pairs, or smart recovery options behind tier gates.

## Change

**File:** `src/tiers.ts`

Update the DEMO tier config to match MASTER for pairs, timeframes, and gale options:

```typescript
DEMO: {
    label: 'Demo Trader',
    pairs: ['EURUSD-OTC', 'GBPUSD-OTC', 'EURJPY-OTC', 'GBPJPY-OTC', 'AUDUSD-OTC', 'USDCAD-OTC', 'EURGBP-OTC', 'USDCHF-OTC'],
    analyzerTier: 'DEMO',
    maxConcurrentTrades: 1,
    allowedTimeframes: [30, 60, 300],
    allowedGaleOptions: [0, 3, 6],
    galeCanDisable: true,
    defaultGaleRounds: 6,
    canViewLeaderboard: false,
    canParticipateGiveaway: false,
    demoUpsellEnabled: true,
},
```

**Specific changes to DEMO config:**
| Field | Old | New |
|-------|-----|-----|
| `pairs` | 2 pairs | All 8 pairs |
| `allowedTimeframes` | [300] (5m only) | [30, 60, 300] (all) |
| `allowedGaleOptions` | [3, 6] | [0, 3, 6] (includes disable) |
| `galeCanDisable` | false | true |
| `maxConcurrentTrades` | 1 | 1 (unchanged — 10-trade cap handles this) |

**What this affects:**
- `timeframeKeyboard()` in `menu.ts:39` — locked buttons now unlocked for DEMO
- `pairKeyboard()` in `menu.ts:60` — locked pairs now unlocked for DEMO
- Gale settings UI — disable option now available for DEMO
- `canViewLeaderboard` and `canParticipateGiveaway` remain false (separate decision)

## Verification

1. DEMO user clicks Take a trade → sees 30s, 1m, 5m all unlocked (no 🔒)
2. DEMO user clicks pair picker → sees all 8 pairs unlocked  
3. DEMO user opens Smart Recovery Settings → sees "Disable" option available
4. DEMO user is still limited to 10 trades/day — the daily cap is the only gate
