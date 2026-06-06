# DIRECTIVE-ADMIN-DIARY.md

## Overview

Add a new "Admin Diary" section to the admin menu. This is a content idea generator — it uses DeepSeek + the brand voice profile to generate content ideas that the admin can review, edit, and use. It does NOT broadcast anything directly.

## Files to modify

### 1. `src/admin.ts` — Add admin diary menu + handlers

**Add to admin keyboard** (around the existing menu buttons):

```
{ text: '📔 Admin Diary', callback_data: 'admin:diary' }
```

**Add callback handler:**

```typescript
bot.action('admin:diary', async ctx => {
    await ctx.answerCbQuery();
    await ctx.reply(
        '📔 *Admin Diary*\n\nWhat would you like to generate?',
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🎁 Giveaway', callback_data: 'diary:giveaway' }],
                    [{ text: '⭐ Review', callback_data: 'diary:review' }],
                    [{ text: '📝 Post', callback_data: 'diary:post' }],
                    [{ text: '🎙️ Live Topics', callback_data: 'diary:live_topics' }],
                    [{ text: '🔙 Back', callback_data: 'admin:back' }],
                ]
            }
        }
    );
});
```

**Add callback handlers for each diary type:**

```typescript
bot.action('diary:giveaway', async ctx => {
    await ctx.answerCbQuery();
    const loading = await ctx.reply('⏳ Generating giveaway idea...');
    try {
        const result = await generateDiaryEntry('giveaway');
        await ctx.telegram.deleteMessage(ctx.chat!.id, loading.message_id).catch(() => {});
        await ctx.reply(
            `🎁 *Giveaway Idea*\n\n${result.content}`,
            { parse_mode: 'Markdown' }
        );
    } catch (err) {
        await ctx.reply(`❌ ${err instanceof Error ? err.message : 'Generation failed'}`);
    }
});

bot.action('diary:review', async ctx => {
    await ctx.answerCbQuery();
    const loading = await ctx.reply('⏳ Generating client review...');
    try {
        const result = await generateDiaryEntry('review');
        await ctx.telegram.deleteMessage(ctx.chat!.id, loading.message_id).catch(() => {});
        await ctx.reply(
            `⭐ *Client Review*\n\n${result.content}`,
            { parse_mode: 'Markdown' }
        );
    } catch (err) {
        await ctx.reply(`❌ ${err instanceof Error ? err.message : 'Generation failed'}`);
    }
});

bot.action('diary:post', async ctx => {
    await ctx.answerCbQuery();
    const loading = await ctx.reply('⏳ Generating post...');
    try {
        const result = await generateDiaryEntry('post');
        await ctx.telegram.deleteMessage(ctx.chat!.id, loading.message_id).catch(() => {});
        await ctx.reply(
            `📝 *Post Idea*\n\n${result.content}`,
            { parse_mode: 'Markdown' }
        );
    } catch (err) {
        await ctx.reply(`❌ ${err instanceof Error ? err.message : 'Generation failed'}`);
    }
});

bot.action('diary:live_topics', async ctx => {
    await ctx.answerCbQuery();
    const loading = await ctx.reply('⏳ Generating live topics...');
    try {
        const result = await generateDiaryEntry('live_topics');
        await ctx.telegram.deleteMessage(ctx.chat!.id, loading.message_id).catch(() => {});
        await ctx.reply(
            `🎙️ *Live Topics*\n\n${result.content}`,
            { parse_mode: 'Markdown' }
        );
    } catch (err) {
        await ctx.reply(`❌ ${err instanceof Error ? err.message : 'Generation failed'}`);
    }
});
```

### 2. `src/llm.ts` — Add `generateDiaryEntry()` function

Import the brand voice:

```typescript
import { BRAND_VOICE } from './brand-voice.js';
```

Add the diary system prompts:

```typescript
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

Respond with ONLY valid JSON: {"content": "🎙️ *Live Session Topics*\\n\\n1. [hook]\\n2. [point]\\n3. [point]\\n4. [point]\\n5. [closing CTA]"}`
};

export async function generateDiaryEntry(
    type: 'giveaway' | 'review' | 'post' | 'live_topics'
): Promise<{ content: string }> {
    const prompt = DIARY_PROMPTS[type];
    if (!prompt) throw new Error(`Unknown diary type: ${type}`);

    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) throw new Error('DEEPSEEK_API_KEY not configured');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15_000);

    try {
        const resp = await fetch(`${process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1'}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
                messages: [
                    { role: 'system', content: prompt },
                    { role: 'user', content: `Generate a ${type} idea for 10x Bot.` },
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
        if (!content) throw new Error('Empty response');

        return { content };
    } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') throw new Error('Request timed out');
        throw err;
    } finally {
        clearTimeout(timeoutId);
    }
}
```

### 3. `src/bot.ts` — Ensure imports

Make sure `generateDiaryEntry` is imported:

```typescript
import { generatePost, generateDiaryEntry, type LlmRequest } from './llm.js';
```

(Only needed if not already imported — check existing imports.)

## Deploy

1. Edit `src/admin.ts` — add menu button + 5 callback handlers (diary menu + 4 types)
2. Edit `src/llm.ts` — add `generateDiaryEntry` function + `DIARY_PROMPTS`
3. `npm run build`
4. `pm2 restart iqbot-v3-bot --update-env`
