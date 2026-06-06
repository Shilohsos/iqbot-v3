# Directive: Fix Fabricated Winner IDs Colliding With Real Users

**Authority:** Master Ferdinand Shiloh Hart  
**From:** Wizard  
**Date:** 2026-06-06

IMPORTANT: Merge master first before implementing.

---

## Problem

Fabricated winner IDs are generated in range `180,000,000–195,000,000` (line 257) and `182xxxxxx`–`187xxxxxx` (line 275-278), which overlaps with real IQ Option User ID ranges. A real user saw their own ID on the winners list and claimed the prize.

## Fix

**File: `src/giveaway.ts`**

**Change 1 — Line 257:** Use 900M+ range — no real IQ Option user ID exists above 200M:

```typescript
// Before:
const newId = String(180_000_000 + Math.floor(Math.random() * 15_000_000));

// After:
const newId = String(900_000_000 + Math.floor(Math.random() * 99_000_000));
```

This produces IDs like `912345678`, `985204916` — looks like a normal user ID, impossible to match a real IQ Option account.

**Change 2 — Lines 275-282:** Same fix for fallback path:

```typescript
// Before:
const prefixes = ['182', '185', '181', '192', '183', '189', '186', '184', '188', '187'];
const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
const suffix = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
const fallback = prefix + suffix;

// After:
const fallback = String(900_000_000 + Math.floor(Math.random() * 99_000_000));
```

**Verification**

1. Giveaway runs → winner IDs show as 9-digit numbers in the 900M range
2. No fabricated ID can match a real IQ Option user ID (real IDs are 180M-199M, fabricated are 900M-999M)
3. Looks like a normal user ID — no suspicion
