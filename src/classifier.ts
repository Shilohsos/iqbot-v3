import { getRandomTemplate, type TemplateRecord } from './db.js';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL   = process.env.OPENROUTER_MODEL ?? 'google/gemini-2.5-flash';
const OPENROUTER_URL     = 'https://openrouter.ai/api/v1/chat/completions';

const VALID_CATEGORIES = new Set([
    'greeting', 'new_user_greeting', 'returning_user', 'account_creation',
    'connect_account', 'bot_not_working', 'ssid_connect_fail', 'how_bot_works',
    'trading_explanation', 'funding_deposit', 'withdrawal', 'loss_recovery',
    'risk_safety', 'bot_strategy', 'pricing_tiers', 'promo_bonus',
    'upgrade_migration', 'scam_legit', 'need_time', 'frustration_complaint',
    'referral_affiliate', 'talk_to_admin', 'leaderboard_stats', 'thanks_response',
    'unrecognized',
]);

const SYSTEM_PROMPT = `You are an intent classifier for a trading bot called "10x Bot".
Classify the user's message into EXACTLY one of these categories:

greeting — Hello, hi, good morning, casual greeting
new_user_greeting — First message from someone who's new
returning_user — Has traded before, has an account
account_creation — How to create IQ Option account, sign up
connect_account — How to connect account to bot
bot_not_working — Bot stopped, no signals, something broken
ssid_connect_fail — Connection failed, wrong ID, auth error
how_bot_works — How does the bot work, what does it do
trading_explanation — CALL/PUT, expiry, how binary options work
funding_deposit — How to deposit, minimum, payment methods
withdrawal — How to withdraw, processing time
loss_recovery — Lost money, bad trades, red streak
risk_safety — Is it safe, can I lose, guaranteed profit?
bot_strategy — Win rate, strategy accuracy, indicators
pricing_tiers — Cost, PRO vs MASTER, what's included
promo_bonus — Promo codes, discounts, bonuses
upgrade_migration — Upgrade tier, migrate account
scam_legit — Is this a scam, proof, verification
need_time — I'll think about it, later, not ready
frustration_complaint — Angry, calling scam, cursing
referral_affiliate — Refer friends, affiliate program
talk_to_admin — Talk to human, support, real person
leaderboard_stats — My performance, PnL, how I'm doing
thanks_response — Thank you, ok, alright, got it
unrecognized — Catch-all for anything else

If the user sent an image, analyze what's in it and classify accordingly.

Respond with ONLY the category name in lowercase, nothing else.`;

const rateLimitMap = new Map<number, number>();
const RATE_LIMIT_MS = 5_000;

/** Returns false if this user has called the LLM within the last 5 seconds. */
function checkRateLimit(userId: number): boolean {
    const last = rateLimitMap.get(userId) ?? 0;
    if (Date.now() - last < RATE_LIMIT_MS) return false;
    rateLimitMap.set(userId, Date.now());
    return true;
}

async function classifyIntent(text: string, imageUrl?: string): Promise<string> {
    if (!OPENROUTER_API_KEY) return 'unrecognized';

    const userContent: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];
    if (imageUrl) userContent.push({ type: 'image_url', image_url: { url: imageUrl } });
    userContent.push({ type: 'text', text });

    const resp = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        },
        body: JSON.stringify({
            model: OPENROUTER_MODEL,
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: userContent },
            ],
            max_tokens: 20,
            temperature: 0,
        }),
    });

    if (!resp.ok) throw new Error(`OpenRouter ${resp.status}`);
    const data = await resp.json() as { choices: Array<{ message: { content: string } }> };
    const raw = (data.choices[0]?.message?.content ?? '').trim().toLowerCase();
    return VALID_CATEGORIES.has(raw) ? raw : 'unrecognized';
}

/**
 * Main entry point: classify the user's message and return a matching template.
 * Returns undefined when rate-limited, API unavailable, or no template found.
 */
export async function getBrainResponse(
    userId: number,
    text: string,
    imageUrl?: string,
): Promise<TemplateRecord | undefined> {
    if (!checkRateLimit(userId)) return undefined;
    try {
        const category = await classifyIntent(text, imageUrl);
        return getRandomTemplate(category, 'brain');
    } catch (err) {
        console.warn('[classifier] error:', err instanceof Error ? err.message : err);
        return getRandomTemplate('unrecognized', 'brain');
    }
}
