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
