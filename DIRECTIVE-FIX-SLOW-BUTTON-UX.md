# DIRECTIVE: Fix Slow Button UX — Immediate Feedback + Keepalive

## Problem

Pair handler flow is painfully slow:
1. User clicks pair button
2. `answerCbQuery` stops Telegram's loading spinner (immediate) ✅
3. Bot sends L7 image + progress message "Scanning markets... 10-30 seconds" ✅
4. SDK connect takes **60-194 seconds** — user stares at a frozen message ❌
5. SDK connection times out at 120s → handler dies with raw error text ❌

The progress message says "10-30 seconds" which is a lie. No updates during the wait. Timeout error is ugly.

## Solution

### 1. Fix the progress message (truthful + keeps user informed)

In `src/bot.ts`, the pair handler around line 884-907:

**Change the progress message** from:
```
"Scanning markets...\n⏱ This takes about 10–30 seconds..."
```
to:
```
"Connecting to IQ Option...\n⏱ May take 1–2 minutes..."
```

**Add a 30-second keepalive interval** that updates the message so the user knows the bot isn't frozen:

```typescript
const keepAlive = setInterval(async () => {
    try { await ctx.telegram.editMessageText(
        chatId, progressMsg.message_id, undefined,
        `Selected: ${pair}\n\n🔄 Still connecting...\n⏱ Hold on, almost there..`
    ).catch(() => {}); } catch {}
}, 30_000);
```

**Clear the interval** after connection succeeds:
```typescript
sdk = await Promise.race([...]);
clearInterval(keepAlive);
```

### 2. Better timeout error message

Change the timeout error from:
```
`❌ Could not connect to IQ Option: ${err instanceof Error ? err.message : 'Unknown error'}`
```
to a clean user-friendly message:
```
`❌ IQ Option server took too long to respond.\n\nTry again in a few minutes. If this keeps happening, check your connection or contact support.`
```

### 3. Update the analysis-progress edit too

When analysis finishes (around line 924-929), update the progress message to say "Connected!" before moving on:
```
`✅ Connected! Analyzing market data for ${pair}...`
```
Then when done:
```
`✅ Market scanned — signal found`
```

## Files to modify

Only `src/bot.ts` — the pair handler callback around lines 884-929.

## Acceptance Criteria

- [ ] Progress message says "Connecting to IQ Option..." not "Scanning markets..."
- [ ] Message updates every 30s during connection so user sees bot is alive
- [ ] Timeout error is clean and user-friendly
- [ ] Analysis step shows "Connected!" before "Analyzing..." then "Signal found"
- [ ] `npx tsc` passes clean
- [ ] PM2 restart → bot comes up clean on `master`
