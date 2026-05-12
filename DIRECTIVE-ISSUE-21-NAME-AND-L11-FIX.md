# Issue #21 — Two remaining fixes

## Issue A: "MoneyGBT" → "10x"

### Location

`src/bot.ts` line 151:

```typescript
`MoneyGBT — Home`,
```

This is the only occurrence in the codebase. Change to:

```typescript
`10x — Home`,
```

---

## Issue B: L11 image logic — win detection (round-based)

### Current code (bot.ts line 316-318)

```typescript
if (result.status === 'WIN' || result.status === 'TIE') {
    // L11b = MAJOR WIN / COMEBACK ACHIEVED; replaces L10 if it's still showing
    await sendRoundImage('L11b.png');
```

Bug: **always** shows L11b regardless of which round the win happened on.

### Expected behavior

| Win on | Image | Meaning |
|--------|-------|---------|
| **Round 1** (first trade, no recovery needed) | **L11a.png** | "DIRECT WIN! ENTRY SNIPED" |
| **Round 2+** (martingale comeback) | **L11b.png** | "MAJOR WIN! COMEBACK ACHIEVED" |
| All 6 rounds lost | **L11c.png** | Already correct (line 346) |

### Fix

```typescript
if (result.status === 'WIN' || result.status === 'TIE') {
    if (round === 1) {
        await sendRoundImage('L11a.png');  // Direct win — first round
    } else {
        await sendRoundImage('L11b.png');  // Martingale comeback
    }
```

---

### Files to change

- `src/bot.ts` — line 151 (MoneyGBT) + lines 316-318 (L11 logic)
