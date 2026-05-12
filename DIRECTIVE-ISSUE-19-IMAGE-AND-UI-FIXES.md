# Issue #19 — Image & UI Order Fixes

## Overview

Based on visual audit of all 16 images in `/root/iqbot-v3/assets/` and review of the live bot output on Telegram, there are **7 issues** requiring fixes in the code.

---

## Issue A: Onboarding Image Order (L2/L3 swapped)

### Image Contents (for reference)
- **L2.png** = "CHOOSE YOUR START / THREE WAYS TO BEGIN" — tier selection (Demo/Newbie/Pro)
- **L3.png** = "LINK YOUR ACCOUNT" — connect IQ Option account step

### Current Code (`startOnboarding` in `bot.ts`)
```typescript
// Line 165 — L1 first ✓
try { await ctx.replyWithPhoto(ASSET('L1.png')); } catch {}
await ctx.reply(`I'm 10x Special Bot...`);

// Line 172 — L2 comes SECOND (WRONG — should be L3 here)
try { await ctx.replyWithPhoto(ASSET('L2.png')); } catch {}
await ctx.reply(`⚡ Built for serious traders...`);

// Line 179 — L3 comes THIRD (WRONG — should be L2 here)
try { await ctx.replyWithPhoto(ASSET('L3.png')); } catch {}
await ctx.reply(`Three ways to start 👾...`, { reply_markup: tierKeyboard() });
```

### Required Fix
Swap L2 and L3 in `startOnboarding()`:
1. L1 → welcome text (keep as-is)
2. **L3** → "Connect your IQ Option account" message with onboard buttons (have account / create account)
3. **L2** → "⚡ Built for serious traders. Three ways to begin 👾" with tier keyboard

The "Connect your IQ Options account / Link your account" message should accompany L3. The "Three Ways to Begin" and its text should accompany L2.

### Files to change
- `src/bot.ts` — reorder the 3 image+text blocks in `startOnboarding()`
- `src/ui/user.ts` — `onboardKeyboard()` text may need adjustment

---

## Issue B: L4 ("From Demo to Reality") appears during password entry

### Current Code
In the onboarding wizard, `connect_password` step (line 820-822 of bot.ts):
```typescript
await ctx.reply('🛡️ Your password is safe...');
try { await ctx.replyWithPhoto(ASSET('L4.png')); } catch {}  // WRONG
await ctx.reply('🔑 Enter your IQ Option password:');
```

### Problem
L4 ("From Demo to Reality") is shown during the account connection flow (when asking for password). This image should ONLY appear when the user clicks the **Trade** button (`ui:trade` action, which already sends L4 at line 522).

### Required Fix
**Remove** the `ctx.replyWithPhoto(ASSET('L4.png'))` call from the `connect_password` step. The trade button handler (`ui:trade`) already sends L4 correctly.

### Files to change
- `src/bot.ts` — delete line 821 (`try { await ctx.replyWithPhoto(ASSET('L4.png')); } catch {}`)

---

## Issue C: L5 (Timeframe) shown at wrong step + missing from correct step

### Current Code
When mode is selected (`mode:demo/live` handler, line 399):
```typescript
try { await ctx.replyWithPhoto(ASSET('L5.png')); } catch {}  // WRONG — L5 is timeframe, not amount
await ctx.reply('Enter amount', { reply_markup: amountKeyboard() });
```

When amount is selected (line 425-426):
```typescript
try { await ctx.replyWithPhoto(ASSET('L6.png')); } catch {}  // WRONG — L6 is pair, not timeframe
await ctx.editMessageText('⏱ Pick your expiry timeframe...', { reply_markup: timeframeKeyboard() });
```

When timeframe is selected (line 442):
```typescript
try { await ctx.replyWithPhoto(ASSET('L7.png')); } catch {}  // WRONG — should show pair choice
```

When pair is selected (line 478):
```typescript
try { await ctx.replyWithPhoto(ASSET('L8.png')); } catch {}  // Should show L7 (analyzing) HERE, not L8
```

### Image Reference
| Image | Content | Correct Step |
|-------|---------|-------------|
| L4 | From Demo to Reality | Mode selection (already correct — `ui:trade`) |
| L5 | CHOOSE DURATION / TIMEFRAME | Timeframe step |
| L6 | SELECT YOUR PAIR | Pair selection step |
| L7 | BOT IS ANALYZING (radar) | When analysis starts (after pair selected) |
| L8 | OPPORTUNITY FOUND | After analysis completes |

### Required Fix
The images are shifted by exactly one step. Fix the mappings:

| Step | Current Image | Correct Image |
|------|--------------|--------------|
| After mode selected (amount step) | L5 | none (remove — just text) |
| After amount selected (timeframe step) | L6 | **L5** |
| After timeframe selected (pair step) | L7 | **L6** |
| Pair selected → before analysis | L8 | **L7** |
| Analysis complete → direction signal | L9a/L9b | then **L8** (opportunity found) |

So the corrected flow should be:

1. **Mode selected** → just text: "Enter amount", no image
2. **Amount selected** → send L5 (timeframe image) → "Pick your expiry timeframe..."
3. **Timeframe selected** → send L6 (pair image) → pair keyboard
4. **Pair selected** → send L7 (analyzing radar) → "Scanning markets..."
5. **Analysis completes** → send L8 (opportunity found) → trade details + signal
6. **Signal direction** → send L9a/L9b based on direction

### Files to change
- `src/bot.ts` — lines 399, 425, 442, 478

---

## Issue D: Support button should directly route (no intermediate message)

### Current Code
Support button in `startKeyboard()` (ui/user.ts line 16):
```typescript
{ text: 'Support 🔋', callback_data: 'ui:support' },
```

And the handler (bot.ts line 580-586) shows an intermediate message with a link.

### Required Fix
Change the Support button to use `url` directly instead of callback_data:
```typescript
{ text: 'Support 🔋', url: ADMIN_CONTACT_LINK },
```

This means clicking Support opens the admin contact link directly with no intermediate message. The `ui:support` handler can be removed.

### Files to change
- `src/ui/user.ts` — change `startKeyboard()` support button
- `src/bot.ts` — optionally remove `ui:support` handler (or keep for backward compat)

---

## Issue E: Stats/History showing global data (not per-user)

### Current Code
`getTradeStats()` (db.ts line 130-148) queries ALL trades globally with no user filter. `getRecentTrades()` also returns all trades.

The `trades` table has NO `telegram_id` column.

### Problem
Fresh Telegram accounts see old/historical trades from previous sessions because stats and history aggregate globally. Master wants each Telegram account to see ONLY its own trades.

### Required Fix
1. **Add `telegram_id` column** to the `trades` table (migration)
2. **Populate `telegram_id`** when inserting trades (in `executeTradeWithSdk` in trade.ts)
3. **Filter queries** by `telegram_id`:
   - `getRecentTrades()` — accept optional `telegramId` param
   - `getTradeStats()` — accept optional `telegramId` param

### Files to change
- `src/db.ts` — add column, update queries
- `src/trade.ts` — pass telegram_id to `insertTrade()`
- The bot.ts handlers that call these functions should pass the current user's Telegram ID

---

## Issue F: Signal direction image is REVERSED

### Current Code (bot.ts line 489)
```typescript
const signalImg = analysis.direction === 'call' ? 'L9a.png' : 'L9b.png';
```

### Image Reference
- **L9a.png** = DOWNWARD TREND / Market bias: bearish (red chart)
- **L9b.png** = UPWARD TREND / Market bias: bullish (green chart)

### Problem
When `direction === 'call'` (bullish / buy signal), the code shows L9a = DOWNWARD TREND (bearish) — **WRONG**.
When `direction === 'put'` (bearish / sell signal), the code shows L9b = UPWARD TREND (bullish) — **WRONG**.

The mapping is **reversed**.

### Required Fix
Swap the image assignment:
```typescript
const signalImg = analysis.direction === 'call' ? 'L9b.png' : 'L9a.png';
// CALL (bullish) → L9b (UPWARD TREND ✓)
// PUT (bearish)  → L9a (DOWNWARD TREND ✓)
```

### Files to change
- `src/bot.ts` — line 489

---

## Issue G: Trade win shows wrong image (L11 mapping)

### Current Code (bot.ts line 301-302)
For any WIN inside `runMartingale()`:
```typescript
if (result.status === 'WIN' || result.status === 'TIE') {
    try { await ctx.replyWithPhoto(ASSET('L11a.png')); } catch {}
```

And on all rounds lost (line 329):
```typescript
await ctx.reply('Lost this one 💔! Remain confident!...');
```

### Image Reference
| Image | Content | Purpose |
|-------|---------|---------|
| L11a | DIRECT WIN! ENTRY SNIPED | Direct win (no martingale recovery needed) |
| L11b | MAJOR WIN! COMEBACK ACHIEVED | Martingale comeback win |
| L11c | LOST, BUT THIS IS NOT THE END! | Series loss (martingale exhausted) |

### Problem
When the martingale sequence wins on any step, L11a ("Direct Win") is always shown. But this is incorrect:
- A win inside the martingale loop should show **L11b** ("Major Win / Comeback Achieved") since the bot is operating with recovery mode
- L11a should only appear for standalone wins outside the martingale sequence
- When all 6 rounds are lost, **L11c** ("Lost, but this is Not the End!") should be shown instead of just text

### Required Fix
```typescript
// WIN/TIE inside martingale loop → L11b
if (result.status === 'WIN' || result.status === 'TIE') {
    try { await ctx.replyWithPhoto(ASSET('L11b.png')); } catch {}  // Changed from L11a to L11b
    await ctx.reply(
        `🏆 +$${result.pnl.toFixed(2)} added to your balance...`
    );
}

// All rounds lost → L11c
// After the martingale loop exhausts (line 329):
try { await ctx.replyWithPhoto(ASSET('L11c.png')); } catch {}
await ctx.reply(`Lost this one 💔! Remain confident! New setup loading 👾`);
```

### Files to change
- `src/bot.ts` — line 302 (change L11a to L11b), line 329 (add L11c before the text)

---

## Summary of Files Changed

| File | Issues | Changes |
|------|--------|---------|
| `src/bot.ts` | A, B, C, F, G | Reorder onboarding, remove L4 at password, fix image shifts, reverse L9 mapping, fix L11 mapping |
| `src/db.ts` | E | Add telegram_id column, filter queries by user |
| `src/trade.ts` | E | Pass telegram_id to insertTrade() |
| `src/ui/user.ts` | D | Change support button to URL |

---

## Images Reference for Claude

Located at `/root/iqbot-v3/assets/` (16 PNG files):

| File | Content | When to show |
|------|---------|-------------|
| L1.png | "YOUR TRADING ADVANTAGE IS ACTIVE" | Welcome / start onboarding |
| L2.png | "THREE WAYS TO BEGIN" (tier selection) | After linking account |
| L3.png | "LINK YOUR ACCOUNT" | After welcome, before tier selection |
| L4.png | "FROM DEMO TO REALITY" | Only at Trade button (ui:trade) |
| L5.png | "CHOOSE DURATION / TIMEFRAME" | Timeframe selection step |
| L6.png | "SELECT YOUR PAIR" | Pair selection step |
| L7.png | "BOT IS ANALYZING" (radar) | Before analysis (pair selected) |
| L8.png | "OPPORTUNITY FOUND" | After analysis completes |
| L9a.png | DOWNWARD TREND (bearish) | PUT signal |
| L9b.png | UPWARD TREND (bullish) | CALL signal |
| L10.png | "INTELLIGENT RECOVERY ENABLED" | After first loss (martingale step 2+) |
| L11a.png | "DIRECT WIN! ENTRY SNIPED" | Standalone win (non-martingale) |
| L11b.png | "MAJOR WIN! COMEBACK ACHIEVED" | Martingale win |
| L11c.png | "LOST, BUT THIS IS NOT THE END!" | Martingale exhausted (all rounds lost) |
| L12.png | "WHAT IF THIS WAS REAL?" | Demo upsell start |
| L13.png | "READY TO MAKE REAL PROFITS" | Demo upsell CTA |

---

*Directive authored: after visual audit of all 16 images + live bot output review*
