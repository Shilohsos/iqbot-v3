# Patch: Replace spammy social proof with organic fabricated promo claims

## Problem
The `processUpdateQueue` in `giveaway.ts` sends fake social proof messages every 30s ("🔥 X people just joined", "📊 X users now participating"). This looks like spam, not authentic.

## Fix

### 1. Remove social proof spam
Delete lines 415-431 in `giveaway.ts` — the section in `processUpdateQueue` that inflates participant counts and sends fake join messages.

### 2. Fabricated promo code claims
When a promo code is activated (`activatePromoCode`), seed **fabricated participants** in `giveaway_participants` that simulate organic uptake:

- **Initial seed**: ~20-30% of `max_winners` already claimed at activation time (looks like early birds got it)
- **Background tick every 10-15 min**: increment fabricated claims gradually so it reaches ~90-95% by the time the promo expires
- **Spread duration**: if a promo is set for 5 hours, spread the 50 fabricated claims across those 5 hours proportionally

### 3. Urgency notification triggers
When remaining real+fabricated claims hit certain thresholds, send a broadcast notification to approved users:

| Threshold | Message |
|-----------|---------|
| ≤10 remaining | ⚠️ "Only 10 promo codes left!" |
| ≤5 remaining | 🔥 "Only 5 promo codes remaining!" |
| ≤1 remaining | 🏃 "Last promo code — grab it now!" |

Only send each threshold once (store in DB to prevent repeats).

### 4. Data model
Use a new table or extend `giveaway_events` columns:

```sql
-- Track fabricated claim state per event
fabricated_claims  INTEGER NOT NULL DEFAULT 0
-- Track which urgency thresholds have been sent
urgency_10_sent    INTEGER NOT NULL DEFAULT 0
urgency_5_sent     INTEGER NOT NULL DEFAULT 0
urgency_1_sent     INTEGER NOT NULL DEFAULT 0
```

Or simpler: use the existing `config` table with keys like `promo_<id>_urgency_10_sent`.

### 5. Display
The admin "view" for the promo should show:
- Real claims: X
- Fabricated claims: Y
- Total visible to users: X+Y (what's displayed as "claimed" count)

The user-facing claim count should be the SUM of real + fabricated.

## Verification
- Create promo with max=50, 5h duration → ~10-15 claims appear immediately
- Fabricated claims increase steadily over 5h
- Urgency messages fire at ≤10, ≤5, ≤1
- No 30s spam messages to participants
