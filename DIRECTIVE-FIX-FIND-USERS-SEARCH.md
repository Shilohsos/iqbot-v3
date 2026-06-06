# Directive: Fix Find Users Search Not Finding by Username

**Authority:** Master Ferdinand Shiloh Hart  
**From:** Wizard  
**Date:** 2026-06-06

IMPORTANT: Merge master first before implementing.

---

## Problem

Username search at bot.ts:3858 passes the input directly to SQL LIKE. When admin types `@Amara6442`, the query becomes `LIKE '%@Amara6442%'` — but DB stores usernames without `@` (Telegram provides them without `@`). Result: no match.

## Fix

**File: `src/bot.ts`** — Line ~3858

Strip `@` prefix from search text before passing to `findUsersByUsername()`:

```typescript
} else {
    const cleanText = text.replace(/^@/, '').trim();
    found = findUsersByUsername(cleanText);
}
```

## Verification

1. Admin searches `@Amara6442` → finds user Amara6442
2. Admin searches `Amara6442` → still works (no @ to strip)
3. Admin searches `@danielduenas12` → no user found (correct, never used bot)
