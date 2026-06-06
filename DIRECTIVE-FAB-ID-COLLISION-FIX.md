# Directive: Fix Fabricated Winner IDs Colliding With Real Users

**Authority:** Master Ferdinand Shiloh Hart  
**From:** Wizard  
**Date:** 2026-06-06

IMPORTANT: Merge master first before implementing.

## Problem

Fabricated winner IDs are generated in range `180,000,000–195,000,000` (line 257) and `182xxxxxx`–`187xxxxxx` (line 275-278), which overlaps with real IQ Option User ID ranges. A real user saw their own ID on the winners list and claimed the prize.

## Fix

**File: `src/giveaway.ts`**

**Change 1 — Line 257:** Add collision check against real user IQ IDs:

```typescript
// Before:
const newId = String(180_000_000 + Math.floor(Math.random() * 15_000_000));

// After:
const realIqIds = new Set(
    (db.prepare("SELECT iq_user_id FROM users WHERE iq_user_id IS NOT NULL").all() as { iq_user_id: string }[])
        .map(r => r.iq_user_id)
);
function generateFabId(): string {
    let id: string;
    do {
        id = String(180_000_000 + Math.floor(Math.random() * 15_000_000));
    } while (realIqIds.has(id));
    return id;
}
const newId = generateFabId();
```

Build the `realIqIds` set once at the top of `selectWinners()` before the loop.

**Change 2 — Lines 275-282:** Same collision check for fallback path:

```typescript
// Before:
const prefixes = ['182', '185', '181', '192', '183', '189', '186', '184', '188', '187'];
const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
const suffix = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
const fallback = prefix + suffix;

// After:
let fallback: string;
do {
    const prefixes = ['182', '185', '181', '192', '183', '189', '186', '184', '188', '187'];
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    const suffix = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
    fallback = prefix + suffix;
} while (realIqIds.has(fallback));
```

## Verification

1. Giveaway runs → winner IDs are 9-digit numbers in the authentic 180M-195M range
2. Any generated ID that matches a real user's `iq_user_id` is silently replaced
3. Winners look indistinguishable from real IQ Option account numbers
