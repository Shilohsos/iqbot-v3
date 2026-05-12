# Issue #20 — Image Cleanup (delete previous step image)

## Problem

When advancing through the trade wizard steps, old images from previous steps remain visible in the chat while only the text updates. This creates visual clutter — the user sees a "SELECT YOUR PAIR" image from step 2 alongside a "CHOOSE DURATION" text from step 3.

## Expected Behavior

Each step should show **only one image** at a time. When a new step image is sent, the **previous step's image message should be deleted**.

## Implementation

For the trade wizard flow, the approach is:

1. Track the previous image message IDs per user (or per wizard session)
2. When sending a new step image, delete the old image message first

### Trade wizard state
Add a field to track the last image message ID:

```typescript
interface WizardState {
    step: WizardStep;
    mode?: 'demo' | 'live';
    amount?: number;
    timeframe?: number;
    lastImageMsgId?: number;  // <-- new field
}
```

### Flow

| Step | Action | Image shown |
|------|--------|-------------|
| `ui:trade` | Send L4, store msg ID | L4 (From Demo to Reality) |
| Amount step | Delete old L4, send L5 | L5 (Timeframe) |
| Timeframe step | Delete old L5, send L6 | L6 (Pair selection) |
| Pair selected, before analysis | Delete old L6, send L7 | L7 (Analyzing radar) |
| Analysis complete | Delete old L7, send L8 | L8 (Opportunity found) |
| Signal direction | (keep — sent as separate message) | L9a/L9b (Trend) |

### Delete logic
```typescript
// Before sending new image, delete old one
if (state.lastImageMsgId) {
    try { await ctx.telegram.deleteMessage(ctx.chat!.id, state.lastImageMsgId); } catch {}
}
const msg = await ctx.replyWithPhoto(ASSET('L5.png'));
state.lastImageMsgId = msg.message_id;
```

Note: `replyWithPhoto` returns the message — capture its `message_id` into the wizard state.

### Also apply to martingale flow

The martingale loop also sends images (L10, L11a/L11b/L11c). Same cleanup applies — delete the previous image before showing the new one during the recovery sequence.

---

## Files to change

- `src/bot.ts` — WizardState interface, all image send points in trade wizard and martingale loop

---

*Directive: clean up orphaned images so only one step image is visible at a time*
