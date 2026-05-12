# Issue 30 — Final Fix Required: pair: handler blocking

## Problem
The `bot.action(/^pair:(.+)$/)` handler at `src/bot.ts:763` still blocks the event loop for up to 90 seconds.

Current flow (still blocking):
```
answerCbQuery()  (line 771)
  → analyzePair()  (line 786 — can take 90s) ❌ blocks here
  → send images
  → runMartingale()
```

## Required Fix
Restructure so nothing blocks inside the callback_query handler. Send progress messages first, then execute:

```typescript
bot.action(/^pair:(.+)$/, async ctx => {
    // … session checks …
    await ctx.answerCbQuery();                        // ← stops loading spinner

    // Send progress message IMMEDIATELY
    const progressMsg = await ctx.reply(
        `Selected: ${pair}\n\n🔍 Scanning markets...\n⏱ This takes about 10–30 seconds...`
    );

    // NOW run the heavy work — user sees progress message, not dead spinner
    let analysis: AnalysisResult;
    try {
        analysis = await analyzePair(ssid, pair, timeframe);
    } catch (err: unknown) {
        await ctx.telegram.editMessageText(
            ctx.chat!.id, progressMsg.message_id, undefined,
            `❌ Analysis failed: ${err instanceof Error ? err.message : 'Unknown error'}`
        );
        return;
    }

    // Replace progress msg with result
    await ctx.telegram.editMessageText(
        ctx.chat!.id, progressMsg.message_id, undefined,
        `✅ Analysis complete for ${pair}`
    );

    // … send images and run trade …
});
```

## Why this matters
Without this fix, the entire bot freezes while `analyzePair` runs. The user taps a pair → sees "Loading..." stop (because answerCbQuery fires) → then the bot goes silent for 90s. If the user taps again during that window, multiple handlers queue up. The progress message pattern solves all of this.
