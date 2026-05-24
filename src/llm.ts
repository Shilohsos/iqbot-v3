import { getComposeTone } from './db.js';

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

    const systemPrompt = `You are a high-conversion copywriter for a trading bot called "10x Bot."
Your job: write short, punchy, persuasive Telegram posts that drive users to trade more.

Rules:
- Under 200 characters
- Use simple, direct language
- Create FOMO or social proof
- Include one clear call-to-action
- Never use markdown formatting
- Sound human, not corporate
- When the topic is "reviews", include a specific dollar figure from the description
- When "motivation", focus on pushing users to take action NOW
- When "trade_win", celebrate the win and make others want the same
- When "life_win", connect trading to lifestyle improvement
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

    return {
        content: data.choices[0].message.content.trim(),
        usage: data.usage,
    };
}
