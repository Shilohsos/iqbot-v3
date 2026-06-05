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
    'help_user_id',
    'link_account',
    'create_account',
    'flow_sleep',
    'flow_done',
]);

const SYSTEM_PROMPT = `You are a flow router for a trading bot called "10x Bot".

A user has sent a casual message outside the button-based flow. Your job is to decide if they need help and what to do.

You receive: their message, their current state, and their connection status.

RULES:

1. CHECK if the user's current flow is still active and the message looks like a mistake (accidental text, gibberish, off-topic). If so → flow_sleep (no response needed, user is fine).

2. If the user IS connected (ssid_valid=1, has_ssid=true, is_activated=true):
   - Check if their SSID is working. If expired → prompt reconnect.
   - Check if their current flow is broken (wrong state, stuck). If broken → prompt restart that flow.
   - Check if they made a client error (wrong amount, wrong pair). If so → correct them gently.
   - If all clear but they need help → route to appropriate flow.
   - Available flows: start_trading, reconnect, fund_account, go_home, help_contact, help_user_id.

3. If the user is NOT connected (is_activated=false, no SSID or ssid_valid=0):
   - Only route to: link_account (prompt to connect IQ Option), verify_user_id (send User ID), create_account (affiliate link).
   - Do not respond to off-topic messages.

4. If the user just sent a greeting, thanks, or casual chat → flow_sleep (no response).

Respond with ONLY a JSON object:
{"flow": "flow_name", "message": "your reply", "shouldReply": true}

Use shouldReply: false with flow_sleep to silently ignore. Use flow_done to stop further responses after the non-activated limit.

Examples:
{"flow": "reconnect", "message": "Your session expired. Tap Reconnect to sign back in 👇", "shouldReply": true}
{"flow": "start_trading", "message": "You haven't traded yet. Tap Start Trading and let's go 💜", "shouldReply": true}
{"flow": "link_account", "message": "Connect your IQ Option account first. Tap the button below 👇", "shouldReply": true}
{"flow": "flow_sleep", "message": "", "shouldReply": false}`;

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
    user_id_fail_count?: number;
    brain_response_count?: number;
    is_activated: boolean;
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
        `tier=${context.tier},`,
        `is_activated=${context.is_activated}`,
        context.user_id_fail_count ? `, user_id_fail_count=${context.user_id_fail_count}` : '',
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
            const parsed = JSON.parse(raw) as { flow?: string; message?: string; shouldReply?: boolean };
            const flow = (parsed.flow ?? '').trim().toLowerCase();
            const message = (parsed.message ?? '').trim();
            const shouldReply = parsed.shouldReply !== false;
            if (VALID_FLOWS.has(flow)) {
                return { flow, message, shouldReply };
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

    return classifyFlow(text, context);
}
