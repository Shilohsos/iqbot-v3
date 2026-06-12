# Directive: Signal UI Overhaul — One Message, In-Place Edits Like AI Trading

**IMPORTANT: Merge master first** before implementing. This directive was written on master and references current code.

## Goal

Signal tracking notifications currently send **separate new messages** for every martingale round (won/lost). This creates chat clutter. Instead, **edit the original signal card in-place** — exactly like AI Trading updates its trade activity message.

## Requirements

1. **One message only** — the signal card. No separate prep countdown message.
2. **Prep countdown edits the card** — countdown timer ticks edit the same card message.
3. **Signal Active! edits the card** — when prep ends, the card shows active status.
4. **Tracking results edit the card** — every martingale round update edits the same card.
5. **"🔄 New Signal" button only on final result** — win OR all rounds exhausted. Hidden during progression.
6. **Martingale rounds carry the card message ID** — so they can edit the same message.

## Code Changes

### A. DB Schema (db.ts)

Add two columns to `signal_tracking` table:

```sql
card_chat_id INTEGER  -- chat_id where the signal card was sent
card_msg_id  INTEGER  -- message_id of the signal card
```

Add them to:
- `CREATE TABLE IF NOT EXISTS signal_tracking` — add columns to schema
- `ALTER TABLE` migration for existing DBs (wrapped in try/catch since column may already exist)
- `SignalTrackRecord` interface — add optional `card_chat_id?: number; card_msg_id?: number;`

### B. insertSignalTrack (db.ts)

Update function signature to accept optional `card_chat_id` and `card_msg_id` params, and INSERT them:

```typescript
export function insertSignalTrack(r: {
    telegram_id: number; pair: string; direction: string;
    timeframe: number; entry_time: string; expiry_time: string;
    round: number; max_rounds: number; entry_price: number | null;
    card_chat_id?: number; card_msg_id?: number;
}): void {
    // INSERT with card_chat_id and card_msg_id included
}
```

### C. Signal Card Creation in `stf:` handler (bot.ts)

In the `bot.action(/^stf:(\d+)$/, ...)` handler:

1. **Capture the card message_id** by `await ctx.reply(card, ...)` and storing the returned message object
2. **Remove "🔄 New Signal" button** from the initial card — keep only "🔙 Back"
3. **Pass `card_chat_id` and `card_msg_id`** to the `insertSignalTrack` call
4. **Remove the separate `prepMsg`** — do NOT send a second message for prep countdown
5. **Edit the card for countdown** — use `cardMsg.message_id` instead of `prepMsg.message_id`:
   - During countdown: keep signal header, show countdown text
   - After countdown: keep signal header, show "✅ Signal Active! Entry at X Direction: Y"
6. Store `cardMsg.message_id` as `card_msg_id` in the insertSignalTrack call

### D. Tracking Loop Notifications (bot.ts, ~line 6109-6151)

In the `setInterval` tracking loop:

1. **Replace `bot.telegram.sendMessage()` with `bot.telegram.editMessageText()`** on the stored card message
2. **Only show "🔄 New Signal" button on final result** (win OR `sig.round >= sig.max_rounds`):
   - Intermediate round (lost, rounds remain): edit card text, NO button keyboard (or keep existing keyboard)
   - Final result (won OR all exhausted): edit card text, WITH "🔄 New Signal" button
3. **Carry card_chat_id and card_msg_id** into martingale round `insertSignalTrack` calls
4. **Fallback**: if `editMessageText` fails OR card_msg_id is null, use `sendMessage` as fallback
5. **Update progress text**: show "Round X/4" format instead of "Level X"

### E. File References

- `/root/iqbot-v3/src/bot.ts` — stf: handler (signal creation), tracking loop (results)
- `/root/iqbot-v3/src/db.ts` — signal_tracking table schema, insertSignalTrack, SignalTrackRecord

## Verification

1. Run `npx tsc` — must compile clean
2. Open a signal → see only ONE message sent (the card)
3. Watch the countdown → card text updates every 10s
4. After prep → card shows "Signal Active!"
5. After expiry → card shows result (won/lost)
6. On loss with rounds left → SAME card shows "Round X/4 queued" — NO new message, NO "New Signal" button
7. On final win or exhaustion → SAME card shows final result + "🔄 New Signal" button
