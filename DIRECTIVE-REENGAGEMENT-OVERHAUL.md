# Directive: Re-engagement overhaul — 3 segments, 1-hour cadence

**IMPORTANT: Merge master first**

## Overview

Replace the current single-segment 6-hour re-engagement loop with a 1-hour 3-segment system.

### Segments & Content

| Segment | Who | Content |
|---------|-----|---------|
| **Non-activated** | `ssid IS NULL`, approval not rejected | Onboarding re-engagement templates (existing `reengage_*` templates) |
| **Activated, idle** | `ssid IS NOT NULL`, `demo_trade_count = 0`, idle >1h | Previous automated sequence (existing `reengage_*` templates) |
| **Approved (all)** | `ssid IS NOT NULL`, `demo_trade_count >= 1`, idle >1h | Funding sequence templates (existing `funding_*` templates) |

### Rules
- Loop fires every **1 hour** (was 6h)
- Each new message **deletes the previous** one for that user/segment
- Gated by `features_paused`

---

## Step 1 — Add DB helper functions

**File:** `src/db.ts` — add after `getStuckOnboardingUsers()` (around line 2135)

```typescript
/** Users who are connected but have never taken a demo trade. */
export function getConnectedNonTraders(hours: number): UserRecord[] {
    const since = `-${hours} hours`;
    return db.prepare(`
        SELECT u.* FROM users u
        LEFT JOIN onboarding_tracking ot ON u.telegram_id = ot.telegram_id
        WHERE u.ssid IS NOT NULL AND u.ssid != ''
          AND u.approval_status = 'approved'
          AND (ot.demo_trade_count IS NULL OR ot.demo_trade_count = 0)
          AND (ot.last_activity_at IS NULL OR ot.last_activity_at <= datetime('now', ?))
    `).all(since) as UserRecord[];
}

/** Users who have taken at least one demo trade. */
export function getDemoTraders(): UserRecord[] {
    return db.prepare(`
        SELECT u.* FROM users u
        JOIN onboarding_tracking ot ON u.telegram_id = ot.telegram_id
        WHERE u.ssid IS NOT NULL AND u.ssid != ''
          AND u.approval_status = 'approved'
          AND ot.demo_trade_count >= 1
    `).all() as UserRecord[];
}
```

Also add a generic `setLastReengageMsgId` / `getLastReengageMsgId` pattern, or re-use the existing `onboarding_tracking.last_followup_msg_id` + `setLastFollowupMsgId`. Since the tracking table is per-user and already has a `last_followup_msg_id` column, we can reuse it for all segments — just update the column to be generic (rename concept from "onboarding follow-up" to "re-engagement message ID").

Actually, simpler: add a **new table** for re-engagement message tracking so it doesn't conflict with onboarding tracking:

```typescript
// Run as migration
db.exec(`
    CREATE TABLE IF NOT EXISTS reengage_tracking (
        telegram_id INTEGER PRIMARY KEY,
        last_msg_id INTEGER,
        last_segment TEXT,
        updated_at TEXT DEFAULT (datetime('now'))
    )
`);

export function setReengageMsgId(telegramId: number, msgId: number | null, segment: string): void {
    db.prepare(`
        INSERT INTO reengage_tracking (telegram_id, last_msg_id, last_segment, updated_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(telegram_id) DO UPDATE SET last_msg_id = ?, last_segment = ?, updated_at = datetime('now')
    `).run(telegramId, msgId, segment, msgId, segment);
}

export function getReengageTracking(telegramId: number): { last_msg_id: number | null; last_segment: string | null } | undefined {
    return db.prepare('SELECT last_msg_id, last_segment FROM reengage_tracking WHERE telegram_id = ?').get(telegramId) as any;
}
```

---

## Step 2 — Replace the re-engagement loop

**File:** `src/bot.ts` — lines 4627-4673 (the current 6-hour loop)

**Replace with:**

```typescript
// ─── Re-engagement loop (1h cadence, 3 segments) ──────────────────────────

backgroundIntervals.push(setInterval(async () => {
    if (getConfig('features_paused') === '1') return;
    try {
        // Segment 1: Non-activated users → onboarding re-engagement templates
        const nonActivated = getStuckOnboardingUsers(1);
        for (const user of nonActivated) {
            try {
                const key = getReengageTemplateKey(user.onboarding_state ?? 'entry_branch_sent');
                const t = getTemplateByKey(key);
                if (!t) continue;
                const msg = resolveUsernameTemplate(t.message, user.username ?? 'there');
                const chatId = user.telegram_id;

                // Auto-delete previous
                const tracking = getReengageTracking(chatId);
                if (tracking?.last_msg_id) {
                    try { await bot.telegram.deleteMessage(chatId, tracking.last_msg_id); } catch {}
                }

                const mediaKey = key.replace(/^reengage_/, '');
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
                setReengageMsgId(chatId, sentMsgId, 'non_activated');
                touchOnboardingActivity(chatId);
            } catch {}
            await new Promise(r => setTimeout(r, 200));
        }

        // Segment 2: Connected but never traded → re-engagement templates
        const idleConnected = getConnectedNonTraders(1);
        for (const user of idleConnected) {
            try {
                // Pick a random re-engagement template
                const reengageKeys = ['reengage_entry_stuck', 'reengage_video_stuck', 'reengage_userid_stuck',
                    'reengage_email_stuck', 'reengage_password_stuck', 'reengage_never_traded'];
                const key = reengageKeys[Math.floor(Math.random() * reengageKeys.length)];
                const t = getTemplateByKey(key);
                if (!t) continue;
                const msg = resolveUsernameTemplate(t.message, user.username ?? 'there');
                const chatId = user.telegram_id;

                const tracking = getReengageTracking(chatId);
                if (tracking?.last_msg_id) {
                    try { await bot.telegram.deleteMessage(chatId, tracking.last_msg_id); } catch {}
                }

                const mediaKey = key.replace(/^reengage_/, '');
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
                setReengageMsgId(chatId, sentMsgId, 'idle_connected');
            } catch {}
            await new Promise(r => setTimeout(r, 200));
        }

        // Segment 3: Has traded demo → funding sequence
        const traders = getDemoTraders();
        for (const user of traders) {
            try {
                const templateKeys = [
                    'funding_win_screenshot', 'funding_lifestyle_video', 'funding_testimonial',
                    'funding_payout_proof', 'funding_lifestyle_photo', 'funding_user_result',
                    'funding_user_result_video',
                ];
                const key = templateKeys[Math.floor(Math.random() * templateKeys.length)];
                const t = getTemplateByKey(key);
                if (!t) continue;
                const promo = ['10xfirst', '10xsecond'][Math.floor(Math.random() * 2)];
                let msg = t.message.replace(/10xfirst|10xsecond/g, promo);
                msg = resolveUsernameTemplate(msg, user.username ?? 'there');
                const chatId = user.telegram_id;

                // Check if we already sent this segment recently (within 6h)
                const tracking = getReengageTracking(chatId);
                if (tracking?.last_segment === 'funding') {
                    // If we sent a funding message already, check age
                    // Since the loop runs hourly, just delete old and send new
                }
                if (tracking?.last_msg_id) {
                    try { await bot.telegram.deleteMessage(chatId, tracking.last_msg_id); } catch {}
                }

                const media = getSequenceMedia(key);
                const btnMarkup = t.button_text && t.button_url
                    ? { inline_keyboard: [[{ text: t.button_text, url: t.button_url }]] }
                    : { inline_keyboard: [[{ text: '💰 Fund Account', url: 'https://iqoption.com/pwa/payments/deposit?payment_method_id=6786' }]] };

                let sentMsgId: number;
                if (media?.file_id) {
                    if (media.media_type === 'video') {
                        const sent = await bot.telegram.sendVideo(chatId, media.file_id, { caption: msg, reply_markup: btnMarkup });
                        sentMsgId = sent.message_id;
                    } else {
                        const sent = await bot.telegram.sendPhoto(chatId, media.file_id, { caption: msg, reply_markup: btnMarkup });
                        sentMsgId = sent.message_id;
                    }
                } else {
                    const sent = await bot.telegram.sendMessage(chatId, msg, { reply_markup: btnMarkup });
                    sentMsgId = sent.message_id;
                }
                setReengageMsgId(chatId, sentMsgId, 'funding');
            } catch {}
            await new Promise(r => setTimeout(r, 200));
        }
    } catch (err) {
        logger.error('bot', `re-engagement loop error: ${err instanceof Error ? err.message : err}`);
    }
}, 1 * 60 * 60_000));  // Every 1 hour
```

Also remove the old reconnect-prompt loop (lines 4601-4625) since re-engagement now covers all segments, OR keep it as-is since it handles a different case (expired SSID). Keep it — it sends reconnect prompts to users with stale SSIDs, which is a separate concern.

---

## Step 3 — Update imports

**File:** `src/bot.ts` — add to the db.js import block:
```
    getStuckOnboardingUsers,
    getOnboardingTracking,
    setLastFollowupMsgId,
+   getConnectedNonTraders,
+   getDemoTraders,
+   setReengageMsgId,
+   getReengageTracking,
```

---

## Files Changed

| File | Change |
|------|--------|
| `src/db.ts` | Add `getConnectedNonTraders()`, `getDemoTraders()`, `reengage_tracking` table migration, `setReengageMsgId()`, `getReengageTracking()` |
| `src/bot.ts` | Replace 6h re-engagement loop with 1h 3-segment loop, update imports |

## Verification

1. `npx tsc --noEmit` — must pass
2. After 1 hour, check logs: all three segments fire with appropriate content
3. Verify each new message deletes the previous one (no accumulation)
4. Test with `features_paused=1` — loop should skip
