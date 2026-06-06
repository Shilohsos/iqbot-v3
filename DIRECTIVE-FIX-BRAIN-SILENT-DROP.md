# Fix brain silent-drop for non-activated users

## IMPORTANT: Merge master first

```bash
git checkout master && git pull origin master && git checkout -b claude/fix-brain-silent-drop
```

## Problem

At `src/bot.ts:4657`, when the LLM brain returns a flow for a non-activated user, it only responds if the flow is one of `['link_account', 'verify_user_id', 'create_account']`. Any other flow (including `go_home`, which is the fallback when DeepSeek errors or times out) is **silently dropped** — the user sends a message and gets zero response.

Additionally, when the DeepSeek API errors or times out, `classifier.ts` returns `GO_HOME_FALLBACK` (`{ flow: 'go_home', message: '', shouldReply: true }`). For non-activated users, this means the handler returns without any reply.

## Fix

Replace the silent return at line 4657 with a generic signposting message that routes the user to account connection.

**File:** `src/bot.ts`

**Current code (line 4657):**
```typescript
if (!isActivated && !['link_account', 'verify_user_id', 'create_account'].includes(brainResult.flow)) return;
```

**Replace with:**
```typescript
if (!isActivated && !['link_account', 'verify_user_id', 'create_account'].includes(brainResult.flow)) {
    await ctx.reply(
        "You're almost there! Let's get your account connected so you can start trading 💜\n\n👇 Tap below:",
        {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔗 Connect Account', callback_data: 'ui:connect' }],
                ],
            },
        }
    );
    return;
}
```

This ensures non-activated users always get a helpful response instead of silence, even when the brain fails or returns an unexpected flow.

## Verification

1. As a non-activated user, send any text message to the bot
2. You should receive the "You're almost there!" prompt instead of silence
3. Tapping "Connect Account" should start the /connect flow
