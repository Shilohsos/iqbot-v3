# DIRECTIVE: Separate Promo Code and Marathon from Giveaway Flow

## Problem

Current giveaway wizard treats all 3 types (giveaway, promo_code, marathon) identically. Same 9-step wizard for all. Promo codes and marathons need different flows.

## 1. Promo Code Flow

A promo code is a claimable code — NOT a contest with winners. Users redeem it, not compete for it.

### Admin creation: separate wizard (3 steps instead of 9)

**Step 1:** Title (e.g. "150% BONUS CODE")
**Step 2:** Description (e.g. "NEW PROMO CODE FOR FUNDING YOUR ACCOUNT. CODE: 10xfirst")
**Step 3:** Code value (the actual code string)
**Step 4:** Optional: max claims (e.g. 50 users can claim before it expires)
**Step 5:** Schedule (now or future)
**Step 6:** Confirm → activate

NO criteria, NO winners, NO prize pool, NO trade tracking.

### User side

Users see promos in the giveaways list. Pro and Master can claim. On claim:
- Check if promo code has remaining claims
- Check if user already claimed this promo
- Mark as claimed
- Show the code: "🎉 Your code: **10xfirst** — Use this when funding your account."

### DB Changes

`giveaway_events` already has `event_type` column. For promos, `criteria_type` = NULL, `prize_pool` = NULL, `max_winners` = max claims.

`giveaway_participants` for promos: trade_count is unused, eligible=1, winner=1 when claimed.

No change to table schemas needed — reuse existing tables with different semantics.

### Admin menu update

In `giveawayTypeKeyboard()`, each type should route to a different wizard:
- `giveaway_type:giveaway` → current 9-step wizard
- `giveaway_type:promo_code` → NEW 5-step wizard
- `giveaway_type:marathon` → NEW 7-step wizard

### Bot.ts changes

New admin session steps for promo code wizard:

```typescript
// New admin steps
| 'promo_v2_title'
| 'promo_v2_desc' 
| 'promo_v2_code'
| 'promo_v2_max_claims'
```

Rename existing giveaway_v2_* steps to be giveaway-specific (they already are, but rename for clarity in code comments).

### User side — promo display

In `ui:giveaways` handler, distinguish between giveaway and promo_code:
- Giveaway: show prize pool, criteria, participate button
- Promo code: show description, "Claim Code" button

### Claim handler

```typescript
bot.action(/^promo:claim:(\d+)$/, async ctx => {
    // Mark user as claimed in giveaway_participants
    // Show the promo code
    // Decrement remaining claims
});
```

## 2. Marathon Flow

A marathon is a sustained contest — users compete over a period. Top performers win.

### Admin creation: separate wizard (7 steps)

**Step 1:** Title
**Step 2:** Description
**Step 3:** Duration (e.g. 24h, 7 days)
**Step 4:** Criteria: "top_traders" (marathons are ALWAYS trade-count based)
**Step 5:** Top N winners (e.g. top 10)
**Step 6:** Prize pool
**Step 7:** Schedule → Confirm → Activate

NO: new_user, min_balance criteria. Marathon is always trade-based competition.

### User side

Same as current giveaway participation but:
- Trade count tracked
- Leaderboard updates shown for THIS marathon's participants
- "You're ranked #7 out of 45 participants. Top 10 win."

### Winner selection

At marathon end:
- Sort participants by `trade_count` DESC
- Top N win
- Automated (triggers at `ends_at` timestamp)

### Marathon-specific features

1. **Marathon leaderboard** (separate from main leaderboard) — shows only this marathon's participants ranked by trade count
2. **Progress notifications** — "You're #12. Just 3 more trades to reach top 10."
3. **Countdown** — "Marathon ends in 4 hours. Keep trading."

## 3. Files to Change

| File | Change |
|------|--------|
| `src/bot.ts` | Separate admin session steps for promo/marathon; `promo:claim` handler; marathon leaderboard |
| `src/ui/admin.ts` | Route giveawayTypeKeyboard to different wizards; add promo/marathon-specific keyboards |
| `src/giveaway.ts` | `createPromoCode()`, `claimPromoCode()`, `createMarathon()`, marathon progress logic |

## 4. Admin menu routing

```typescript
bot.action(/^giveaway_type:(giveaway|promo_code|marathon)$/, async ctx => {
    const type = ctx.match[1];
    if (type === 'giveaway') {
        // Existing 9-step wizard
        adminSessions.set(chatId, { step: 'giveaway_v2_title', giveawayV2Type: 'giveaway' });
    } else if (type === 'promo_code') {
        // New 5-step promo wizard
        adminSessions.set(chatId, { step: 'promo_v2_title', giveawayV2Type: 'promo_code' });
    } else if (type === 'marathon') {
        // New 7-step marathon wizard
        adminSessions.set(chatId, { step: 'marathon_v2_title', giveawayV2Type: 'marathon' });
    }
});
```

---

**Deploy:** `npx tsc && pm2 restart iqbot-v3-bot`

**Test:** Admin creates promo code → user sees "Claim" → claims → gets code shown. Admin creates marathon → users join → trade count tracked → top N win at end.
