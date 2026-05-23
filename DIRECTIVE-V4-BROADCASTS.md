# DIRECTIVE: V4 Broadcasts — Fixed Auto-Messages + LLM-Powered Posts

## Context

V4 adds two broadcast types:

1. **Type A: Fixed Auto-Messages** — 10 pre-composed persuasive messages sent daily at random intervals to traders inactive 2+ hours. Each paired with an image.

2. **Type B: LLM-Powered Motivational Posts** — Admin composes via bot UI, Deepseek V4 Flash generates the final text, admin approves, broadcasts to channel and/or bot users.

## 1. Deepseek API Configuration

Add to `.env`:

```
DEEPSEEK_API_KEY=sk-34e52c08be514f1ca3b549fb235622f0
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
```

### LLM helper — new file: `src/llm.ts`

```typescript
import 'dotenv/config';

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';

export interface LlmRequest {
  topic: string;         // e.g. 'reviews', 'motivation', 'trade_win', 'life_win'
  description: string;   // ≤10 words from admin: "made $263 in 2 weeks"
  tone?: 'persuasive' | 'motivational' | 'social_proof' | 'urgent';
}

export interface LlmResponse {
  content: string;
  usage: { prompt_tokens: number; completion_tokens: number };
}

export async function generatePost(req: LlmRequest): Promise<LlmResponse> {
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
- When "life_win", connect trading to lifestyle improvement`;

  const userPrompt = `Topic: ${req.topic}
Description: ${req.description}
Tone: ${req.tone || 'persuasive'}

Write a Telegram broadcast post:`;

  const res = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
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
```

## 2. Database — `broadcast_messages` table

```sql
CREATE TABLE IF NOT EXISTS broadcast_messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    type            TEXT    NOT NULL,  -- 'auto' | 'approved'
    category        TEXT,             -- 'motivation' | 'reviews' | 'trade_win' | 'life_win'
    content         TEXT    NOT NULL,
    image_file_id   TEXT,             -- Telegram file_id for paired image
    enabled         INTEGER NOT NULL DEFAULT 1,
    last_sent_at    TEXT,
    sent_count      INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
```

## 3. Type A — Fixed Auto-Messages

### Seeded messages (10 total — insert on first run)

Insert these into `broadcast_messages` if table is empty:

| # | Content | Category |
|---|---------|----------|
| 1 | "👀 Want to see the bot actually trade?\n\nDemo mode is risk-free.\nOne tap, one signal, one trade.\n\nWatch it work 👇" | persuasion |
| 2 | "💸 Another 10x user just banked +$270 CASH\n\nSame bot. Same signals. Real money.\nYou're still on demo coins.\n\nSwitch up 👇" | social_proof |
| 3 | "📊 71% of demo users upgraded to LIVE this week.\n\nThey didn't guess. They watched the bot win on demo first.\nThen they switched.\n\nRun your demo trade 👇" | social_proof |
| 4 | "⏱ Markets don't wait. Every minute you're not trading is profit someone else is taking.\n\nTap Trade Now 👇" | urgency |
| 5 | "🤑 Real money. Real wins. Real withdrawals.\n\nThe bot's been printing for users all day.\nYour account should be next.\n\nStart a trade 👇" | persuasion |
| 6 | "🔋 Tired of watching others win while you sit out?\n\nOne trade changes everything.\nOne win builds momentum.\nOne session could pay your bills.\n\nTrade now 👇" | motivation |
| 7 | "🏆 Top trader today banked +$890 in 3 trades.\n\nNo magic. Just the bot doing its job.\nThe same bot you have access to.\n\nUse it 👇" | social_proof |
| 8 | "📈 The algorithm just fired a 84% confidence signal.\n\nThese don't come often. When they do, smart traders act.\n\nTap to catch this one 👇" | urgency |
| 9 | "💡 Demo mode exists for ONE reason:\n\nSo you can see it work before you go live.\nIf you've seen it work… what are you waiting for?\n\nGo live 👇" | persuasion |
| 10 | "🎯 Your next trade could be the one that pays for your week.\n\nThe bot is online. Signals are firing. Account is ready.\n\nWhat's stopping you? 👇" | motivation |

**Image pairing:** Each message will have `image_file_id` populated later after the user uploads images. For now, leave NULL. The broadcast engine sends text-only until images are added.

### Auto-broadcast engine — `src/auto-broadcast.ts`

```typescript
import { Bot } from '../bot.js'; // or import bot instance
import { getInactiveTraderIds, getBroadcastMessage } from './db.js';

const BROADCAST_INTERVAL_MINUTES = 30;  // check every 30 min
const INACTIVE_HOURS = 2;               // user must be idle 2+ hours

export function startAutoBroadcast(bot: Telegraf): void {
  let messageIndex = 0;

  setInterval(async () => {
    const messages = getEnabledAutoMessages();
    if (messages.length === 0) return;

    const msg = messages[messageIndex % messages.length];
    messageIndex++;

    const targets = getInactiveTraderIds(INACTIVE_HOURS);
    if (targets.length === 0) return;

    // Send to random subset (avoid blasting all at once)
    const batchSize = Math.min(targets.length, Math.floor(targets.length * 0.3));
    const shuffled = targets.sort(() => Math.random() - 0.5).slice(0, batchSize);

    for (const tid of shuffled) {
      try {
        if (msg.image_file_id) {
          await bot.telegram.sendPhoto(tid, msg.image_file_id, {
            caption: msg.content,
            reply_markup: { inline_keyboard: [[{ text: 'Trade Now 👇', callback_data: 'ui:trade' }]] }
          });
        } else {
          await bot.telegram.sendMessage(tid, msg.content, {
            reply_markup: { inline_keyboard: [[{ text: 'Trade Now 👇', callback_data: 'ui:trade' }]] }
          });
        }
      } catch {}
      await new Promise(r => setTimeout(r, 50)); // rate limit
    }

    // Update sent count
    markBroadcastSent(msg.id, batchSize);
  }, BROADCAST_INTERVAL_MINUTES * 60 * 1000);
}
```

## 4. Type B — LLM-Powered Posts (Admin Workflow)

### Admin menu additions

Add to `adminKeyboard()`:
```
[{ text: '✍️ Compose Post', callback_data: 'admin:compose' }]
```

### Workflow steps (new admin session states)

**Step 1: Choose topic** → `admin:compose` handler shows:
```
✍️ *Compose Motivational Post*

Choose the post topic:
[A. Reviews]
[B. Motivation]
[C. Trade Wins]
[D. Life Wins]
[🔙 Admin Menu]
```

**Step 2: Describe in ≤10 words** → admin types short description.
- Example: "made $263 within 2 weeks of trading"
- Example: "just bought his first car from profits"
- Example: "turned $50 into $400 in one session"

**Step 3: LLM generates** → bot shows loading, calls `generatePost()`, returns result:
```
✍️ *Generated Post:*

"{generated content}"

[✅ Approve & Send]
[🔄 Regenerate]
[✏️ Edit (type new description)]
[❌ Cancel]
```

**Step 4: Image (optional)** → if admin taps "Approve":
```
📎 Add an image? Send the photo or type "skip"
```

**Step 5: Delivery target** →
```
📤 Send to:
→ [🤖 Bot Users Only]
→ [📢 Channel Only]
→ [📱 Both Bot + Channel]
[🔙 Cancel]
```

**Step 6: Confirm and send** → broadcasts to selected targets. Saves to `broadcast_messages` as type='approved' for history.

### Channel sending

Use bot's Telegram API to send to channel `-1002766084283`:

```typescript
const CHANNEL_ID = parseInt(process.env.CHANNEL_ID || '-1002766084283');

async function sendToChannel(message: string, imageFileId?: string): Promise<void> {
  if (imageFileId) {
    await bot.telegram.sendPhoto(CHANNEL_ID, imageFileId, { caption: message });
  } else {
    await bot.telegram.sendMessage(CHANNEL_ID, message);
  }
}
```

Add `CHANNEL_ID=-1002766084283` to `.env`.

## 5. Files

| File | Action |
|------|--------|
| `src/llm.ts` | **NEW** — Deepseek API integration |
| `src/auto-broadcast.ts` | **NEW** — fixed message scheduler |
| `src/db.ts` | Add `broadcast_messages` table, seed messages, CRUD functions |
| `src/bot.ts` | Wire auto-broadcast, add compose post handlers |
| `src/ui/admin.ts` | Compose post keyboards |
| `src/index.ts` | Call `startAutoBroadcast(bot)` after bot launches |

## 6. .env additions

```
DEEPSEEK_API_KEY=sk-34e52c08be514f1ca3b549fb235622f0
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
CHANNEL_ID=-1002766084283
```

---

**Deploy:** `npm install` (no new deps needed), `npx tsc && pm2 restart iqbot-v3-bot`

**Test:**
- Auto messages: wait 30+ min, check inactive users receive messages
- LLM compose: admin runs workflow, sees generated text, approves, receives in channel and/or DM
