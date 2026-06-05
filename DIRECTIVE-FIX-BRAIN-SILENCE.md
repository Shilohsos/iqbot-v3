# Fix: Brain no longer ignores casual messages

## IMPORTANT: Merge master first

---

## Problem

The brain's system prompt (rule 4) tells the LLM to silently ignore any greeting, thanks, or casual chat — `flow_sleep` with no response. This means connected users saying "Hi" or "Hello" get zero reply, making the bot appear dead.

## Fix

**File:** `src/classifier.ts`

Replace rule 4 in the `SYSTEM_PROMPT` constant. Change from:

```
4. If the user just sent a greeting, thanks, or casual chat → flow_sleep (no response).
```

To:

```
4. If the user is in an active flow and the message looks like a mistake (accidental text, gibberish, off-topic) → flow_sleep.
   If the user is idle and sends a greeting/thanks/casual chat → reply briefly with go_home or help_contact.
```

Also update the example at the bottom: remove the `flow_sleep` example and add a greeting-handling one:

```
{"flow": "reconnect", "message": "Your session expired. Tap Reconnect to sign back in 👇", "shouldReply": true}
{"flow": "start_trading", "message": "Hey! You ready to trade? Tap Start Trading and let's make moves 💜", "shouldReply": true}
{"flow": "go_home", "message": "Hey! What can I help you with? 👇", "shouldReply": true}
```

---

## Behaviour after fix

| User sends | Before | After |
|---|---|---|
| "Hi" (idle, connected) | ❌ Silence | ✅ Friendly reply + go_home |
| "Hello" (idle, connected) | ❌ Silence | ✅ Friendly reply + go_home |
| Gibberish mid-flow | ✅ flow_sleep | ✅ flow_sleep (same) |
| Greeting mid-flow | ❌ Silence | ✅ flow_sleep (user is mid-setup) |
