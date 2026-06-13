const DEEPSEEK_API_KEY  = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_MODEL    = process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash';
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

const SYSTEM_PROMPT = `You're a helper for a trading bot. The user sent you a message.

Decide what they need and reply with a JSON object:
{"flow": "flow_name", "message": "short reply"}

Flows: start_trading, reconnect, continue_onboarding, verify_user_id, fund_account, go_home, help_contact, help_user_id, link_account, create_account, flow_sleep

- Not connected? → link_account or create_account
- Stuck or error? → reconnect or continue_onboarding
- Greeting/thanks/casual? → go_home
- Gibberish/off-topic? → flow_sleep with shouldReply: false

Keep the message short. 1-2 sentences. Natural tone.`;

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
    access_level: string;
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
        `access_level=${context.access_level},`,
        `is_activated=${context.is_activated}`,
        context.user_id_fail_count ? `, user_id_fail_count=${context.user_id_fail_count}` : '',
    ].join(' ');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5_000);

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
                max_tokens: 300,
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
    if (!checkRateLimit(userId)) return { flow: 'go_home', message: '', shouldReply: false };

    return classifyFlow(text, context);
}
