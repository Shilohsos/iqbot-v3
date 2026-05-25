# DIRECTIVE: Giveaway Detail View — Add Action Buttons

## Problem
When admin views an active giveaway (`giveaway_view:{id}`), the response is all plain text with only a "Back" button (line 2336). There are no action buttons — can't pick winners, view participants, edit, or end the giveaway from the detail view.

## Fix
In `src/bot.ts`, `bot.action(/^giveaway_view:(\d+)$/, ...)` handler (line 2316), replace the single `adminBackKeyboard()` with a contextual action keyboard that depends on the giveaway's status.

### Current (line 2336):
```ts
await ctx.reply(info, { parse_mode: 'Markdown', reply_markup: adminBackKeyboard() });
```

### New:
```ts
const viewKeyboard = giveawayViewKeyboard(event);
await ctx.reply(info, { parse_mode: 'Markdown', reply_markup: viewKeyboard });
```

### New keyboard function (in `src/ui/admin.ts`):
```ts
export function giveawayViewKeyboard(event: GiveawayEvent): IKMarkup {
    const rows: Btn[][] = [];
    if (event.status === 'active') {
        rows.push([{ text: '🏆 Pick Winners', callback_data: `giveaway_winners:${event.id}` }]);
        rows.push([{ text: '👥 View Participants', callback_data: `giveaway_participants:${event.id}` }]);
        rows.push([{ text: '⏹ End Giveaway', callback_data: `giveaway_end:${event.id}` }]);
    }
    if (event.status === 'pending') {
        rows.push([{ text: '▶️ Activate Now', callback_data: `giveaway_activate:${event.id}` }]);
    }
    if (event.event_type === 'marathon') {
        rows.push([{ text: '📊 Leaderboard', callback_data: `marathon:leaderboard:${event.id}` }]);
    }
    rows.push([{ text: '❌ Delete', callback_data: `giveaway_delete:${event.id}` }]);
    rows.push([{ text: '🔙 Giveaways', callback_data: 'admin:giveaways' }]);
    return { inline_keyboard: rows };
}
```

### Also
Make giveaway list items clickable — verify `activeGiveawaysKeyboard()` (line 276 in admin.ts) generates proper inline keyboard buttons. The current code looks correct but confirm it actually renders as buttons, not plain text.
