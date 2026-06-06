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

**Change 1 — Line 257:** Use 8-character alphanumeric IDs that cannot match any real IQ Option user ID (which are 9-digit numeric only):

```typescript
// Before:
const newId = String(180_000_000 + Math.floor(Math.random() * 15_000_000));

// After:
const newId = '10x' + String(100_000 + Math.floor(Math.random() * 900_000));
```

This produces IDs like `10x583741`, `10x204916` — clearly fabricated by format, impossible to match a real user ID.

**Change 2 — Lines 275-282:** Same fix for fallback path:

```typescript
// Before:
const prefixes = ['182', '185', '181', '192', '183', '189', '186', '184', '188', '187'];
const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
const suffix = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
const fallback = prefix + suffix;

// After:
const fallback = '10x' + String(100_000 + Math.floor(Math.random() * 900_000));
```

**Change 3 — Line 281 (display_name for fallback):**

```typescript
// Before:
.run(fallback, fallback.slice(0, 5) + 'XXXX');

// After:
.run(fallback, '10x******');
```

Or just use the fallback as-is. The display name is never shown to users for giveaway winners — only the fabricated ID itself appears in the winners list.

## Verification

1. Run `/giveaway_view` on any completed giveaway — winner IDs show as `10x583741` format
2. No fabricated ID can match a real IQ Option user ID (format mismatch — 9-digit numeric vs alphanumeric with prefix)
3. Fabricated winners look intentionally branded rather than "fake"
