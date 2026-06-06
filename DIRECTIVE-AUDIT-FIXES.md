# Directive: Fix Bugs Found in Giveaway/Marathon/Promo Audit

**Authority:** Master Ferdinand Shiloh Hart  
**From:** Wizard — directive only, do not implement autonomously  
**Date:** 2026-06-06

IMPORTANT: Merge master first before implementing.

---

## Fix 1: Marathon Participant Count Must Include Fabricated Entries

**Files:** `src/db.ts`, `src/giveaway.ts`

**Bug:** `getGiveawayParticipantCount()` at db.ts:1888 only queries `giveaway_participants`. Marathon fabricated entries live in `marathon_fabricated` table (separate). When a user sees a marathon leaderboard with 5 fabricated entries, the participant count still shows "0 participants" — defeats the FOMO purpose.

**Fix — Option A (recommended):** Create a new function `getMarathonParticipantCount(giveawayId)` that queries BOTH tables:

```typescript
export function getMarathonParticipantCount(giveawayId: number): number {
    const real = db.prepare(
        'SELECT COUNT(*) AS cnt FROM giveaway_participants WHERE giveaway_id = ? AND eligible = 1'
    ).get(giveawayId) as { cnt: number };
    const fab = db.prepare(
        'SELECT COUNT(*) AS cnt FROM marathon_fabricated WHERE giveaway_id = ?'
    ).get(giveawayId) as { cnt: number };
    return real.cnt + fab.cnt;
}
```

**Fix — Option B (minimal):** Modify `getGiveawayParticipantCount()` to accept an optional event_type param and add the `marathon_fabricated` count when type is 'marathon'.

**Where this count is used (must update all):**
- `giveaway.ts:202` — participant count in activation
- `giveaway.ts:333` — count in sendMotivationalMessages
- `giveaway.ts:471` — promo claim count
- `giveaway.ts:479` — promo auto-complete check
- `giveaway.ts:556` — promo fabrication tick's realClaims

For promo code paths (giveaway.ts:471, 479, 556), keep using real-only count — those should NOT include fabricated.

For marathon paths: the count shown to users in motivational messages and interactions should show the merged total.

---

## Fix 2: Promo Max Claims Must Check Fabricated Claims

**File:** `src/giveaway.ts`

**Bug:** `claimPromoCode()` at giveaway.ts:471-473 checks `claimed >= event.max_winners` using only real participant count. `event.fabricated_claims` is ignored. Result: promo codes can be oversold by up to 92% of max_winners.

**Fix:** Change the max-claims check in `claimPromoCode()` to:

```typescript
const claimed = getGiveawayParticipantCount(giveawayId);
const totalClaimed = claimed + (event.fabricated_claims ?? 0);
if (event.max_winners != null && totalClaimed >= event.max_winners) {
    return { success: false, message: '❌ This promo code has reached its maximum number of claims. Check back for more promos!' };
}
```

Also fix the auto-complete check at give away.ts:479-482 the same way:

```typescript
const newCount = getGiveawayParticipantCount(giveawayId);
const newTotal = newCount + (event.fabricated_claims ?? 0);
if (event.max_winners != null && newTotal >= event.max_winners) {
    setGiveawayStatus(giveawayId, 'completed');
}
```

---

## Fix 3: Marathon Description Step Must Advance in Wizard

**File:** `src/bot.ts`

**Bug:** At bot.ts line ~4142-4150, the marathon wizard sets description but never advances the `step` key. The spread `{ ...as }` carries forward `step: 'marathon_v2_desc'`. Currently only works because next input is a button, but fragile.

**Fix:** After setting description, explicitly advance the step:

```typescript
adminSessions.set(chatId, { ...as, marathonV2Desc: desc, step: 'marathon_v2_winners' });
```

Ensure a step called `marathon_v2_winners` exists in the handler chain, or that the next input (duration picker) matches against the correct step value.

---

## Verification

1. Create a marathon, seed 5-8 fabricated entries → user sees "X participants" matching leaderboard total
2. Activate promo code with max_winners=50 → real claims show correct remaining including fabricated
3. Walk through marathon creation wizard → description step cleanly advances to winners/participants count
