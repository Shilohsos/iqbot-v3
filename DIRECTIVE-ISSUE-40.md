# Issue 40: 1-hour auto-delete misses pre-trade messages from pair handler

## Symptom
Only the trade result messages (win/loss/recovery) are deleted after 1 hour. The opportunity images (L7, L8, L9a/b) and the "OPPORTUNITY FOUND" text message remain in the chat forever.

## Root cause
The `pair:` handler (lines 806-870 in `src/bot.ts`) sends several messages before calling `runMartingale`:
- Line 827: L7.png (analyzing radar image)
- Line 828: progress message ("Selected: GBPUSD-OTC\nScanning markets...")
- Line 847-850: progress message edited to "✅ Market scanned — signal found for..."
- Line 852: L8.png (opportunity found image)
- Line 855: L9a.png or L9b.png (signal direction image)
- Line 856-860: "OPPORTUNITY FOUND" text message

NONE of these message IDs are tracked for auto-delete. The `runMartingale` function has its own `sentMessages[]` array (line 463) and `scheduleCleanup()` (line 465-473), but it only contains messages that runMartingale itself sent.

## Required
All messages from the trade flow must be cleaned up after 1 hour — including the pre-trade images and opportunity text from the `pair:` handler.

## Fix

**In src/bot.ts — `runMartingale` function:**

Change the signature to accept an optional array of pre-existing message IDs:

```typescript
async function runMartingale(
    ctx: Context,
    ssid: string,
    pair: string,
    direction: 'call' | 'put',
    amount: number,
    timeframeSec = 60,
    balanceType: 'demo' | 'live' = 'demo',
    martingaleRounds?: number,
    preExistingMessageIds: number[] = [],  // ← NEW PARAMETER
): Promise<void> {
```

Then initialize `sentMessages` with both the log message and the pre-existing IDs:

```typescript
const logMsg = await ctx.reply(logLines.join('\n'));
const sentMessages: number[] = [logMsg.message_id, ...preExistingMessageIds];
```

**In src/bot.ts — `pair:` handler (around lines 852-860):**

Collect all message IDs before calling runMartingale:

```typescript
const preTradeMsgIds: number[] = [];

// L8
try { const m = await ctx.replyWithPhoto(ASSET('L8.png')); preTradeMsgIds.push(m.message_id); } catch {}
const signalImg = analysis.direction === 'call' ? 'L9b.png' : 'L9a.png';
const dirStr = analysis.direction === 'call' ? '🟢 CALL SIGNAL' : '🔴 PUT SIGNAL';
// L9
try { const m = await ctx.replyWithPhoto(ASSET(signalImg)); preTradeMsgIds.push(m.message_id); } catch {}
// Opportunity text
const oppMsg = await ctx.reply(
    `OPPORTUNITY FOUND...`
);
preTradeMsgIds.push(oppMsg.message_id);

// ... concurrency check ...

await runMartingale(ctx, ssid, pair, ..., preTradeMsgIds);
```

Also track the edited progress message (line 847-850) — since it's already tracked via the original progress message, and that was edited (not a new message), we just need the original `progressMsg.message_id`. Add it to preTradeMsgIds too:

```typescript
const progressMsg = await ctx.reply(...);  // already line 828
preTradeMsgIds.push(progressMsg.message_id);  // ← TRACK IT
```

### Acceptance Criteria
- [ ] L7.png image deleted after 1 hour
- [ ] Scanning progress message deleted after 1 hour
- [ ] L8.png (opportunity found) deleted after 1 hour
- [ ] L9a/L9b.png (signal direction) deleted after 1 hour
- [ ] "OPPORTUNITY FOUND" text message deleted after 1 hour
- [ ] Trade log and result messages still deleted after 1 hour (no regression)
- [ ] Analysis failure messages also cleaned up (line 838-841 path)
