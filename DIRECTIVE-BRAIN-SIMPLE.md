# DIRECTIVE: Brain Simplification — Classify Only

**IMPORTANT:** Merge master first before implementing.

## Current problems
- System prompt is 35 lines with rules, examples, JSON formatting → too many tokens, too many failure modes
- 20s timeout → user waits forever when DeepSeek is slow
- On any failure → silent fallback with empty message → user confused

## Fix

Strip `src/classifier.ts` down. The brain does ONE thing: read a message, pick a flow, reply with the flow name. No text generation, no JSON, no brand voice.

### 1. System prompt

Replace the 35-line prompt with:

```
Classify the user's message into exactly one flow.
Reply with only the flow name — nothing else.

Flows: start_trading, reconnect, continue_onboarding, verify_user_id, fund_account, go_home, help_contact, help_user_id, link_account, create_account, flow_sleep

- User NOT connected → link_account, create_account, flow_sleep
- User stuck/error → reconnect, continue_onboarding
- Greeting/thanks → go_home
- Gibberish/off-topic → flow_sleep
```

### 2. Timeout

Change from 20s to 5s.

### 3. Response parsing

Change the parsing:
- Don't try to parse JSON — just read `choices[0].message.content.trim().toLowerCase()`
- If it matches a valid flow → return that flow with `shouldReply: true`
- If it doesn't match → return `{ flow: 'go_home', shouldReply: true }`

### 4. Remove message from BrainResult

Change `BrainResult`:
```typescript
export interface BrainResult {
    flow: string;
    shouldReply: boolean;
}
```

Remove `message` field entirely. The brain no longer generates text.

### 5. Message handling in bot.ts

In all 3 call sites where brain is invoked, instead of using `brainResult.message`, use a HARDCODED message per flow:

```typescript
const BRAIN_MESSAGES: Record<string, string> = {
    reconnect: "🔐 Your session expired. Tap Reconnect to sign back in.",
    link_account: "🔗 Tap Connect to link your IQ Option account.",
    start_trading: "🚀 Ready to trade? Tap Start Trading below.",
    go_home: "How can I help you? 👇",
    help_contact: "Need help? Contact admin 👇",
    create_account: "Create your free IQ Option account to start 👇",
    fund_account: "💰 Fund your account to trade live.",
    help_user_id: "Your User ID is in IQ Option → Profile.",
    verify_user_id: "Please enter your User ID number.",
    continue_onboarding: "▶️ Let's continue where you left off.",
};
```

On any flow not in the map, or if `shouldReply: false`, respond with:
```
"Tap 👇 to get started."
```
with a start button.

## Files to modify
1. `src/classifier.ts` — system prompt, timeout, parsing, BrainResult
2. `src/bot.ts` — replace `brainResult.message` with hardcoded messages, update BrainResult import

## Verification
- [ ] System prompt stripped down to classifier-only (no examples, no JSON format)
- [ ] Timeout: 5s
- [ ] No JSON parsing — just check if raw response is a valid flow
- [ ] No `message` field in BrainResult
- [ ] Hardcoded messages for every flow in bot.ts
- [ ] Default fallback message for unhandled flows
- [ ] Build passes
