# DIRECTIVE: Complete Media Bundle — Re-engagement, Funding, Auto-Delete, Cleanup

## Problem
1. Re-engagement loop sends plain text — no images/videos appear
2. Follow-ups pile up (user sees multiple old messages)
3. Funding sequence never fires (unwired) 
4. Funding templates have no media support
5. `[link]` placeholders in follow-up templates

---

## Fix 1: Add last_followup_msg_id to onboarding_tracking

In `src/db.ts`, add a migration or ALTER TABLE:

```typescript
db.exec(`ALTER TABLE onboarding_tracking ADD COLUMN last_followup_msg_id INTEGER`).catch(() => {});
```

## Fix 2: Re-engagement loop — send media + auto-delete previous

In `src/bot.ts`, replace the re-engagement loop (lines 4529-4547) with:

```typescript
backgroundIntervals.push(setInterval(async () => {
    if (getConfig('features_paused') === '1') return;
    try {
        const stuck = getStuckOnboardingUsers(6);
        for (const user of stuck) {
            try {
                const key = getReengageTemplateKey(user.onboarding_state ?? 'entry_branch_sent');
                const t = getTemplateByKey(key);
                if (!t) continue;
                const msg = resolveUsernameTemplate(t.message, user.username ?? 'there');
                const chatId = user.telegram_id;

                // Auto-delete previous follow-up message
                const tracking = getOnboardingTracking(chatId);
                if (tracking?.last_followup_msg_id) {
                    try { await bot.telegram.deleteMessage(chatId, tracking.last_followup_msg_id); } catch {}
                }

                // Try media: strip 'reengage_' prefix to match sequence_media keys
                const mediaKey = key.replace('reengage_', '');
                const media = getSequenceMedia(mediaKey);
                let sentMsgId: number;

                if (media?.file_id) {
                    if (media.media_type === 'video') {
                        const sent = await bot.telegram.sendVideo(chatId, media.file_id, { caption: msg });
                        sentMsgId = sent.message_id;
                    } else {
                        const sent = await bot.telegram.sendPhoto(chatId, media.file_id, { caption: msg });
                        sentMsgId = sent.message_id;
                    }
                } else {
                    const sent = await bot.telegram.sendMessage(chatId, msg);
                    sentMsgId = sent.message_id;
                }

                // Store new message_id for next auto-delete
                setLastFollowupMsgId(chatId, sentMsgId);
                touchOnboardingActivity(chatId);
                await new Promise(r => setTimeout(r, 200));
            } catch {}
        }
    } catch (err) {
        logger.error('bot', `re-engagement loop error: ${err instanceof Error ? err.message : err}`);
    }
}, 6 * 60 * 60_000));
```

## Fix 3: Add setLastFollowupMsgId + import getSequenceMedia

In `src/db.ts`, add function:

```typescript
export function setLastFollowupMsgId(telegramId: number, messageId: number): void {
    db.prepare(`INSERT INTO onboarding_tracking (telegram_id, last_followup_msg_id)
        VALUES (?, ?) ON CONFLICT(telegram_id) DO UPDATE SET last_followup_msg_id = ?`)
        .run(telegramId, messageId, messageId);
}
```

And export `getSequenceMedia` from db.ts if not already exported — verify the existing export.

In `src/bot.ts`, import `getSequenceMedia` and `getOnboardingTracking` from `./db.js`.

## Fix 4: Remove [link] placeholders from templates

In `src/db.ts` seed data or run migration:

```typescript
db.exec(`
    UPDATE templates SET message = REPLACE(message, '📱 See what they\\'re saying: [link]', '')
    WHERE key IN ('followup_never_traded', 'reengage_never_traded');
    UPDATE templates SET message = REPLACE(message, '📸 Real results: [link]', '')
    WHERE key IN ('followup_never_traded', 'reengage_never_traded');
    UPDATE templates SET message = REPLACE(message, '👇 Tap below. First trade is on the house.', '')
    WHERE key IN ('followup_never_traded', 'reengage_never_traded');
`);
```

## Fix 5: Wire up funding sequence to trigger after demo trades

In `src/bot.ts` — after each demo trade is placed, call `checkFundingSequence()` with a `sendFn` that sends both text AND media.

Find where demo trade result is handled (look for existing trade callback or trade_complete handler). After incrementing trade count:

```typescript
import { getSequenceMedia } from './db.js';
import { checkFundingSequence } from './onboarding.js';

// Inside the trade result handler, after a demo trade completes:
await checkFundingSequence(telegramId, async (msg, button) => {
    // Send funding message with media from sequence_media
    const media = getSequenceMedia(templateKey); // templateKey from checkFundingSequence
    if (media?.file_id) {
        if (media.media_type === 'video') {
            await ctx.replyWithVideo(media.file_id, {
                caption: msg,
                reply_markup: { inline_keyboard: [[{ text: button.text, url: button.url }]] }
            });
        } else {
            await ctx.replyWithPhoto(media.file_id, {
                caption: msg,
                reply_markup: { inline_keyboard: [[{ text: button.text, url: button.url }]] }
            });
        }
    } else {
        await ctx.reply(msg, {
            reply_markup: { inline_keyboard: [[{ text: button.text, url: button.url }]] }
        });
    }
});
```

**Note:** This requires modifying `checkFundingSequence` in `src/onboarding.ts` to also return the `templateKey` so `sendFn` knows which media to look up. Alternatively, change `sendFn` signature to `(msg: string, button: {...}, templateKey?: string) => Promise<void>`.

## Verification
- New user gets stuck → 6h later receives follow-up with image + auto-deletes previous
- Connected user with 2+ demo trades → receives funding message with image + Fund button
- `[link]` placeholders gone from follow-up templates
