# Issue #27 — Broadcast final enhancements

## Feature 1: Action buttons (not just URL buttons)

Currently the broadcast link button only supports URLs. The admin should be able to create buttons that **trigger bot actions** on the client's side — like starting a trade, showing the menu, etc.

### Flow

When the admin is prompted to add a link button, instead of just asking for a URL, ask:

```
📎 Include a button?

[1] 🔗 URL link
[2] ⚡ Action (trigger bot flow)
[3] No button
```

If admin picks [2] Action, show available actions:

```
Select action for button:

• 🎯 Trade Now
• 📊 Stats
• 📆 History
• 🏆 Leaderboard
• 📋 Menu
```

Each action maps to an existing callback_data:

| Button Label | Callback Data |
|-------------|---------------|
| 🎯 Trade Now | `ui:trade` |
| 📊 Stats | `ui:stats` |
| 📆 History | `ui:history` |
| 🏆 Leaderboard | `leaderboard:show` (or implement new) |
| 📋 Menu | `ui:start` |

### Implementation

Instead of storing `linkButton` as `{ text: string; url: string }`, store it as:

```typescript
interface BroadcastButton {
    text: string;
    type: 'url' | 'callback';
    value: string; // URL or callback_data
}
```

When sending the broadcast, use the appropriate button type:

```typescript
const button = pending.button;
const keyboard = button ? {
    reply_markup: {
        inline_keyboard: [[
            button.type === 'url' 
                ? { text: button.text, url: button.value }
                : { text: button.text, callback_data: button.value }
        ]]
    }
} : {};
```

### BroadcastPending update
```typescript
interface BroadcastPending {
    message: string;
    targetIds: number[];
    button?: BroadcastButton;
    media?: { type: 'photo' | 'video'; fileId: string };
}
```

---

## Feature 2: Customizable auto-delete timer

Currently timers are fixed: 5m, 15m, 1h, Never. Add a **custom** option.

### Flow

After adding button/media, bot shows timer selection:

```
⏱ Auto-delete after?

[5m] [15m] [1h] [✏️ Custom] [Never]
```

If admin clicks "✏️ Custom", bot asks:

```
⏱ Enter custom duration (e.g. 30m, 2h, 45s, 90):
```

Admin types a duration string. Parse it:

```typescript
function parseDuration(input: string): number | null {
    input = input.trim().toLowerCase();
    const match = input.match(/^(\d+)\s*(s|m|h|min)?$/);
    if (!match) return null;
    const num = parseInt(match[1], 10);
    const unit = match[2] || 'm'; // default to minutes
    if (unit === 's') return num * 1000;
    if (unit === 'm' || unit === 'min') return num * 60_000;
    if (unit === 'h') return num * 3_600_000;
    return null;
}
```

If invalid, show error and ask again. If valid, proceed with the custom timer value.

Also add a **"✏️ Custom"** button to the `broadcastTimerKeyboard()` in admin.ts.

### Updated keyboard (admin.ts)
```typescript
export function broadcastTimerKeyboard(): IKMarkup {
    return {
        inline_keyboard: [[
            { text: '5m',    callback_data: 'bcast_timer:300000' },
            { text: '15m',   callback_data: 'bcast_timer:900000' },
            { text: '1h',    callback_data: 'bcast_timer:3600000' },
            { text: '✏️ Custom', callback_data: 'broadcast:custom_timer' },
            { text: 'Never', callback_data: 'bcast_timer:0' },
        ]],
    };
}
```

### Custom timer handler
```typescript
bot.action('broadcast:custom_timer', async ctx => {
    await ctx.answerCbQuery();
    const pending = pendingBroadcasts.get(ctx.chat!.id);
    if (!pending) { await ctx.reply('❌ Session expired.', { reply_markup: adminBackKeyboard() }); return; }
    adminSessions.set(ctx.chat!.id, { step: 'broadcast_custom_timer' });
    await ctx.reply('⏱ Enter custom duration (e.g. 30m, 2h, 45s):');
});
```

### Text handler for custom timer
In the admin section of the text handler:
```typescript
if (as.step === 'broadcast_custom_timer') {
    const ms = parseDuration(text);
    if (ms === null) {
        await ctx.reply('❌ Invalid format. Use e.g. 30m, 2h, 45s:');
        return;
    }
    // Re-trigger the bcast_timer send with the custom ms value
    // ... same logic as bcast_timer handler
}
```

---

## Files

- `src/bot.ts` — button type selection, action keyboard, custom timer parsing + handler, BroadcastPending interface update
- `src/ui/admin.ts` — add custom timer button to broadcastTimerKeyboard, add action selection keyboard
