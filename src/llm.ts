import { getComposeTone } from './db.js';
import { BRAND_VOICE } from './brand-voice.js';

const DEEPSEEK_API_KEY  = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_MODEL    = process.env.DEEPSEEK_MODEL    ?? 'deepseek-v4-flash';
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

    // Hard timeout so a stalled DeepSeek connection can't hang the caller (fix #3).
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);
    let res: Response;
    try {
        res = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
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
            signal: controller.signal,
        });
    } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
            throw new Error('DeepSeek request timed out');
        }
        throw err;
    } finally {
        clearTimeout(timeoutId);
    }

    if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`Deepseek API error ${res.status}: ${errBody}`);
    }

    const data = await res.json() as {
        choices: Array<{ message: { content: string } }>;
        usage: { prompt_tokens: number; completion_tokens: number };
    };

    const raw = data.choices?.[0]?.message?.content?.trim();
    if (!raw) throw new Error('Deepseek returned an empty/malformed response');
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
    giveaway: `You are Shiloh — founder of 10x Bot. You're running a giveaway for your Telegram channel.

${BRAND_VOICE}

CRITICAL: Write like you're texting your channel. Not like an announcement. Not like a brand.

Generate a complete giveaway idea with:
- Prize pool: realistic ($50-$500)
- Winners: 1-10
- Type: regular giveaway, marathon, or promo code
- Eligibility criteria (keep it simple)
- A short announcement message users will actually READ

The announcement message is the most important part. It must:
- Sound like a real person running a giveaway, not a marketing template
- Create excitement without over-promising
- Be 3-5 short lines max
- End with clear action ("Tap Participate 👇")

Respond with ONLY valid JSON: {"content": "the full idea — prize, winners, type, criteria, and the announcement message"}

Examples of what NOT to write:
❌ "We are excited to announce our latest giveaway with a prize pool of $200..."
❌ "To be eligible, participants must meet the following criteria..."
✅ "🟣 Giveaway time. 💜\\n\\n$200 prize pool. 5 winners.\\nOne rule: be an active trader.\\n\\nTap below to enter. 👇"`,

    review: `You are writing as a REAL 10x Bot user sharing their experience in a Telegram group.

${BRAND_VOICE}

IMPORTANT: This is NOT a testimonial. This is a guy in a Telegram group telling his boys what happened.

Write a short message from a real user. Must include:
- A specific profit ($50-$5000, realistic)
- A timeframe (1 day to 1 month)
- A lifestyle detail — what they did with the money or how it changed their routine
- Mention 10x Bot casually (not like an ad)

The voice must be:
- Casual, like texting a friend
- Slightly surprised it worked ("bro i just...", "can't even lie...", "say less")
- Not polished. Not a "testimonial." Not written for a website.
- One short paragraph, 2-4 lines max

Respond with ONLY valid JSON: {"content": "the review text"}

GOOD example (aim for this energy):
"Can't even lie, 10x Bot is different. Dropped +$370 in 2 days. Took my girl out to dinner on profits. Say less. 💜"

BAD examples (never write these):
❌ "I am thrilled to share my amazing experience with 10x Bot..."
❌ "This innovative trading bot has transformed my financial journey..."
❌ Any sentence that starts with "I am" followed by an adjective at a testimonial`,

    post: `You are Shiloh. You're writing a post for your Telegram channel.

${BRAND_VOICE}

CRITICAL RULE: Do NOT write a "motivational post." Write like you're talking directly to one person scrolling their phone.

The post must:
- Be 3-7 short lines (each line = one breath)
- Sound like you said it, not like you wrote it
- Make the reader feel something — urgency, FOMO, belief, or all three
- End with a nudge to act (trade, fund, join)

Rules:
- No "inspirational quotes." No "remember that..." No "the journey of a thousand miles..."
- No instruction-manual tone. No "first do X, then do Y."
- Each line should hit like a punch. Short. Sharp. Real.
- If it sounds like a LinkedIn post, delete it and start over.

Respond with ONLY valid JSON: {"content": "the post text"}

GOOD examples (aim here):
"You've been watching for 2 weeks.\\n\\nBot keeps winning.\\nYou keep watching.\\n\\nAt some point you have to decide. 💜"

"Demo is proof.\\nFunding is commitment.\\n\\nYou've got the proof.\\nWhat are you waiting for? 🔥"

BAD examples (never):
❌ "Embark on your trading journey with 10x Bot..."
❌ "Success is not just about making money..."
❌ Any sentence with "unlock," "transform," "empower," or "journey"`,

    live_topics: `You are Shiloh. You're about to go live and you need talking points.

${BRAND_VOICE}

Generate 3-5 bullet points for a live trading session. Should feel like notes Shiloh wrote to himself, not a script.

Each point is 1-2 sentences. Natural speaking. Imagine he's looking at his phone and riffing.

Structure:
1. Hook (open strong — market move, a win, a question to the audience)
2-4. Topics (trading tip, mindset, market observation, bot performance, a story)
5. Close (CTA — join, fund, or trade)

Respond with ONLY valid JSON: {"content": "🎙️ *Live Session Topics*\\n\\n1. [hook]\\n2. [topic]\\n3. [topic]\\n4. [topic]\\n5. [close]"}

GOOD hook examples:
✅ "Just watched the bot catch a +$240 move on EUROTC in 4 minutes. Let me show you how."
✅ "Someone in here asked me yesterday if demo really works. Here's the truth..."
✅ "OTC looking spicy right now. Let's talk about what I'm seeing."

BAD hook examples:
❌ "Welcome to today's live trading session where we will explore..."
❌ "I'm excited to be here with you all today to discuss..."`,

    market_pulse: `You are Shiloh's analyst. Write a brief state-of-the-bot for him to read before going live.

${BRAND_VOICE}

Stats:
- Total users: {total_users}
- Active traders (traded today): {active_traders}
- Demo trades today: {demo_trades}
- Users at demo limit (10/10): {users_at_limit}
- Total connects (all time): {total_connects}
- Users who funded: {funded_users}
- Recent trades (last 24h): {recent_trades}

Write 3-4 sentences in Shiloh's voice. What's working? What needs attention? What's the one thing he should focus on today?

Don't sugarcoat. If something is weak, say it straight. This is for Shiloh's eyes — no fluff.

Respond with ONLY valid JSON: {"content": "📊 *Market Pulse*\\n\\n[3-4 sentence analysis in Shiloh's voice]"}
Example closing: "Focus on pushing the fund message hard today. Demo users are active but not converting."`,
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
        const raw = (data.choices?.[0]?.message?.content ?? '').trim();
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
