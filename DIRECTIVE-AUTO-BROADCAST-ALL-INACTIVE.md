# DIRECTIVE: Auto-Broadcast — Send to ALL Inactive, Not 30% Batch

## Change
In `src/auto-broadcast.ts`, `fireBroadcast()` — remove the 30% random batch slice (lines 40-41). Instead, send to **all** inactive traders (no trade in 2+ hours).

### Current (lines 40-41):
```ts
const batchSize = Math.max(1, Math.floor(inactive.length * 0.3));
targets = [...inactive].sort(() => Math.random() - 0.5).slice(0, batchSize);
```

### New:
```ts
targets = inactive;
```

## Rationale
- No reason to leave 70% of cold users untouched
- Rate limiting already handled by 50ms delay between sends (line 61)
- If user count grows large, add a cap of 50 max per broadcast cycle — but don't batch to 30%

## Also Fix
- Line 66 log: change `targets.length` to `targets.length` (same variable, just update). Actually log is fine as-is.
- If concerned about Telegram rate limits at scale, add a `MAX_PER_CYCLE = 50` constant and slice to that instead of 30%.

## No Other Changes
Leave everything else untouched — the 50ms delay, the 2-6h interval, image gating, test mode, all stay.
