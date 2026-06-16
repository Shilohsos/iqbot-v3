// 10x AI Review Generator — DeepSeek V4 Pro
// Scenario-based batch generation. No voice labels.

import { readFileSync } from 'fs';
import { join } from 'path';

const DS_KEY = process.env['DEEPSEEK_API_KEY'];

let _reviewExamples = '';

function getReviewExamples(): string {
    if (_reviewExamples) return _reviewExamples;
    try {
        _reviewExamples = readFileSync(join(process.cwd(), 'review-examples-block.txt'), 'utf-8');
    } catch {
        _reviewExamples = '(examples not loaded)';
    }
    return _reviewExamples;
}

function getReviewPrompt(): string {
    return `You generate Telegram DMs from Nigerian traders to Shiloh, creator of 10x AI.

Below are real DMs from actual users. Study how they write — the language, energy, and variety.

--- REAL DMs ---
${getReviewExamples()}
--- END ---

When given a scenario, generate the requested number of DMs. Each must feel like a DIFFERENT person. Vary length, structure, and energy naturally.

CRITICAL: 80% of reviews must be in CLEAN ENGLISH. Only 20% can use light Pidgin. Most Nigerian traders write in normal English — not everyone speaks Pidgin.`;
}

export async function generateReviews(scenario: string, count: number = 5): Promise<string[]> {
    const apiKey = DS_KEY;
    if (!apiKey) throw new Error('DeepSeek API key not configured');

    const userPrompt = `Scenario: ${scenario}. Generate ${count} reviews. Different amounts — mix naira and dollars. Vary length as specified. 4 must be clean English. Only 1 can have light Pidgin flavor. Number them 1-${count}.`;

    const payload = {
        model: 'deepseek-v4-pro',
        messages: [
            { role: 'system', content: getReviewPrompt() },
            { role: 'user', content: userPrompt }
        ],
        temperature: 1.2,
        max_tokens: 10000,
        stream: false,
    };

    const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + apiKey,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(120_000),
    });

    if (!resp.ok) {
        const err = await resp.text().catch(() => '');
        throw new Error('DeepSeek error ' + resp.status + ': ' + err.slice(0, 200));
    }

    const result = await resp.json() as any;
    const content = result?.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error('DeepSeek returned empty content');

    // Parse numbered reviews from response
    const reviews: string[] = [];
    const lines = content.split('\n');
    for (const line of lines) {
        const match = line.match(/^(?:\d+[\.\)]\s*|DM\s*\d+[:\-]\s*)(.+)/i);
        if (match) {
            reviews.push(match[1].trim());
        }
    }

    // Fallback: if no numbered format, split by double newline
    if (reviews.length === 0) {
        return content.split('\n\n').filter((s: string) => s.trim().length > 10);
    }

    return reviews;
}

// Pre-built scenario presets for admin quick-access
export const SCENARIO_PRESETS: Record<string, string> = {
    marathon: 'Running a trading marathon. Generate 5 reviews of people who joined and made money with 10x AI.',
    giveaway: 'Doing a giveaway event. Generate 5 reviews of people who won and saw their accounts grow with 10x AI.',
    daily: 'Sharing daily wins. Generate 5 short reviews of people making profit with 10x AI today.',
    weekend: 'Weekend trading results. Generate 5 reviews of people who traded over the weekend with 10x AI.',
    signals: 'Signal performance. Generate 5 reviews of people who followed 10x signals and won.',
    otc: 'OTC Blitz results. Generate 5 reviews of people who traded OTC Blitz with 10x AI and made profit.',
    autotrade: 'Auto trading results. Generate 5 reviews of people using 10x AI auto-trading. The bot trades for them automatically — no manual work.',
    aitrade: 'AI trading results. Generate 5 reviews of people using 10x AI trading. The AI analyzes and executes trades with high accuracy.',
};
