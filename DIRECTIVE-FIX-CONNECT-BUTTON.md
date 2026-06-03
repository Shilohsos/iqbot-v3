# Fix: "Connect IQ Option" Button in Follow-up Message

**IMPORTANT: Merge master first** — this branch may not include latest master.

## Bug

In `src/channel.ts`, line 108, the "Connect IQ Option" button in the re-engagement follow-up message has the wrong callback_data:

```ts
{ text: '🔗 Connect IQ Option', callback_data: 'ui:trade' },
```

When a user taps this button expecting to connect their IQ Option account, it instead opens the trade menu ("Trade live | Trade Demo").

## Fix

Change the callback_data from `'ui:trade'` to `'ui:connect'`:

```ts
{ text: '🔗 Connect IQ Option', callback_data: 'ui:connect' },
```

The `bot.action('ui:connect', ...)` handler at line 1480 of `bot.ts` correctly starts the connect flow by asking for the user's email.

## Files Changed

1. `src/channel.ts` — line 108, one callback_data value
