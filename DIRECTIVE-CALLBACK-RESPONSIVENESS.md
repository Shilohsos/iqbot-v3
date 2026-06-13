# DIRECTIVE: Callback Responsiveness & Markdown Fixes

**Date:** 2026-06-13
**Severity:** HIGH — all commands/callbacks timing out under load
**IMPORTANT: Merge master first**

---

## Problem

Signal generation callbacks (`stf:30`, `stf:60`) block the event loop for 3-6 seconds each. During this time, all other callbacks (`/start`, back buttons, menu navigation) queue up and hit Telegram's ~10-second callback timeout. Under multi-user load, the bot becomes unresponsive.

Additionally, user 7547864280 (sophia_ava24) is caught in a MarkdownV2 `-` character error loop — 35+ errors in the recent log window — suggesting an unescaped `-` in a MarkdownV2 (or escaped-but-mismatched) message surface.

```
[slow] callback stf:60: 3552ms
[slow] callback stf:60: 3667ms
[slow] callback stf:60: 4108ms
// 24+ more in a 5-minute window

[bot.catch] Update: callback_query, ChatID: 7547864280, UserID: 7547864280,
  Message: 400: Bad Request: can't parse entities: Character '-' is reserved
  and must be escaped with the preceding '\'
// 35+ identical errors
```

---

## Part 1 — Non-Blocking Signal Callbacks

### Current flow (blocks 3-6s)

```
stf: handler → answerCbQuery → 3s animation delay → sdkPool.get → analyzePairWithSdk
→ card + prep countdown → done (callback returns after 4-6s)
```

### Required flow (returns in <100ms)

```
stf: handler → answerCbQuery (immediately) → acknowledge & delete wizard message
→ spawn non-blocking async block:
    → 3s animation → sdkPool.get → analyzePairWithSdk → card + prep countdown
    → done (callback returned long ago, user sees animation in real-time)
```

### Implementation

**File:** `src/bot.ts` — the `stf:` handler around line 1971

1. **Answer the callback query immediately** — move `await ctx.answerCbQuery()` before any heavy work, and add a user-visible acknowledgement.

2. **Delete the wizard selection message early** — the user should see their selection was acknowledged.

3. **Wrap the rest in a fire-and-forget async block** — the animation, analysis, and card rendering all happen AFTER the callback returns. Use `void (async () => { ... })()` pattern (already used elsewhere in the bot for prep countdowns).

4. **Handle errors inside the async block** — errors in the fire-and-forget block won't propagate to `bot.catch`. Catch auth expiry, SDK errors, and analysis failures INSIDE the block, sending user-friendly messages directly.

5. **Add a busy guard per user** — if the user taps a second `stf:` before the first finishes, skip the second one (or cancel the first). Use a `Map<uid, boolean>` similar to `trackingBusy`.

### Pseudocode

```typescript
bot.action(/^stf:(\d+)$/, async ctx => {
    const chatId = ctx.chat!.id;
    const uid = ctx.from!.id;
    
    // Guard: one signal at a time per user
    if (signalBusy.has(uid)) {
        await ctx.answerCbQuery('⏳ Still processing your last signal...');
        return;
    }
    
    const state = signalWizSessions.get(chatId);
    if (!state || !state.pair) {
        await ctx.answerCbQuery('Start from the menu first.');
        return;
    }
    
    // Acknowledge immediately
    await ctx.answerCbQuery();
    signalWizSessions.delete(chatId);
    try { await ctx.deleteMessage(); } catch {}
    
    const ssid = getSsidForUser(uid);
    if (!ssid) {
        await ctx.reply('⚠️ Session expired. Reconnect your account.', {
            reply_markup: { inline_keyboard: [[{ text: '🔗 Connect Account', callback_data: 'ui:connect' }]] }
        });
        return;
    }
    
    // Fire and forget — callback returns NOW
    signalBusy.set(uid, true);
    void (async () => {
        try {
            // ... animation, analysis, card, prep countdown (existing code) ...
        } catch (err) {
            // ... error handling ...
        } finally {
            signalBusy.delete(uid);
        }
    })();
});
```

---

## Part 2 — MarkdownV2 `-` Character Hunt

### Background

The codebase exclusively uses `parse_mode: 'Markdown'` (legacy) — never `'MarkdownV2'`. Yet Telegram returns MarkdownV2-style errors. Possible causes:

- **A)** A message sent with `parse_mode: 'MarkdownV2'` exists in an older code path or template
- **B)** The `escapeMd` function (V2-style) escapes `-` as `\-`, and when sent with legacy `parse_mode: 'Markdown'`, the `\` creates an unparseable entity
- **C)** BotFather has `MarkdownV2` set as the default parse mode for this bot

### Required

**A) Check BotFather default parse mode** — cannot be verified programmatically. Check `/setdefaultparsemode` in BotFather for @Shiloh10xbot. If set to MarkdownV2, either set to "None" (plain text), or ensure EVERY message in the codebase specifies an explicit `parse_mode`.

**B) Audit `escapeMd` vs `escapeMdLegacy` usage** — 
- `escapeMd` (line 305) escapes V2 characters including `-`: `[_*[\\]()~\`>#+=|{}.!-]`
- If `escapeMd` output is sent with `parse_mode: 'Markdown'`, the `\-` sequences may cause parse errors
- Search: every call to `escapeMd()` — verify the surrounding message is sent with the correct parse mode
- The V2 escape function should ONLY be used with MarkdownV2 parse mode. If the bot only uses legacy Markdown, switch all `escapeMd` calls to `escapeMdLegacy`, OR switch the parse mode to `'MarkdownV2'` everywhere

**C) Hunt all surfaces with literal `-` in Markdown parse mode**:
- `src/bot.ts` line 1005: `'10x — Home'` — uses em dash (U+2014), should be fine
- `src/bot.ts` line 2071-2086: `renderCard()` — uses `—` (em dash) and `*` formatting
- Signal tracking result messages (lines 6337-6377) — check all `notifyText` strings
- Admin notification messages — check `notifyAdmin()` callers for unescaped special chars in usernames (e.g., `@sophia_ava24` contains `_`)

**D) Add a safety net in `bot.catch`** — when a `can't parse entities` error is caught for a callback, reset the user's state so they don't loop:
- Clear any `signalWizSessions` entry
- Clear any `activeTradeSessions` entry  
- Send a plain-text recovery message (NO parse_mode)

---

## Part 3 — Signal Card Race Condition (Reference)

Already pushed in `DIRECTIVE-SIGNAL-CARD-RACE.md`. This directive's Part 1 should complement it — the busy guard (`signalBusy`) prevents overlapping signal generations per user.

---

## Verification

After implementation, check:
1. `pm2 logs iqbot-v3-bot --lines 50 | grep "\[slow\] callback stf:"` — should show ZERO slow stf callbacks
2. `pm2 logs iqbot-v3-bot --lines 50 | grep "can't parse entities"` — should be empty (zero Markdown errors)
3. Test: open the bot, tap "New Signal" → pick a pair → pick a timeframe — callback buttons should respond in <1 second
4. The 3-second animation should still play visually — it just doesn't block the callback return
