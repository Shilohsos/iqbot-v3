# DIRECTIVE: Brain Fix — Short Prompt, Short Timeout, Always Replies

**IMPORTANT:** Merge master first before implementing.

## Changes to `src/classifier.ts`

### 1. Replace system prompt

Current: 35 lines, over-prescriptive, JSON format, lots of examples.
Replace with:

```
You're a helper for a trading bot. The user sent you a message.

Decide what they need and reply with a JSON object:
{"flow": "flow_name", "message": "short reply"}

Flows: start_trading, reconnect, continue_onboarding, verify_user_id, fund_account, go_home, help_contact, help_user_id, link_account, create_account, flow_sleep

- Not connected? → link_account or create_account
- Stuck or error? → reconnect or continue_onboarding
- Greeting/thanks/casual? → go_home
- Gibberish/off-topic? → flow_sleep with shouldReply: false

Keep the message short. 1-2 sentences. Natural tone.
```

### 2. Reduce timeout

Change from `20_000` to `5_000` (5 seconds).

### 3. Add hardcoded fallback messages

When the API fails or returns invalid JSON, the bot should still reply with something useful. Add a constant in bot.ts:

```typescript
const FALLBACK_MESSAGES: Record<string, string> = {
    reconnect: "Your session expired — tap Reconnect to sign back in.",
    link_account: "Tap Connect to link your IQ Option account.",
    start_trading: "Ready? Tap Start Trading to begin.",
    go_home: "How can I help you?",
    help_contact: "Contact admin below for help.",
    create_account: "Create a free IQ Option account to start.",
    fund_account: "Fund your account to trade live.",
    help_user_id: "Your User ID is under your name in IQ Option Profile.",
    verify_user_id: "Enter your User ID number to continue.",
    continue_onboarding: "Let's continue where you left off.",
};
const FALLBACK_DEFAULT = "Tap below to get started 💜";
```

When `brainResult.message` is empty, null, or the API failed → use the fallback message for that flow.

### 4. Keep BrainResult as-is

No changes needed. `{ flow, message, shouldReply }` stays.

## Files to modify
1. `src/classifier.ts` — replace system prompt, change timeout 20→5s
2. `src/bot.ts` — add fallback messages constant, apply fallback when brain returns empty message

## Verification
- [ ] Prompt is clean and short
- [ ] Timeout is 5s
- [ ] Fallback messages exist for every flow
- [ ] Bot always replies to user even when API fails
- [ ] Build passes
