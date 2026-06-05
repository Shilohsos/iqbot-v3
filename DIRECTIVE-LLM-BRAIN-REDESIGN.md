# Directive: Redesign LLM Brain — Push Users Into Flows

**IMPORTANT: Merge master first**

## Overview

Completely replaces the LLM Brain system. The old system classified user messages into 25 intent categories and responded with pre-written templates. The new system uses DeepSeek V4 Flash to detect what flow a user should be pushed into, then sends a short message with a single button to push them there.

**Key changes:**
1. Switch from OpenRouter → DeepSeek API (already configured in .env)
2. Brain no longer responds conversationally — it always pushes to a flow with a button
3. System prompt redesigned for flow routing, not intent classification
4. Response handler in bot.ts rewritten to map flow actions to pre-written messages + buttons

## Changes Required

### 1. Replace `src/classifier.ts` entirely

**Old file (123 lines):** Classifies into 25 categories, returns a template. Uses OpenRouter.

**New file:** Analyzes user message + user context, returns a flow action. Uses DeepSeek.

```typescript
import { getConfig } from './db.js';

const DEEPSEEK_API_KEY  = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_MODEL    = process.env.DEEPSEEK_MODEL ?? 'deepseek-chat';
const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1';

const VALID_FLOWS = new Set([
    'start_trading',
    'reconnect',
    'continue_onboarding',
    'verify_user_id',
    'fund_account',
    'go_home',
    'help_contact',
]);

const SYSTEM_PROMPT = `You are a flow router for a trading bot called "10x Bot".

A user has sent a message. Your job is to decide which flow to push them into AND write a short, contextual reply telling them what to do next.

You receive their message AND their current state in the bot.

Available flows:
- start_trading — User wants to trade or hasn't started yet. Push to trading.
- reconnect — User's session is expired or they can't connect. Push to reconnect.
- continue_onboarding — User is in the middle of setting up. Push to continue.
- verify_user_id — User sent what looks like a numeric User ID (7-10 digits).
- fund_account — User wants to deposit or fund their account.
- go_home — General help, what to do, menu. Push to main menu.
- help_contact — User needs human help, complaining, frustrated.

Rules:
1. If the message is a number with 7-10 digits → verify_user_id
2. If user has no SSID or ssid_valid=0 → reconnect
3. If user is in an onboarding state (entry, awaiting_email, etc.) → continue_onboarding
4. If user hasn't traded (demo_trade_count=0 or null) → start_trading
5. If user asks about funding/deposit → fund_account
6. If user is angry or needs admin → help_contact
7. For anything else → go_home

Your reply message must:
- Be SHORT (1-2 lines max)
- BRIEFLY explain what the user should do next — one clear instruction
- Feel like a real person, not a robot
- Use the user's language/energy level from their message

Example good messages:
- "Your session expired. Tap Reconnect and enter your email/password to get back in 👇"
- "You haven't started trading yet. Hit Start Trading and let's make moves 💜"
- "Let's get your account setup first. Tap Continue below 👇"
- "You need to fund your account to trade live. Tap Fund Account when you're ready 🟣"
- "Drop your IQ Option User ID below and I'll get you verified 🆔"

Respond with ONLY a JSON object in this exact format — no other text:
{"flow": "action_name", "message": "your short reply here"}

Examples:
{"flow": "reconnect", "message": "Your session expired. Tap Reconnect to sign back in 👇"}
{"flow": "start_trading", "message": "You haven't traded yet. Tap Start Trading and let's go 💜"}
{"flow": "go_home", "message": "What would you like to do? Check your balance or start trading 👇"}`;

const rateLimitMap = new Map<number, number>();
const RATE_LIMIT_MS = 5_000;

function checkRateLimit(userId: number): boolean {
    const last = rateLimitMap.get(userId) ?? 0;
    if (Date.now() - last < RATE_LIMIT_MS) return false;
    rateLimitMap.set(userId, Date.now());
    return true;
}

export interface UserContext {
    onboarding_state: string | null;
    ssid_valid: number | null;
    has_ssid: boolean;
    demo_trade_count: number | null;
    tier: string;
}

async function classifyFlow(text: string, context: UserContext): Promise<string> {
    if (!DEEPSEEK_API_KEY) return 'go_home';

    const contextStr = [
        `User state: onboarding="${context.onboarding_state ?? 'none'}",`,
        `ssid_valid=${context.ssid_valid ?? 'null'},`,
        `has_ssid=${context.has_ssid},`,
        `demo_trade_count=${context.demo_trade_count ?? 0},`,
        `tier=${context.tier}`,
    ].join(' ');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);

    try {
        const resp = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
            },
            body: JSON.stringify({
                model: DEEPSEEK_MODEL,
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: `Message: "${text}"\n\n${contextStr}` },
                ],
                max_tokens: 150,
                temperature: 0.3,
            }),
            signal: controller.signal,
        });

        if (!resp.ok) throw new Error(`DeepSeek ${resp.status}`);
        const data = await resp.json() as { choices: Array<{ message: { content: string } }> };
        const raw = (data.choices[0]?.message?.content ?? '').trim();

        // Parse JSON response: {"flow": "...", "message": "..."}
        try {
            const parsed = JSON.parse(raw);
            const flow = (parsed.flow ?? '').trim().toLowerCase();
            const message = (parsed.message ?? '').trim();
            if (VALID_FLOWS.has(flow) && message) {
                return { flow, message };
            }
        } catch {
            // JSON parse failed — fall through to go_home
        }
        return { flow: 'go_home', message: '' };
    } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
            console.warn('[brain] DeepSeek request timed out');
            return { flow: 'go_home', message: '' };
        }
        console.warn('[brain] error:', err instanceof Error ? err.message : err);
        return { flow: 'go_home', message: '' };
    } finally {
        clearTimeout(timeoutId);
    }
}

export interface BrainResult {
    flow: string;
    message: string;
    shouldReply: boolean;
}

export async function getBrainFlow(
    userId: number,
    text: string,
    context: UserContext,
): Promise<BrainResult> {
    if (getConfig('features_paused') === '1') return { flow: 'go_home', message: '', shouldReply: false };
    if (!checkRateLimit(userId)) return { flow: 'go_home', message: '', shouldReply: false };

    return await classifyFlow(text, context);
}
```

### 2. Add flow action mapping in `src/bot.ts`

Add a constant mapping flow actions to buttons only (messages come from DeepSeek now). Place near the top of bot.ts where other UI constants are:

```typescript
const FLOW_BUTTONS: Record<string, {
    text: string;
    action: string | { url: string };
}> = {
    start_trading:    { text: '🚀 Start Trading',    action: 'ui:trade' },
    reconnect:        { text: '🔗 Reconnect',        action: 'ui:connect' },
    continue_onboarding: { text: '▶️ Continue',     action: 'ui:start' },
    verify_user_id:   { text: '👤 Contact Admin',    action: { url: process.env.ADMIN_CONTACT_LINK ?? 'https://t.me/shiloh_is_10xing' } },
    fund_account:     { text: '💰 Fund Account',     action: { url: 'https://iqoption.com/pwa/payments/deposit' } },
    go_home:          { text: '🏠 Menu',              action: 'ui:start' },
    help_contact:     { text: '👤 Contact Admin',    action: { url: process.env.ADMIN_CONTACT_LINK ?? 'https://t.me/shiloh_is_10xing' } },
};
```

### 3. Update the brain response handler in `src/bot.ts`

Replace the old brain response section (currently around lines 4395-4416).

**Current code:**
```typescript
// ── LLM brain fallthrough ─────────────────────────────────────────────────
// Only for non-wizard, non-admin, non-onboarding messages
const wiz = wizardSessions.get(chatId);
if (!wiz) {
    const brainTemplate = await getBrainResponse(ctx.from!.id, text).catch(() => undefined);
    if (brainTemplate) {
        const user2 = getUser(ctx.from!.id);
        const name2 = ctx.from?.first_name ?? ctx.from?.username ?? 'there';
        const pidginEnabled = user2?.pidgin_enabled === 1;
        let msg2 = resolveUsernameTemplate(brainTemplate.message, name2);
        if (pidginEnabled) msg2 = applyPidgin(msg2);
        const markup2 = brainTemplate.button_text && brainTemplate.button_url
            ? { inline_keyboard: [[{ text: brainTemplate.button_text, url: brainTemplate.button_url }]] }
            : undefined;
        if (brainTemplate.media_file_id) {
            await ctx.replyWithPhoto(brainTemplate.media_file_id, { caption: msg2, ...(markup2 ? { reply_markup: markup2 } : {}) });
        } else {
            await ctx.reply(msg2, { ...(markup2 ? { reply_markup: markup2 } : {}) });
        }
    }
    return;
}
```

**Replacement code:**
```typescript
// ── LLM brain — push to flow ─────────────────────────────────────────────
const brainWiz = wizardSessions.get(chatId);
if (!brainWiz) {
    const user = getUser(ctx.from!.id);
    const context: UserContext = {
        onboarding_state: user?.onboarding_state ?? null,
        ssid_valid: user?.ssid_valid ?? null,
        has_ssid: !!user?.ssid,
        demo_trade_count: user ? getDemoTradeCount(user.telegram_id) : null,
        tier: user?.tier ?? 'DEMO',
    };
    const brainFlow = await getBrainFlow(ctx.from!.id, text, context).catch(() => ({ flow: 'go_home', message: '', shouldReply: true }));
    if (brainFlow.shouldReply && brainFlow.flow) {
        const btn = FLOW_BUTTONS[brainFlow.flow] ?? FLOW_BUTTONS.go_home;
        // Use DeepSeek's contextual message if available, fall back to static
        const replyText = brainFlow.message || btn.text;
        let replyMarkup: { inline_keyboard: Array<Array<{ text: string; callback_data?: string; url?: string }>> } | undefined;
        
        if (typeof btn.action === 'string') {
            replyMarkup = { inline_keyboard: [[{ text: btn.text, callback_data: btn.action }]] };
        } else {
            replyMarkup = { inline_keyboard: [[{ text: btn.text, url: btn.action.url }]] };
        }
        
        await ctx.reply(replyText, { reply_markup: replyMarkup });
    }
    return;
}
```

### 4. Update imports in `src/bot.ts`

**Remove:**
```typescript
import { getBrainResponse } from './classifier.js';
```

**Add:**
```typescript
import { getBrainFlow } from './classifier.js';
import type { UserContext } from './classifier.js';
```

Also ensure `getDemoTradeCount` is imported from `./db.js` (add if missing).

## Verification

1. `npx tsc --noEmit` — must pass with zero errors
2. Send "hello" to the bot → DeepSeek responds with contextual message + [🚀 Start Trading] button
3. Send a 9-digit number → DeepSeek detects User ID pattern + [👤 Contact Admin] button
4. Send "I can't connect" with expired SSID → DeepSeek responds about session + [🔗 Reconnect] button
5. DeepSeek's message is always contextual (tells user what to do next) — every response has a button pushing to a flow
6. Bot should not crash or hang on DeepSeek API timeout (10s fallback to go_home)

## Migration

No DB changes. No template changes. The old brain templates (56 templates across 19 categories) remain in the DB but are no longer used by this flow — they become archival. Can be cleaned up later if desired.
