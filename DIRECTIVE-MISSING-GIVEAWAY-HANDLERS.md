# Add Missing Giveaway Admin Handlers

## Problem
The admin UI for active giveaways shows these buttons, but they have no handlers:
- `⏹ End Giveaway` (callback: `giveaway_end:{id}`)
- `❌ Delete` (callback: `giveaway_delete:{id}`)
- `👥 View Participants` (callback: `giveaway_participants:{id}`)

Clicking them does nothing — no `bot.action()` handlers exist.

## Fix Required

### 1. Add handler for `giveaway_end:{id}`
In `src/bot.ts`, add after the `giveaway_winners_confirm` handler (around line 2390):

```typescript
bot.action(/^giveaway_end:(\d+)$/, async ctx => {
    await ctx.answerCbQuery('⏹ Ending giveaway…');
    const giveawayId = parseInt(ctx.match[1], 10);
    setGiveawayStatus(giveawayId, 'completed');
    await ctx.reply(`✅ Giveaway #${giveawayId} ended.`, { reply_markup: adminBackKeyboard() });
});
```

Import `setGiveawayStatus` from `'./db.js'` if not already imported.

### 2. Add handler for `giveaway_delete:{id}`
```typescript
bot.action(/^giveaway_delete:(\d+)$/, async ctx => {
    await ctx.answerCbQuery('🗑️ Deleting…');
    const giveawayId = parseInt(ctx.match[1], 10);
    deleteGiveaway(giveawayId);
    await ctx.reply(`✅ Giveaway #${giveawayId} deleted.`, { reply_markup: adminBackKeyboard() });
});
```

Add a new DB function `deleteGiveaway` in `src/db.ts`:
```typescript
export function deleteGiveaway(id: number): void {
    db.prepare('DELETE FROM giveaway_participants WHERE giveaway_id = ?').run(id);
    db.prepare('DELETE FROM giveaway_updates WHERE giveaway_id = ?').run(id);
    db.prepare('DELETE FROM giveaway_events WHERE id = ?').run(id);
}
```

Import `deleteGiveaway` in `bot.ts`.

### 3. Add handler for `giveaway_participants:{id}`
```typescript
bot.action(/^giveaway_participants:(\d+)$/, async ctx => {
    await ctx.answerCbQuery();
    const giveawayId = parseInt(ctx.match[1], 10);
    const participants = getGiveawayParticipants(giveawayId, false); // include non-eligible
    if (participants.length === 0) {
        await ctx.reply('📭 No participants yet.', { reply_markup: adminBackKeyboard() });
        return;
    }
    const text = participants.map((p, i) =>
        `${i + 1}. ${p.fabricated ? '🤖 Fabricated' : '👤 User'} ${p.telegram_id} — ${p.winner ? '🏆 Winner' : p.eligible ? '✅ Eligible' : '❌ Disqualified'}`
    ).join('\n');
    await ctx.reply(`👥 *Participants (${participants.length})*\n\n${text}`, {
        parse_mode: 'Markdown',
        reply_markup: adminBackKeyboard(),
    });
});
```

Import `getGiveawayParticipants` from `'./db.js'` if not already imported (it already appears in the imports at the top of `giveaway.ts`, so may need to add to `bot.ts`).

## Files to modify
- `src/bot.ts` — add 3 bot.action handlers + imports
- `src/db.ts` — add `deleteGiveaway` function

## Verification
1. Open an active giveaway in admin panel
2. Tap "End Giveaway" — should set status to 'completed'
3. Tap "Delete" — should remove giveaway + participants + updates from DB
4. Tap "View Participants" — should show list of participants
