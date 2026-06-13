# DIRECTIVE: Session Expired Loop + MarkdownV2 Parse Errors

**IMPORTANT: Merge master first before implementing.**

## Problem Summary

Two related bugs causing a broken UX loop for users with expired SSIDs:

1. **Session expired messages repeat every ~60 seconds** — user taps "New Signal" → SDK auth fails → friendly error shown → but SSID never invalidated → next tap repeats the cycle. `handlePossibleAuthExpiry` is never reached because the catch block at `bot.ts:1993` swallows the error before it gets there.

2. **MarkdownV2 parse error "Character '-' is reserved"** — floods `bot.catch` for users who tap buttons on the Product Access UI. Exact source message not yet identified despite investigation.

---

## Section 1: Fix the Session Expired Loop

### Root Cause

When `ui:signals` handler (line ~1942) catches an SDK error, it calls `friendlyError()` and returns — but NEVER calls `handlePossibleAuthExpiry()`. The user's SSID stays `ssid_valid=1` in the DB, the reconnect cycle skips them (because segment check passes), and they keep getting the same friendly error on every tap.

### Required Fix

**In every code path that catches an SDK auth error during user-initiated actions, call `handlePossibleAuthExpiry()` before showing the friendly error.** Specifically:

1. `bot.ts` signal handler (~line 1993): After catching SDK error, call `handlePossibleAuthExpiry(err, ctx, false)` — if it returns true, the auth was handled (auto-reconnect or session expired message sent). Only show the friendly "Could not read market" fallback if `handlePossibleAuthExpiry` returns false (meaning the error was NOT auth-related).

2. Same pattern for `ui:trade` handler (~line 1708) and God Mode analysis (~line 2440).

### Also Fix

At `bot.ts:858-859`, `clearUserSsid` and `setSsidValid(0)` are wrapped in empty `catch {}` blocks. These should at minimum log the error. Currently if they fail, the SSID stays valid forever.

---

## Section 2: Find and Fix the MarkdownV2 Parse Error

### Symptoms
- Error: `400: Bad Request: can't parse entities: Character '-' is reserved and must be escaped with the preceding '\'`
- Affects users who tap callback buttons (callback_query updates)
- Seen on users 7547864280 and 8920684372
- Each tap triggers a `bot.catch` entry with zero user-visible response

### Investigation So Far
- All 5 `parse_mode: 'MarkdownV2'` messages in the codebase were checked
- Template literal escaping appears correct at source level
- The Product Access message (`bot.ts:2523`) uses `Semi\\-auto` which produces `Semi\-auto` in output (correctly escaped)
- The `friendlyError` function returns plain text strings (no MarkdownV2)
- `bot.catch` was patched to add callback_data logging — waiting for next occurrence to identify which button triggers it

### Required Investigation
Search the compiled `dist/bot.js` for ANY string sent with `parse_mode: 'MarkdownV2'` that could contain an unescaped hyphen at RUNTIME (not source level). Consider:
- Dynamic message construction where user data or config values are interpolated
- `editMessageText` calls that might inherit MarkdownV2 from the original message
- Any `.replace()` or string concatenation that produces MarkdownV2 text

Once found, fix the escaping or switch to `parse_mode: 'Markdown'` (v1, which doesn't require hyphen escaping).

---

## Section 3: Trade Recovery Enhancement (Already Partially Fixed)

Wizard already added early `external_id` saving in `trade.ts`. However, the recovery function `recoverMissedTradeResults` in `tradeRecovery.ts` has a gap:

- For trades WITHOUT `external_id` (old trades from before this fix), the fallback at line 66-77 checks `getOpenedPositions()` which won't find closed positions
- **Fix:** Also check position history via `getPositionsHistory()` for trades without `external_id`, matching by `trade_id` (which is the IQ Option position/order ID stored in the `trade_id` column)

---

## Verification
1. Expire a test user's SSID, then tap "New Signal" — should get ONE session expired message with Reconnect button, not a loop
2. Tap buttons on Product Access UI — no MarkdownV2 parse errors in logs
3. Kill the bot mid-trade, restart — trade should be recovered with correct result

## Files to Modify
- `src/bot.ts` — add `handlePossibleAuthExpiry` calls in signal/trade/god-mode catch blocks; fix silent catch blocks
- `src/tradeRecovery.ts` — add position history fallback for trades without external_id
- (If found) — fix the MarkdownV2 message source

## Notes
- Wizard fixed `external_id` early-save in `trade.ts` (commit 4e5dfb6) — keep this change
- Wizard added callback_data logging to `bot.catch` — keep this
- Wizard added MarkdownV2 fallback handler in `bot.catch` — keep this
- The config admin SSID works; the users-table admin SSID is stale — not part of this fix
