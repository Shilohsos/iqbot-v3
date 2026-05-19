# DIRECTIVE: Pro Tier Upgrade — Stricter Analysis + Fixed Upgrade Flow

## Overview

- **All existing users have been reset to NEWBIE** (67 users, already done server-side — DB updated).
- Upgrade to PRO now requires a token (token system already works — tokens always set to PRO).
- Upgrade UI is fixed to PRO only (no NEWBIE option).
- PRO tier gets stricter market analysis with 4 indicators (3-of-4 agreement).
- Remove dead tier selection code.

---

## Changes Required

### 1. `src/analysis.ts` — PRO Tier Analysis Logic

**Signature change:** Add optional `tier` parameter:

```typescript
export async function analyzePair(
    ssid: string,
    pair: string,
    timeframeSec: number,
    tier = 'NEWBIE'
): Promise<AnalysisResult>
```

**NEWBIE path** (unchanged — current RSI + EMA crossover, 50% threshold):
- `closes.length < 30` → throw (changed to 35 for MACD/BB data needs)
- RSI(14) → bullish if > 50
- EMA9 vs EMA21 → bullish if EMA9 > EMA21
- Score = (rsiBullish ? 50 : 0) + (emaBullish ? 50 : 0)
- Direction = score >= 50

**PRO path** (new — 4 indicators, require 3-of-4 agreement):
- Requires `closes.length >= 35` for enough data
- Need `highs` and `lows` arrays from candle data for Bollinger Bands
- **Indicator 1:** RSI(14) — bullish if > 50
- **Indicator 2:** EMA9/EMA21 crossover — bullish if EMA9 > EMA21
- **Indicator 3:** MACD(12,26,9) — bullish if MACD line > signal line
- **Indicator 4:** Bollinger Bands(20,2) — bullish if last close < lower band (oversold bounce) or > middle band
- Count votes from all 4, compute confidence = votes/4 * 100
- Only return CALL if confidence >= 75% (3-of-4 agreement)
- Return PUT otherwise
- Reason string should list all 4 signals + confidence

**Helper functions to add:**
- `computeMACD(closes, fast, slow, signal)` → `{ macd, signal }`
- `computeBollinger(closes, period, stdDev)` → `{ mid, upper, lower }`

Keep `computeRSI()` and `computeEMA()` as-is. Types are already exported via the `AnalysisResult` interface.

---

### 2. `src/bot.ts` — Wire Tier Into Analysis + Fix Upgrade UI

**2a.** Around line 892-894, pass user tier to `analyzePair`:

```typescript
// Before line 892, fetch user tier:
const analysisUser = getUser(ctx.from!.id);
const analysisTier = (analysisUser?.tier ?? 'NEWBIE').toUpperCase();
// Then modify line 894:
analysis = await analyzePair(ssid, pair, timeframe, analysisTier);
```

The `getUser()` call and `ssid` fetch already happen at lines 873 and 924 — you can add the user fetch before the analysis call.

**2b.** Upgrade UI message (line 1021-1024) should be fixed to PRO only:

Current:
```
`Enter your upgrade token below to unlock NEWBIE or PRO tier.`
```

Change to:
```
`Enter your upgrade token below to unlock *PRO* tier.⚡`
```

**2c.** Remove `tierKeyboard` from import at line 27 (it's dead code — never shown to users). Remove the `tier:(demo|newbie|pro)` action handler at line 734-742 entirely — tier selection during onboarding is no longer needed since every user is NEWBIE by default.

**2d.** Remove the unused `onboardKeyboard` import at line 29 if it's not used elsewhere (check first — it IS used at lines 473 and 483, so keep it).

---

### 3. `src/menu.ts` — Remove Dead Code

Remove the `tierKeyboard()` function (lines 75-83) — it's imported but never called. Remove the `tierKeyboard` from the exports.

---

### 4. `src/ui/admin.ts` — Token Tier Selection

The `tokenTierKeyboard()` at line 121-129 offers both NEWBIE and PRO tier tokens. Since all users start as NEWBIE and upgrade only to PRO, you can:
- Remove the NEWBIE option, rename the function to just show "PRO Tier" button
- OR leave it as-is (both tiers work) but the upgrade UI only references PRO

Simplest: change the UI text to only show PRO:

```
[{ text: '⚡ PRO Tier', callback_data: 'token_tier:PRO' }]
```

---

## Acceptance Criteria

- [ ] All 67 existing users are NEWBIE (already done — DB updated on 2026-05-18)
- [ ] New users start as NEWBIE with default RSI/EMA analysis
- [ ] PRO users get 4-indicator analysis requiring 3-of-4 agreement
- [ ] Upgrade button on main menu → token entry → upgrades to PRO
- [ ] Upgrade message says "PRO" only, not "NEWBIE or PRO"
- [ ] No tier selection during onboarding (dead code removed)
- [ ] Tokens can still be generated for PRO tier via admin panel
- [ ] `npx tsc --noEmit false` passes clean
- [ ] PM2 restart → bot comes up, menus render, trades work
