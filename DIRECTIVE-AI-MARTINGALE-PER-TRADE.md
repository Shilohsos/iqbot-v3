# DIRECTIVE — AI Trading Per-Trade Martingale Selection

**Target**: `src/bot.ts`
**Branch**: `claude/broadcast-scheduling-feature-BaEF3`
**IMPORTANT**: Merge master first before implementing.

---

## Overview

Replace the global martingale/smart-recovery setting in AI Trading with a
per-trade selection step. After the user picks a pair, they now choose their
recovery level for **this specific trade only** — 0, 3, or 6 rounds.

The old `ui:martingale_settings` button was removed from the main menu in a
prior commit. The `getUserMartingaleSettings()` call in the trade execution
path must be replaced with the wizard-level selection.

---

## 1. Extend `WizardStep` and `WizardState`

In `src/bot.ts`, the current types at ~line 328:

```ts
type WizardStep = 'mode' | 'currency' | 'amount' | 'timeframe' | 'pair' | 'custom_amount';

interface WizardState {
    step: WizardStep;
    mode?: 'demo' | 'live';
    currency?: string;
    amount?: number;
    timeframe?: number;
    // ... other fields
}
```

**Add `'gale'`** to the `WizardStep` union.  
**Add `gale?: number`** to the `WizardState` interface.  

The updated union:
```ts
type WizardStep = 'mode' | 'currency' | 'amount' | 'timeframe' | 'pair' | 'gale' | 'custom_amount';
```

---

## 2. Intercept pair selection — redirect to gale step

Currently `bot.action(/^pair:(.+)$/, ...)` at ~line 1556 does:

1. Deletes the wizard session
2. Checks demo limits, gets SSID
3. Runs analysis + trade

**Change**: When the user picks a pair, do NOT execute. Instead:

1. Store `pair` in `state`
2. Set `state.step = 'gale'`
3. Edit the message to show the gale selection keyboard
4. `wizardSessions.set(chatId, state)` — keep the session alive

---

## 3. Gale selection keyboard

Build a function `galeKeyboard()` that returns:

```ts
{
  inline_keyboard: [
    [{ text: '⚡ No Recovery (single trade)',      callback_data: 'gale:0' }],
    [{ text: '🔁 Medium — 3 recovery rounds',      callback_data: 'gale:3' }],
    [{ text: '🔁🔁 Full — 6 recovery rounds',       callback_data: 'gale:6' }],
    [{ text: '🔙 Cancel', callback_data: 'wizard:cancel' }],
  ]
}
```

The prompt message:
```
🔄 Smart Recovery

Choose recovery level for THIS trade:

⚡ No Recovery — Single trade, no retry
🔁 Medium — Up to 3 recovery rounds
🔁🔁 Full — Up to 6 recovery rounds

Your choice applies to this trade only.
```

---

## 4. Handle gale selection

New action handler: `bot.action(/^gale:(\d+)$/, async ctx => { ... })`

1. Validate `state.step === 'gale'`
2. Set `state.gale = parseInt(ctx.match[1], 10)`
3. Delete the wizard session: `wizardSessions.delete(chatId)`
4. Proceed to **the existing analysis + trade execution code** (copy from the current `pair:` handler body, starting from the demo limit check)

The gale value replaces `getUserMartingaleSettings()`:

```ts
// OLD (line 1711-1712):
const mgSettings = getUserMartingaleSettings(ctx.from!.id);
const martingaleRounds = mgSettings.enabled ? mgSettings.maxRounds : 1;

// NEW:
const martingaleRounds = state.gale || 1;
```

If `state.gale` is 0, `martingaleRounds` = 1 (single trade, no recovery).

---

## 5. Cleanup

- Remove the `ui:martingale_settings` action handler if it still exists (the button was already removed from the main menu).
- The `getUserMartingaleSettings` / `setUserMartingaleSettings` functions can remain in the codebase (they may still be referenced elsewhere), but the AI Trading path no longer reads them.

---

## 6. Edge cases

- **Session expiry**: If user idles on the gale step, the next action will fail with "Session expired — start over" (standard wizard behavior).
- **Back/cancel**: `wizard:cancel` already handles cleanup correctly.
- **0 rounds**: Pass `martingaleRounds = 1` to `runMartingale` — this means "execute one trade, no recovery rounds" (martingale runs 1 initial + (galeRounds) recovery, where galeRounds = martingaleRounds - 1).

---

## 7. Verification

After implementing:
1. Start a new AI trade: mode → currency → amount → timeframe → pair → **gale selection screen appears**
2. Select each option (0, 3, 6) — trade executes with correct recovery count
3. Select 0 → trade runs single round, shows result immediately
4. Select 3 → trade runs up to 4 attempts (1 initial + 3 recovery)
5. Select 6 → trade runs up to 7 attempts
6. Cancel works at any step
