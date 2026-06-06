# Directive: Fix Giveaway Bugs + 10xtradersvip Tracking + Error Handling

**IMPORTANT: Merge master first** — your feature branch may not have the latest code including the funnel pipeline hotfixes.

## Section 1: Giveaway Bug Fixes

### 1.1 `getEligibleFabWinnerIds` uses wrong giveaway ID

**File:** `src/db.ts`
**Function:** `getEligibleFabWinnerIds`
**Bug:** Line 1619 uses `getLastCompletedGiveawayId()` (previous completed giveaway) instead of the `currentGiveawayId` parameter that was passed in. This means within the same giveaway, the `last_used_giveaway_id` filter doesn't work — fabricated IDs used in the current giveaway remain eligible.

**Fix:** Replace `getLastCompletedGiveawayId()` with the passed `currentGiveawayId` parameter.

```typescript
// Change line 1619 from:
const lastId = getLastCompletedGiveawayId();
// To:
const lastId = currentGiveawayId;
```

### 1.2 Add status guard before `selectWinners`

**File:** `src/bot.ts`
**Handler:** `giveaway_winners_confirm` (line ~2740)
**Bug:** No check if the giveaway is already completed. Admin can tap "Pick Winners" on a completed giveaway if the callback is cached.

**Fix:** Add event status check before calling `selectWinners`:

```typescript
// After line 2742, add:
if (event && event.status === 'completed') {
    await ctx.answerCbQuery('This giveaway already has winners.');
    await ctx.reply('❌ This giveaway already has winners selected.', { reply_markup: adminBackKeyboard() });
    return;
}
```

### 1.3 Filter participants who already won

**File:** `src/giveaway.ts`
**Function:** `selectWinners`
**Bug:** `getGiveawayParticipants(giveawayId, true)` returns ALL participants including those who already won. If the function runs twice (on the same giveaway), it'll pick the same winners again.

**Fix:** Filter out participants where `won_at IS NOT NULL`:

```typescript
// After line 230 (const allEligible = ...), add:
const allEligible = getGiveawayParticipants(giveawayId, true).filter(p => !p.won_at);
```

Also verify that `won_at` column exists on `giveaway_participants` (migrate if not):

```typescript
// In the giveaway_participants migration section:
if (!gpCols.includes('won_at'))
    db.exec('ALTER TABLE giveaway_participants ADD COLUMN won_at TEXT');
```

And update `setParticipantWinner` to set `won_at`:

```sql
UPDATE giveaway_participants SET won_at = datetime('now') WHERE id = ?
```

### 1.4 Rename "Fabricated" label in admin UI

**File:** `src/bot.ts`
**Line:** ~2806
**Bug:** Admin UI shows `"Participants: ${real + fabricated} total (Real: ${real} | Fabricated: ${fabricated})"` — the word "Fabricated" must never appear in any user-facing or admin-facing UI.

**Fix:** Change "Fabricated" to "System":

```typescript
// Change:
`Participants: ${real + fabricated} total (Real: ${real} | Fabricated: ${fabricated})`
// To:
`Participants: ${real + fabricated} total (${real} real | ${fabricated} system)`
```

Also check any other admin-display strings using the word "Fabricated" and replace with "System" or remove the breakdown entirely.

---

## Section 2: 10xtradersvip.com Tracking

### 2.1 Update Caddyfile

**File:** `/etc/caddy/Caddyfile`

10xtradersvip.com currently serves the root `/var/www/10xbot/index.html` which has NO tracking. It needs to:
- Serve from the funnel directory (which has the tracking beacon + Meta CAPI)
- Proxy `/api/*` to the meta-track Flask server on port 8766

**Fix:** Change the 10xtradersvip.com block to match 10xpremium.online:

```
10xtradersvip.com:80, www.10xtradersvip.com:80 {
    handle_path /api/* {
        reverse_proxy localhost:8766
    }
    handle {
        root * /var/www/10xbot/funnel
        file_server
    }
}
```

### 2.2 Verify landing page tracking beacon

The funnel page (`/var/www/10xbot/funnel/index.html`) already has:
- `trackCAPI()` function calling `/api/log_visit`
- `/api/log_visit` POST beacon on page load
- CTA click tracking via `trackCAPI('Lead', ...)`

No code changes needed — just the Caddyfile fix above.

---

## Section 3: Fix FOREIGN KEY Error for Orphan Users

**File:** `src/db.ts` (function `insertNotification` or wherever the FK violation originates)

**Bug:** User 8699680983 (and potentially others who joined the channel during the 403 bug period) don't exist in the `users` table. When the bot tries to insert into `notification_queue` (FK → users.telegram_id), it gets `FOREIGN KEY constraint failed`.

**Fix:** Either:
1. Make the insert ignore FK violations with `INSERT OR IGNORE`, OR
2. Check user exists before queuing, OR
3. Remove the FK constraint on notification_queue (since notifications are transient)

**Recommended fix:** Use `INSERT OR IGNORE` in the notification insert query:

```typescript
// Change:
db.prepare('INSERT INTO notification_queue (telegram_id, message_text, reply_markup, send_at) VALUES (?, ?, ?, ?)').run(...);
// To:
db.prepare('INSERT OR IGNORE INTO notification_queue (telegram_id, message_text, reply_markup, send_at) VALUES (?, ?, ?, ?)').run(...);
```

This silently drops notifications for users who don't exist in the users table — which is the correct behavior since they can't receive messages anyway.

---

## Section 4: "Too many parameter values" Error

This was already fixed in the hotfix commits (ab27738, 19ede60) — the `getFunnelPipeline()` function's `count()` helper no longer passes `undefined` as a parameter to `.get()`.

If errors persist after merging master and redeploying, check for other `db.prepare(sql).get(param)` calls where `param` might be undefined.

---

## Section 5: Real Users Winning Giveaways (Design Decision)

**Not implemented** — requires user decision. Currently, `selectWinners()` in `src/giveaway.ts` line 234-236 only picks winners from the fabricated pool:

```typescript
const pool = event.event_type === 'giveaway'
    ? allEligible.filter(p => p.fabricated === 1)
    : allEligible;
```

This means real users can never win regular giveaways. Options:
- **A:** Keep current (fabricated-only) — no change needed
- **B:** Mixed pool — real + fabricated, pick randomly weighted
- **C:** Real-only with disclaimer — but this leaks fabricated model

Decision needed from @Shilohsos.

---

## Deploy Checklist

| Step | Status |
|------|--------|
| 1. Merge master into feature branch | ☐ |
| 2. Apply Section 1 fixes (giveaway) | ☐ |
| 3. Apply Section 2 fix (Caddyfile) | ☐ |
| 4. Apply Section 3 fix (FK error) | ☐ |
| 5. `npm run build` | ☐ |
| 6. `pm2 restart iqbot-v3-bot --update-env` | ☐ |
| 7. `sudo caddy reload` (for Caddyfile) | ☐ |
| 8. Test on Shara | ☐ |
| 9. Push to origin | ☐ |
