# Directive: Broadcast /start Button

## Goal
Add a **🚀 Start Bot** button option when composing broadcasts. When users click it, it triggers the bot's `/start` command via Telegram deep link.

## Why
Admins want users to be able to click a button on broadcast messages that initiates the onboarding flow. Currently available: URL link, Action (Trade/Stats/History/Leaderboard/Menu), No button. Missing: /start trigger.

## Implementation

### 1. Add BOT_USERNAME to env config
- Read bot username from `src/llm.ts` or add `BOT_USERNAME` env var
- Bot username is `Shiloh10xbot` (confirmed via getMe API)
- Either hardcode or add to `.env` as `BOT_USERNAME=Shiloh10xbot`

### 2. Add "Start Bot" to broadcast action keyboard
File: `src/ui/admin.ts`
- Add a new entry to `broadcastActionKeyboard()`:
  ```
  { text: '🚀 Start Bot', callback_data: 'broadcast_action:start' },
  ```
- Place it between existing options (e.g., after Menu)

### 3. Handle the new action
File: `src/bot.ts`
- The existing regex `bot.action(/^broadcast_action:(trade|stats|history|leaderboard|menu)$/, ...)` needs updating to include `start`:
  ```
  /^broadcast_action:(trade|stats|history|leaderboard|menu|start)$/
  ```
- Add to `ACTION_MAP`:
  ```
  start: { text: '🚀 Start Bot', value: '' }  // value unused, type will be 'start'
  ```
- When `key === 'start'`, the button should be a **URL** button (type: 'url'), not a callback button:
  ```typescript
  if (key === 'start') {
      const botUsername = process.env.BOT_USERNAME ?? 'Shiloh10xbot';
      pendingBroadcasts.set(chatId, {
          ...pending,
          button: {
              text: '🚀 Start Bot',
              type: 'url',
              value: `https://t.me/${botUsername}?start=`,
          },
      });
  } else {
      // existing callback button logic
      pendingBroadcasts.set(chatId, {
          ...pending,
          button: { text: action.text, type: 'callback', value: action.value },
      });
  }
  ```

### 4. Add BOT_USERNAME to .env.example
```
BOT_USERNAME=Shiloh10xbot
```

## Testing
1. Admin → Broadcast → select target → write message → skip media → select "Include a link button?" → choose "🚀 Start Bot" → set auto-delete → send
2. Verify the sent message has a clickable button that opens the bot chat and triggers /start
3. Test with test mode ON first (goes to Shara)

## Files to Modify
- `src/ui/admin.ts` — add button to `broadcastActionKeyboard()`
- `src/bot.ts` — handle `start` action, URL button creation
- `.env.example` — add BOT_USERNAME
