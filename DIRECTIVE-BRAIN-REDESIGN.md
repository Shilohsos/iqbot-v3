# DIRECTIVE: LLM Brain Redesign — Classify Only, Templates for Response

**IMPORTANT:** Merge master first before implementing.

## Problem

The current brain in `src/classifier.ts` does TWO things: (1) classifies user intent and (2) generates response text via DeepSeek. The text generation is the source of all the failures:

- DeepSeek timeouts (20s) → silent fallback to empty "go_home" → user confused
- JSON parse failures → same silent fallback
- Generated text has no brand voice, no consistency
- Every call costs tokens on the generation output

## Solution

Strip text generation. The brain should ONLY classify intent. Response text comes from the pre-written template library (`templates` table in SQLite).

**New flow:**
1. User sends text → enters brain handler
2. Classifier calls DeepSeek with SHORT timeout (5s) → returns ONLY a flow name (e.g. `"reconnect"`)
3. Bot looks up flow name in `templates` table → picks a random template for that flow
4. Sends the template message + its button
5. If DeepSeek times out or fails → fallback to a default template per user segment

## Changes

### 1. `src/classifier.ts` — Simplify

Replace `classifyFlow()`:
- Remove text generation from system prompt
- System prompt now asks ONLY for a flow name (single word)
- `max_tokens: 10` (only need "reconnect" not a paragraph)
- Timeout reduced from `20_000` to `5_000` (5s is enough for classification)
- Response parsing: just read the raw text response (trim + lowercase), validate against VALID_FLOWS
- Remove `GO_HOME_FALLBACK` with empty message — remove `message` from return type entirely

New return type:
```typescript
export interface BrainResult {
    flow: string;
    shouldReply: boolean;
}
```

New system prompt:
```
You are a flow router for a trading bot. Classify the user's message into ONE of these flows:

start_trading, reconnect, continue_onboarding, verify_user_id, fund_account, go_home, help_contact, help_user_id, link_account, create_account, flow_sleep

Rules:
- If user is NOT connected → only link_account, create_account, flow_sleep
- If user is IN an active flow and message is gibberish/accidental → flow_sleep
- If user needs help or is stuck → reconnect or continue_onboarding
- If greeting/thanks → go_home

Respond with ONLY the flow name. No explanations, no extra text.
```

### 2. `src/bot.ts` — Wire template selection

In all 3 brain call sites (lines 4525, 4857, 4676), `FLOW_BUTTONS` lookup → replace with a new function `getBrainReply(flow: string, userId?: number)`:

```typescript
function getBrainReply(flow: string, userId?: number): { message: string; button: any } {
    // 1. Try to select a template from DB matching this flow
    const template = selectTemplateForFlow(flow);
    if (template) {
        return {
            message: template.message,
            button: getButtonForFlow(flow),
        };
    }
    
    // 2. Fallback: hardcoded default messages per flow
    const defaults: Record<string, string> = {
        reconnect: "Your session expired. Tap Reconnect to sign back in.",
        link_account: "Let's get your account connected so you can start trading.",
        start_trading: "Ready to trade? Let's go!",
        go_home: "What can I help you with?",
        help_contact: "Need help? Contact admin below.",
        create_account: "Create your free IQ Option account to get started.",
        fund_account: "Fund your account to start trading live.",
        help_user_id: "Need your User ID? Open IQ Option → Profile → your ID number.",
        verify_user_id: "Please verify your User ID by entering the number.",
        continue_onboarding: "Let's continue where you left off.",
    };
    
    return {
        message: defaults[flow] ?? "How can I help you?",
        button: getButtonForFlow(flow),
    };
}
```

### 3. `src/db.ts` — Add `selectTemplateForFlow()`

```typescript
export function selectTemplateForFlow(flow: string): { message: string; media_file_id?: string } | null {
    const templates = db.prepare(
        'SELECT message, media_file_id FROM templates WHERE category = ? ORDER BY RANDOM() LIMIT 1'
    ).all(flow) as Array<{ message: string; media_file_id: string | null }>;
    
    if (templates.length === 0) return null;
    
    const t = templates[0];
    return {
        message: t.message,
        media_file_id: t.media_file_id ?? undefined,
    };
}
```

If a template has `media_file_id`, send the image before the text message.

### 4. Template audit

The `templates` table has 115 rows but many may be stale (pricing references, wrong promo codes, etc.). Run a quick check:

```sql
SELECT category, COUNT(*) as count FROM templates GROUP BY category ORDER BY count DESC;
```

Flag any categories with 0 templates — those will always hit hardcoded fallback.

## Verification

- [ ] Classifier returns ONLY flow name, no generated text
- [ ] `max_tokens: 10`, timeout 5s
- [ ] `selectTemplateForFlow()` queries `templates` table by category
- [ ] Fallback messages exist for every VALID_FLOWS category
- [ ] Media file_ids sent before text when available
- [ ] Build passes
- [ ] Brain responds instantly (no 20s wait)
- [ ] Brand voice matches the pre-written template library
