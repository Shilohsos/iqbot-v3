# Directive: Callback Buttons for Re-engagement Templates

## IMPORTANT: Merge master first
```
git checkout master && git pull origin master
git checkout -b claude/reengage-callback-buttons-YeM3I
```

---

**Problem:** Re-engagement templates only support URL buttons (`button_url`). No callback buttons, no multi-button rows. Users must type replies instead of tapping.

**Fix:** Add `button_callback` column supporting single callback or multi-button JSON array. Update re-engagement loop to render callback buttons. Add buttons to all templates where meaningful. Typing still works as fallback.

---

## Change 1: Add `button_callback` column to templates table

**File:** `src/db.ts`

Add to the PRAGMA migration section (near other column migrations):

```typescript
const tmplCols = (db.prepare('PRAGMA table_info(templates)').all() as { name: string }[]).map(c => c.name);
if (!tmplCols.includes('button_callback')) {
    db.exec('ALTER TABLE templates ADD COLUMN button_callback TEXT');
}
```

---

## Change 2: Update re-engagement loop button logic

**File:** `src/bot.ts`

### 2a. Replace button markup in Segment 1 (around lines 4796-4798)

**Current:**
```typescript
const s1BtnMarkup = t.button_text && t.button_url
    ? { inline_keyboard: [[{ text: t.button_text, url: t.button_url }]] }
    : undefined;
```

**Replace with:**
```typescript
const s1BtnMarkup = buildReengageMarkup(t);
```

### 2b. Replace button markup in Segment 2 (around lines 4833-4835)

Same pattern — replace the inline markup with `buildReengageMarkup(t)`.

### 2c. Add helper function

Somewhere before the re-engagement loop (or near other helper functions):

```typescript
/**
 * Build inline keyboard markup from a template row.
 * Priority: callback buttons → single URL button → no button.
 * 
 * button_callback can be:
 *   - A JSON array string: [{"text":"Btn1","callback_data":"act1"},{"text":"Btn2","callback_data":"act2"}]
 *   - A plain string: "callback:action" (uses t.button_text as label)
 */
function buildReengageMarkup(t: { button_text?: string | null; button_url?: string | null; button_callback?: string | null }): { reply_markup: { inline_keyboard: any[][] } } | undefined {
    if (t.button_callback) {
        try {
            // Try parsing as JSON multi-button array
            const parsed = JSON.parse(t.button_callback);
            if (Array.isArray(parsed) && parsed.length > 0) {
                // Each item must have text + callback_data
                const valid = parsed.every((b: any) => b.text && b.callback_data);
                if (valid) {
                    return { reply_markup: { inline_keyboard: [parsed] } };
                }
            }
        } catch {
            // Not JSON — treat as single callback_data string
            if (t.button_text) {
                return { reply_markup: { inline_keyboard: [[{ text: t.button_text, callback_data: t.button_callback }]] } };
            }
        }
    }
    
    // Fallback: URL button
    if (t.button_text && t.button_url) {
        return { reply_markup: { inline_keyboard: [[{ text: t.button_text, url: t.button_url }]] } };
    }
    
    return undefined;
}
```

**Important:** The `buildReengageMarkup` function also needs to work for Segment 2 (connected non-traders), which currently uses the same inline pattern. Both segments should use this shared function.

---

## Change 3: Add callback values to re-engagement templates

**File:** `src/db.ts` — template seeding section

### 3a. Update existing `reengage_entry_stuck_a/b/c` (three variants)

Add `button_callback` to all 3 variants:

```typescript
['reengage_entry_stuck_a', 'entry_branch_sent', "{{username}} people are literally printing money...", JSON.stringify([
    { text: "I'm new to trading",    callback_data: 'onboard:new' },
    { text: 'I have traded before',  callback_data: 'onboard:experienced' },
])],
['reengage_entry_stuck_b', 'entry_branch_sent', "{{username}} this isn't a maybe thing...", JSON.stringify([
    { text: "I'm new to trading",    callback_data: 'onboard:new' },
    { text: 'I have traded before',  callback_data: 'onboard:experienced' },
])],
['reengage_entry_stuck_c', 'entry_branch_sent', "{{username}} real talk...", JSON.stringify([
    { text: "I'm new to trading",    callback_data: 'onboard:new' },
    { text: 'I have traded before',  callback_data: 'onboard:experienced' },
])],
```

### 3b. Update `reengage_video_stuck_a/b/c`

Add single callback button for "watched it":

```typescript
['reengage_video_stuck_a', 'new_user_watch_video', "{{username}} still haven't watched the video?...", JSON.stringify([
    { text: "✅ I've watched it", callback_data: 'onboard:watched_video' },
])],
['reengage_video_stuck_b', 'new_user_watch_video', "{{username}} skip the video, here's the short version...", JSON.stringify([
    { text: "✅ I've watched it", callback_data: 'onboard:watched_video' },
])],
['reengage_video_stuck_c', 'new_user_watch_video', "{{username}} every single person who watched...", JSON.stringify([
    { text: "✅ I've watched it", callback_data: 'onboard:watched_video' },
])],
```

### 3c. `reengage_userid_stuck_a/b/c` — no button (user must type)

These remain unchanged — no button_callback, no button_url. User must type their User ID.

### 3d. `reengage_email_stuck_a/b/c` — no button (user must type)

These remain unchanged.

### 3e. `reengage_password_stuck_a/b/c` — no button (user must type)

These remain unchanged.

### 3f. Update `reengage_never_traded_a/b/c`

Replace URL buttons with callback buttons:

```typescript
['reengage_never_traded_a', 'connected', "{{username}} you're connected but you haven't taken a single trade...", 'ui:trade', '🚀 Trade Now'],
['reengage_never_traded_b', 'connected', "{{username}} your account is live, funded, and ready...", 'ui:trade', '🚀 Trade Now'],
['reengage_never_traded_c', 'connected', "{{username}} I've been watching the charts for you...", 'ui:trade', '🚀 Trade Now'],
```

Where the order of values for the seed INSERT is: `(key, category, message, button_callback, button_text)`.

---

## Change 4: Update seed INSERT to include button_callback

**File:** `src/db.ts`

The existing seed INSERT for templates likely looks like:
```sql
INSERT OR IGNORE INTO templates (key, category, message, button_text, button_url) VALUES (?, ?, ?, ?, ?)
```

Update to include the new column:
```sql
INSERT OR IGNORE INTO templates (key, category, message, button_text, button_url, button_callback) VALUES (?, ?, ?, ?, ?, ?)
```

For templates with callback buttons, the SQL row should have:
- `button_text` = the single button's text (when button_callback is a plain string)
- `button_url` = NULL
- `button_callback` = the callback data

For multi-button templates, the `button_text` and `button_url` can be NULL, and `button_callback` holds the JSON array.

---

## Verification

1. Build: `npx tsc --noEmit`
2. Restart: `pm2 restart iqbot-v3-bot --update-env`
3. Check DB: `sqlite3 iqbot-v3.db "SELECT key, button_callback FROM templates WHERE button_callback IS NOT NULL"`
4. Test mode: Send re-engagement to Shara — verify:
   - `reengage_entry_stuck` shows 2 buttons (I'm new / I've traded)
   - `reengage_video_stuck` shows 1 button (✅ Watched it)
   - `reengage_never_traded` shows 1 button (🚀 Trade Now with callback)
   - Tapping buttons advances onboarding flow
   - Typing instead of tapping still works (fallback)
5. Verify: existing URL-only templates still work (backward compat)
