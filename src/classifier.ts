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
2. If user is in an onboarding state (entry, awaiting_email, etc.) → continue_onboarding
3. If user hasn't traded (demo_trade_count=0 or null) → start_trading
4. If user asks about funding/deposit → fund_account
5. If user is angry or needs admin → help_contact
6. For anything else → go_home

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

export interface BrainResult {
    flow: string;
    message: string;
    shouldReply: boolean;
}

const GO_HOME_FALLBACK: BrainResult = { flow: 'go_home', message: '', shouldReply: true };

async function classifyFlow(text: string, context: UserContext): Promise<BrainResult> {
    if (!DEEPSEEK_API_KEY) return GO_HOME_FALLBACK;

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

        try {
            const parsed = JSON.parse(raw) as { flow?: string; message?: string };
            const flow = (parsed.flow ?? '').trim().toLowerCase();
            const message = (parsed.message ?? '').trim();
            if (VALID_FLOWS.has(flow) && message) {
                return { flow, message, shouldReply: true };
            }
        } catch {
            // JSON parse failed — fall through to go_home
        }
        return GO_HOME_FALLBACK;
    } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
            console.warn('[brain] DeepSeek request timed out');
            return GO_HOME_FALLBACK;
        }
        console.warn('[brain] error:', err instanceof Error ? err.message : err);
        return GO_HOME_FALLBACK;
    } finally {
        clearTimeout(timeoutId);
    }
}

export async function getBrainFlow(
    userId: number,
    text: string,
    context: UserContext,
): Promise<BrainResult> {
    if (getConfig('features_paused') === '1') return { flow: 'go_home', message: '', shouldReply: false };
    if (!checkRateLimit(userId)) return { flow: 'go_home', message: '', shouldReply: false };

    // Pre-check: missing or expired SSID → always reconnect before calling DeepSeek
    if (!context.has_ssid || context.ssid_valid === 0) {
        return {
            flow: 'reconnect',
            message: context.has_ssid
                ? 'Your IQ Option session expired. Tap Reconnect to sign back in 👇'
                : 'You need to connect your IQ Option account. Tap Connect to get started 🟣',
            shouldReply: true,
        };
    }

    return classifyFlow(text, context);
}
