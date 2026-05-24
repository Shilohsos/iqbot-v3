const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL ?? 'deepseek-chat';
const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1';
const SYSTEM_PROMPT = `You are a high-conversion copywriter for a trading bot called "10x Bot."
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
- When "life_win", connect trading to lifestyle improvement`;
export async function generatePost(req) {
    if (!DEEPSEEK_API_KEY)
        throw new Error('DEEPSEEK_API_KEY not set');
    const userPrompt = `Topic: ${req.topic}\nDescription: ${req.description}\nTone: ${req.tone ?? 'persuasive'}\n\nWrite a Telegram broadcast post:`;
    const res = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify({
            model: DEEPSEEK_MODEL,
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: userPrompt },
            ],
            max_tokens: 300,
            temperature: 0.8,
        }),
    });
    if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`Deepseek API error ${res.status}: ${errBody}`);
    }
    const data = await res.json();
    return {
        content: data.choices[0].message.content.trim(),
        usage: data.usage,
    };
}
