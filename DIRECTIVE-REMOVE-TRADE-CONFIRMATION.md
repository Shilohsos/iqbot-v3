# DIRECTIVE: Remove Trade Confirmation Step

## Change
Skip the "Confirm Trade" screen. When user completes the trade wizard (pair, amount, timeframe), execute immediately — no confirmation, no cancel.

## What to Change

### `src/bot.ts` — wizard completion flow (~lines 1089-1114)

**REMOVE** the confirmation dialog block:
```typescript
        // Show trade confirmation dialog          ← REMOVE
        const modeLabel = ...                      ← REMOVE
        const confirmCard = await ctx.reply(       ← REMOVE
            `📋 *Trade Summary*...`,              ← REMOVE
            { inline_keyboard: [[                 ← REMOVE
                { text: '✅ Confirm Trade' ... },  ← REMOVE
                { text: '❌ Cancel' ... },         ← REMOVE
            ]]},                                  ← REMOVE
        ).catch(() => undefined);                 ← REMOVE
        if (confirmCard) preTradeMessageIds.push(confirmCard.message_id);  ← REMOVE

        pendingTrades.set(ctx.from!.id, {         ← REMOVE
            pair, direction: analysis.direction,  ← REMOVE
            amount, timeframe,                    ← REMOVE
            mode: (mode ?? 'demo') as ...         ← REMOVE
            ssid, preTradeMessageIds: [...]       ← REMOVE
        });                                       ← REMOVE
        logger.trade('confirm_shown', ...)        ← REMOVE
```

**REPLACE WITH** direct execution (inlined from `trade:confirm` handler):
```typescript
        // Execute trade immediately — no confirmation
        const execUser = getUser(ctx.from!.id);
        const execTier = normalizeTier(execUser?.tier);
        const execCfg = getTierConfig(execTier);
        const execCount = activeTradeSessions.get(ctx.from!.id) ?? 0;
        if (execCount >= execCfg.maxConcurrentTrades) {
            await ctx.reply('⚠️ You already have an active trade. Wait for it to finish.');
            return;
        }

        const mgSettings = getUserMartingaleSettings(ctx.from!.id);
        const martingaleRounds = mgSettings.enabled ? mgSettings.maxRounds : 1;
        logger.trade('executing', pair, ctx.from!.id, `$${amount} ${tfLabel(timeframe)} ${mode}`);

        try {
            const execSdk = await sdkPool.get(ctx.from!.id, ssid);
            await runMartingale(ctx, ssid, pair, analysis.direction, amount, timeframe,
                (mode ?? 'demo') as 'demo' | 'live', martingaleRounds, [...preTradeMessageIds], execSdk);
        } catch (err: unknown) {
            logger.error('bot', 'direct trade execution failed', err);
            await ctx.reply(friendlyError(err, '⚠️ Trade failed. Please try again.')).catch(() => {});
        } finally {
            sdkPool.release(ctx.from!.id);
        }
```

### Keep (do not delete)
- `trade:confirm` handler — keep for backward compat (in-flight confirm buttons won't crash, just show "timed out")
- `trade:cancel` handler — same, keep for backward compat
- `pendingTrades` map — keep, may be referenced elsewhere

## Files Modified
- `src/bot.ts` only — replace confirmation block with direct execution

## Verification
1. `npx tsc` — no errors
2. `/start` → Trade → pick pair → enter amount → pick timeframe → trade executes immediately
3. No "Confirm Trade" / "Cancel" buttons appear
