# DIRECTIVE-FIX-STALE-WIZARD-BLOCKING-BRAIN.md

## Problem

When a user taps a "Start Trading" button (creating an in-memory wizard session), then sends a text message like "Hi", the text handler skips the brain because `brainWiz` is truthy. The handler then checks `brainWiz.step !== 'custom_amount'` and returns silently. Result: user sends "Hi", gets no response.

## Files to modify

### `src/bot.ts` — text handler, brain section (around line 4409)

**Current code (summarized):**
```
const brainWiz = wizardSessions.get(chatId);
const isActivated = ...;
if (!isActivated) { ... }
if (!brainWiz) {
    // brain handler
    return;
}
if (!brainWiz || brainWiz.step !== 'custom_amount') return;
```

**Problem:** When `brainWiz` is truthy but `step !== 'custom_amount'`, the handler hits the second `return` silently. This creates a dead zone where the user's text message is swallowed.

**Fix:** Before the brain handler, if `brainWiz` is truthy AND the text message is NOT a valid numeric input for the wizard, delete the stale wizard session and let the brain handle it. Also clear stale sessions where `step` is not `'custom_amount'` (the only text-input wizard step).

Change the block to:

```
const brainWiz = wizardSessions.get(chatId);
// Clear stale wizard sessions — brain should fire for text messages
if (brainWiz && brainWiz.step !== 'custom_amount') {
    wizardSessions.delete(chatId);
}
// Also clear if text is non-numeric (wizard expects number for amount)
if (brainWiz && brainWiz.step === 'custom_amount' && isNaN(parseFloat(text))) {
    wizardSessions.delete(chatId);
}
```

This way:
- Any wizard session stuck in a non-text-input step gets cleared, allowing the brain to respond
- Only wizard sessions legitimately waiting for a numeric amount (step `'custom_amount'`) survive
- Non-numeric text to a wizard in `'custom_amount'` step is treated as stale (user isn't entering an amount)

## Deploy

1. `npm run build`
2. `pm2 restart iqbot-v3-bot --update-env`
3. Send a text message to verify brain responds
