# Directive: LLM Tone Trainer for Compose Post

## Goal
Replace the hardcoded generic system prompt in `src/llm.ts` with a **configurable tone profile** that the admin can train. The compose post output should sound like *the admin's voice*, not a generic AI copywriter.

## Why
Current output feels "generic and AI generated." The admin wants control over tonality — streetwise, aggressive, conversational, hype-driven, or whatever fits the brand. A hardcoded prompt can't adapt.

## Implementation

### 1. Add tone config table to DB
File: `src/db.ts`

Add a new table or config rows:

```typescript
db.exec(`
  CREATE TABLE IF NOT EXISTS compose_tone (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    style_guide TEXT NOT NULL DEFAULT '',
    sample_1 TEXT NOT NULL DEFAULT '',
    sample_2 TEXT NOT NULL DEFAULT '',
    sample_3 TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);
INSERT OR IGNORE INTO compose_tone (id, style_guide) VALUES (1, '');
```

Add getter/setter functions:
- `getComposeTone()` → returns `{ styleGuide, samples: string[] }`
- `setComposeTone(styleGuide, samples)` → updates row, sets updated_at

### 2. Add tone settings to admin panel
File: `src/ui/admin.ts`

Add a "🎭 Tone Settings" button to the compose topic keyboard (or as a separate entry in admin menu):

```typescript
export function composeToneKeyboard(): IKMarkup {
  return {
    inline_keyboard: [
      [{ text: '📝 Edit Style Guide', callback_data: 'compose_tone:guide' }],
      [{ text: '📄 Sample Post 1',    callback_data: 'compose_tone:sample1' }],
      [{ text: '📄 Sample Post 2',    callback_data: 'compose_tone:sample2' }],
      [{ text: '📄 Sample Post 3',    callback_data: 'compose_tone:sample3' }],
      [{ text: '👁️ View Current Tone', callback_data: 'compose_tone:view' }],
      [{ text: '🔙 Compose Post',     callback_data: 'admin:compose' }],
    ],
  };
}
```

Modify `composeTopicKeyboard()` to include:
```
{ text: '🎭 Tone Settings', callback_data: 'admin:compose_tone' }
```

### 3. Handle tone settings flow
File: `src/bot.ts`

Add handlers:
- `admin:compose_tone` → show `composeToneKeyboard()`
- `compose_tone:guide` → prompt admin to enter the style guide text
- `compose_tone:sample1|2|3` → prompt admin to paste an example post
- `compose_tone:view` → show current style guide + 3 sample posts (truncated)

Handler for text input when step is `compose_tone_guide`, `compose_tone_sample1`, etc.:
- Save to DB via `setComposeTone()`
- Confirm with admin

New session steps needed:
```
| 'compose_tone_guide'
| 'compose_tone_sample1'
| 'compose_tone_sample2'
| 'compose_tone_sample3'
```

### 4. Modify LLM prompt to include tone profile
File: `src/llm.ts`

Replace the hardcoded `SYSTEM_PROMPT` with a dynamic prompt that includes the tone config:

```typescript
export async function generatePost(req: LlmRequest): Promise<LlmResponse> {
    if (!DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY not set');

    // Load tone profile from DB
    const tone = getComposeTone();

    const systemPrompt = `You are a high-conversion copywriter for a trading bot called "10x Bot."
Your job: write short, punchy Telegram posts that drive users to trade more.

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

${tone.styleGuide ? `STYLE GUIDE (must follow this precisely):\n${tone.styleGuide}\n` : ''}`;

    const userPrompt = `Topic: ${req.topic}\nDescription: ${req.description}\nTone: ${req.tone ?? 'persuasive'}\n\nWrite a Telegram broadcast post:`;

    // If admin has provided sample posts, inject them as few-shot examples
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

    // ... rest of the fetch call using `messages` instead of the old 2-message array
```

### 5. Add "Tone Settings" entry to Compose Post submenu
File: `src/ui/admin.ts`

Modify `composeTopicKeyboard()` to:
```typescript
export function composeTopicKeyboard(): IKMarkup {
  return {
    inline_keyboard: [
      [{ text: '⭐ Reviews',    callback_data: 'compose_topic:reviews' }],
      [{ text: '💪 Motivation', callback_data: 'compose_topic:motivation' }],
      [{ text: '💰 Trade Wins', callback_data: 'compose_topic:trade_win' }],
      [{ text: '🏖️ Life Wins', callback_data: 'compose_topic:life_win' }],
      [{ text: '🎭 Tone Settings', callback_data: 'admin:compose_tone' }],
      [{ text: '🔙 Admin Menu', callback_data: 'admin:back' }],
    ],
  };
}
```

## Testing
1. Admin → Compose Post → Tone Settings → Edit Style Guide → enter "Streetwise, aggressive, use slang, no emojis, short punchy sentences"
2. Add 3 sample posts in the desired voice
3. View current tone → verify it shows what was entered
4. Go back → compose a post → verify output matches the trained tone
5. Try different topics (reviews, motivation, trade_win) with the same tone → verify consistency

## Files to Modify
- `src/db.ts` — add `compose_tone` table + getter/setter functions
- `src/ui/admin.ts` — add tone keyboard + button in compose topic keyboard
- `src/bot.ts` — add tone handlers + new session steps + text input handlers
- `src/llm.ts` — load tone profile from DB, inject into system prompt + few-shot examples

## Notes
- The compose_tone table uses `id=1` singleton pattern (only one profile)
- Style guide is optional — if empty, system prompt works as before (backward compatible)
- Samples are optional — if none provided, no few-shot injection
- All tone settings persist in DB (survive restarts)
