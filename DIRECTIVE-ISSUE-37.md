# Issue 37: Remove step display from trade log + fix timeframe button loading hang

## Part A: Remove "Step X" from trade session log

### Current behavior
The inline trade log in `runMartingale` shows step numbers:
```
⚡ Trade 1|Step 1|🔴 $25.00 → -$25.00
⚡ Trade 1|Step 2|🟢 $50.00 → +$93.00
```

And the win message shows:
```
🏆 +$93.00 added to your balance.

Recovery complete on step 2/6.

💸 You just made +$93.00
```

### Required
Remove "Step X" from all log lines. When trade wins on gale (round > 1), just show "Recovery complete" without the step counter.

### File: src/bot.ts — runMartingale function (lines 498-613)

**Log lines — remove `|Step ${round}` from all:**
- Line 499: `⚡ Trade 1|🟡 $${currentAmount.toFixed(2)} → in flight`
- Line 515: `⚡ Trade 1|⚠️ $${currentAmount.toFixed(2)} → error`
- Line 546: `⚡ Trade 1|🟢 $${currentAmount.toFixed(2)} → +$${result.pnl.toFixed(2)}`
- Line 548: `⚡ Trade 1|🔴 $${currentAmount.toFixed(2)} → -$${currentAmount.toFixed(2)}`
- Line 550: `⚡ Trade 1|⚪ $${currentAmount.toFixed(2)} → $0.00`
- Line 552: `⚡ Trade 1|⚠️ $${currentAmount.toFixed(2)} → ${result.error ?? result.status}`

**Win message — remove step counter (line 571):**
Current:
```typescript
(round > 1 ? `Recovery complete on step ${round}/${effectiveRounds}.\n\n` : '') +
```
Change to:
```typescript
(round > 1 ? `Recovery complete.\n\n` : '') +
```

---

## Part B: Timeframe button loading hang

### Symptom
User clicks a timeframe button (30s, 1m, 5m) → "Loading..." appears for a few seconds → stops → nothing happens. User has to click again.

### Root cause
**File:** `src/bot.ts`, `tf:` handler (lines 742-760)

`answerCbQuery()` is called LAST at line 759, after:
1. `replyWithPhoto(ASSET('L6.png'))` — uploads a 1.5MB image to Telegram
2. `getUser(chatId)` — DB lookup
3. `editMessageText(...)` — edits the old message

Uploading L6.png takes several seconds. During this time, the Telegram button shows "Loading..." with no answer. If the upload takes more than ~5 seconds, Telegram times out the callback_query. Even though `answerCbQuery()` is eventually called, the user sees nothing happen.

### Fix
Move `answerCbQuery()` to the TOP of the handler, before any slow operations:

```typescript
bot.action(/^tf:(\d+)$/, async ctx => {
    const chatId = ctx.chat!.id;
    const state = wizardSessions.get(chatId);
    if (!state || state.step !== 'timeframe') { await ctx.answerCbQuery('Session expired.'); return; }
    await ctx.answerCbQuery();  // ← stop spinner immediately
    state.timeframe = parseInt(ctx.match[1], 10);
    state.step = 'pair';
    // ... rest of handler (image upload, edit message) ...
});
```

This is the same pattern fixed in Issue 30 for the `pair:` handler. **Always answer the callback query first, then do slow work.**

### Acceptance Criteria
- [ ] Log lines show: `⚡ Trade 1|🟢 $25.00 → +$93.00` (no "Step X")
- [ ] Win message shows: "Recovery complete." (no "on step 2/6")
- [ ] Timeframe button responds instantly — click once, no "Loading..." hang
- [ ] No regression on other button handlers
