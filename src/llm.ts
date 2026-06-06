import { getComposeTone } from './db.js';
import { BRAND_VOICE } from './brand-voice.js';

const DEEPSEEK_API_KEY  = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_MODEL    = process.env.DEEPSEEK_MODEL    ?? 'deepseek-chat';
const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1';

export interface LlmRequest {
    topic: 'reviews' | 'motivation' | 'trade_win' | 'life_win';
    description: string;
    tone?: 'persuasive' | 'motivational' | 'social_proof' | 'urgent';
}

export interface LlmResponse {
    content: string;
    usage: { prompt_tokens: number; completion_tokens: number };
}

export async function generatePost(req: LlmRequest): Promise<LlmResponse> {
    if (!DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY not set');

    const tone = getComposeTone();

    const systemPrompt = `You are a social media post writer for a trading bot called "10x Bot".

${BRAND_VOICE}

Generate a post based on the topic and description provided.
Respond with ONLY valid JSON: {"content": "your post here"}
Keep the post between 3-7 short lines. Use line breaks (\\n) for rhythm.
No hashtags. No generic motivational quotes. Write like a real person.
${tone.styleGuide ? `\nSTYLE GUIDE (follow this precisely):\n${tone.styleGuide}` : ''}`;

    const userPrompt = `Topic: ${req.topic}\nDescription: ${req.description}\nTone: ${req.tone ?? 'persuasive'}\n\nWrite a Telegram broadcast post:`;

    const samples = [tone.sample1, tone.sample2, tone.sample3].filter(Boolean);
    const messages: Array<{ role: string; content: string }> = [
        { role: 'system', content: systemPrompt },
    ];

    if (samples.length > 0) {
        messages.push({
            role: 'user',
            content: `Here are examples of the exact tone and style I want. Match this voice exactly:\n\n${samples.map((s, i) => `Example ${i + 1}:\n${s}`).join('\n\n')}`,
        });
        messages.push({
            role: 'assistant',
            content: 'Understood. I will match that tone and style exactly in my response.',
        });
    }

    messages.push({ role: 'user', content: userPrompt });

    const res = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify({
            model: DEEPSEEK_MODEL,
            messages,
            max_tokens: 300,
            temperature: 0.8,
        }),
    });

    if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`Deepseek API error ${res.status}: ${errBody}`);
    }

    const data = await res.json() as {
        choices: Array<{ message: { content: string } }>;
        usage: { prompt_tokens: number; completion_tokens: number };
    };

    const raw = data.choices[0].message.content.trim();
    let content = raw;
    try {
        const parsed = JSON.parse(raw) as { content?: string };
        if (typeof parsed.content === 'string') content = parsed.content;
    } catch {
        // Model returned plain text — use as-is
    }

    return {
        content,
        usage: data.usage,
    };
}

const DIARY_PROMPTS: Record<string, string> = {
    giveaway: `You are a giveaway strategist for 10x Bot.

${BRAND_VOICE}

Generate a complete giveaway idea. Include:
- Prize pool amount (realistic for a trading bot audience, $50-$500)
- Number of winners (1-10)
- Minimum balance requirement (if any)
- Type: regular giveaway, marathon, or promo code
- Eligibility criteria
- A short announcement message the admin can post

Respond with ONLY valid JSON: {"content": "the full giveaway idea here"}
Make it specific and actionable, not generic. Every number should be justified.`,

    review: `You are a social proof writer for 10x Bot.

${BRAND_VOICE}

Generate a fake client review/testimonial. It should sound like a real person sharing their experience. Include:
- A specific profit amount (realistic, $50-$5000 range)
- A timeframe (1 day, 1 week, 2 weeks, 1 month)
- A lifestyle detail (bought something, paid bills, took someone out, etc.)
- Mention 10x Bot by name
- Should read like a Telegram message from a real client

Respond with ONLY valid JSON: {"content": "the review text here"}
The review must sound authentic — not like a testimonial ad. Use casual language, emojis naturally.`,

    post: `You are a content creator for 10x Bot.

${BRAND_VOICE}

Generate a motivational/inspirational post for the 10x Bot Telegram channel.
The post should:
- Be 3-7 short lines
- Create urgency or inspiration
- Make readers want to take action (trade, fund, or join)
- Sound like Shiloh wrote it personally

Respond with ONLY valid JSON: {"content": "the post text here"}
No hashtags. No generic quotes. Write like a real person.`,

    live_topics: `You are a live stream strategist for 10x Bot.

${BRAND_VOICE}

Generate 3-5 talking points for Shiloh's next live trading session. Include:
- A hook topic to open with (something timely, market-related, or engaging)
- 2-3 discussion points (trading tips, mindset, market observations, bot performance)
- A closing call-to-action

Each point should be 1-2 sentences. Natural speaking tone, not scripted.

Respond with ONLY valid JSON: {"content": "🎙️ *Live Session Topics*\\n\\n1. [hook]\\n2. [point]\\n3. [point]\\n4. [point]\\n5. [closing CTA]"}`,

    market_pulse: `You are a bot performance analyst for 10x Bot.

${BRAND_VOICE}

Review the following bot activity stats and write a brief "state of the bot" pulse check. Be honest and insightful — this is for Shiloh to read before going live.

Stats:
- Total users: {total_users}
- Active traders (traded today): {active_traders}
- Demo trades today: {demo_trades}
- Users at demo limit (10/10): {users_at_limit}
- Total connects (all time): {total_connects}
- Users who funded: {funded_users}
- Recent trades (last 24h): {recent_trades}

Write 3-4 sentences. What's working? What needs attention? What's the one thing Shiloh should focus on today?

Respond with ONLY valid JSON: {"content": "📊 *Market Pulse*\\n\\n[your analysis here]"}`,
};

export async function generateDiaryEntry(
    type: 'giveaway' | 'review' | 'post' | 'live_topics' | 'market_pulse',
    context?: Record<string, number | string>,
): Promise<{ content: string }> {
    let prompt = DIARY_PROMPTS[type];
    if (!prompt) throw new Error(`Unknown diary type: ${type}`);

    if (type === 'market_pulse' && context) {
        for (const [key, value] of Object.entries(context)) {
            prompt = prompt.replace(`{${key}}`, String(value ?? 'N/A'));
        }
    }

    const apiKey = DEEPSEEK_API_KEY;
    if (!apiKey) throw new Error('DEEPSEEK_API_KEY not configured');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15_000);

    try {
        const resp = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: DEEPSEEK_MODEL,
                messages: [
                    { role: 'system', content: prompt },
                    { role: 'user', content: `Generate a ${type.replace('_', ' ')} idea for 10x Bot.` },
                ],
                max_tokens: 500,
                temperature: 0.8,
            }),
            signal: controller.signal,
        });

        if (!resp.ok) throw new Error(`DeepSeek ${resp.status}`);
        const data = await resp.json() as { choices: Array<{ message: { content: string } }> };
        const raw = (data.choices[0]?.message?.content ?? '').trim();
        const parsed = JSON.parse(raw) as { content?: string };
        const content = parsed.content?.trim();
        if (!content) throw new Error('Empty response from LLM');
        return { content };
    } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') throw new Error('Request timed out');
        throw err;
    } finally {
        clearTimeout(timeoutId);
    }
}
