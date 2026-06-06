# DIRECTIVE-FIX-FUNNEL-TRACKING.md

## Problem

The admin funnel view shows raw event counts but is missing:
- Landing page visit tracking (conversion from Meta ad → website)
- A clear conversion pipeline visualization
- All-time/per-month stats vs just "today"

## Implementation

### 1. `src/db.ts` — Expand `funnel_events` schema and stats

Add a `source` column to track where visits come from:

```sql
ALTER TABLE funnel_events ADD COLUMN source TEXT;
```

Add new funnel query functions:

```typescript
export function getFunnelPipeline(): {
    page_views_today: number;
    page_views_this_week: number;
    channel_joins_today: number;
    channel_joins_this_week: number;
    connects_today: number;
    connects_this_week: number;
    funded_today: number;
    funded_this_week: number;
    recent_events: Array<{ event_type: string; created_at: string; source: string | null }>;
} {
    const today = new Date().toISOString().split('T')[0];
    const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();

    const count = (sql: string, param?: string) => {
        return (db.prepare(sql).get(param ?? today) as { cnt: number }).cnt;
    };

    const recent = db.prepare(
        `SELECT event_type, created_at, source FROM funnel_events ORDER BY created_at DESC LIMIT 20`
    ).all() as Array<{ event_type: string; created_at: string; source: string | null }>;

    return {
        page_views_today: count(`SELECT COUNT(*) AS cnt FROM funnel_events WHERE event_type = 'page_visit' AND date(created_at) = date('now')`),
        page_views_this_week: count(`SELECT COUNT(*) AS cnt FROM funnel_events WHERE event_type = 'page_visit' AND created_at >= ?`, weekAgo),
        channel_joins_today: count(`SELECT COUNT(*) AS cnt FROM funnel_events WHERE event_type = 'channel_join_approved' AND date(created_at) = date('now')`),
        channel_joins_this_week: count(`SELECT COUNT(*) AS cnt FROM funnel_events WHERE event_type = 'channel_join_approved' AND created_at >= ?`, weekAgo),
        connects_today: count(`SELECT COUNT(*) AS cnt FROM funnel_events WHERE event_type = 'user_connected' AND date(created_at) = date('now')`),
        connects_this_week: count(`SELECT COUNT(*) AS cnt FROM funnel_events WHERE event_type = 'user_connected' AND created_at >= ?`, weekAgo),
        funded_today: count(`SELECT COUNT(*) AS cnt FROM funnel_events WHERE event_type = 'user_funded' AND date(created_at) = date('now')`),
        funded_this_week: count(`SELECT COUNT(*) AS cnt FROM funnel_events WHERE event_type = 'user_funded' AND created_at >= ?`, weekAgo),
        recent_events: recent,
    };
}
```

Also add a function to insert a funnel event from the tracking endpoint:

```typescript
export function logPageVisit(source?: string): void {
    db.prepare('INSERT INTO funnel_events (event_type, source) VALUES (?, ?)').run('page_visit', source ?? null);
}
```

### 2. `src/bot.ts` — Update admin funnel view

Replace the existing `admin:funnel` handler with a proper conversion funnel display:

```typescript
bot.action('admin:funnel', async ctx => {
    await ctx.answerCbQuery();
    const url = getConfig('funnel_url') ?? 'Not set';
    const p = getFunnelPipeline();
    
    // Conversion rates
    const viewsToJoins = p.page_views_today > 0
        ? ((p.channel_joins_today / p.page_views_today) * 100).toFixed(1)
        : '0.0';
    const joinsToConnects = p.channel_joins_today > 0
        ? ((p.connects_today / p.channel_joins_today) * 100).toFixed(1)
        : '0.0';
    const connectsToFunded = p.connects_today > 0
        ? ((p.funded_today / p.connects_today) * 100).toFixed(1)
        : '0.0';

    let msg = `🔻 *Conversion Funnel*
🌐 Landing Page: ${url}

*📈 Today*
👁️ Page Views: ${p.page_views_today}
📥 Channel Joins: ${p.channel_joins_today}
🔗 Connects: ${p.connects_today}
💰 Funded: ${p.funded_today}

*📊 Conversion Rates*
Views → Joins: ${viewsToJoins}%
Joins → Connects: ${joinsToConnects}%
Connects → Funded: ${connectsToFunded}%

*📅 This Week*
👁️ Views: ${p.page_views_this_week}
📥 Joins: ${p.channel_joins_this_week}
🔗 Connects: ${p.connects_this_week}
💰 Funded: ${p.funded_this_week}

*🕐 Recent Activity*
${p.recent_events.slice(0, 5).map(e =>
    `• ${e.event_type} ${e.source ? `(${e.source})` : ''} — ${e.created_at.slice(11, 16)}`
).join('\\n')}`;

    await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: funnelKeyboard() });
});
```

### 3. `meta-track.py` — Add page visit logging endpoint

Add a `/api/log_visit` endpoint that logs page views to the bot's DB:

```python
@app.route('/api/log_visit', methods=['POST'])
def log_visit():
    """Log a page visit from the landing page (called via fetch beacon)."""
    data = request.get_json(silent=True) or {}
    source = data.get('source', 'direct')
    try:
        import subprocess
        # Write to the bot's DB
        db_path = '/root/iqbot-v3/iqbot-v3.db'
        subprocess.run([
            'sqlite3', db_path,
            f"INSERT INTO funnel_events (event_type, source) VALUES ('page_visit', '{source}')"
        ], capture_output=True, timeout=5)
        return jsonify({'ok': True})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500
```

### 4. Landing page — Add visit tracking

In `/var/www/10xbot/funnel/index.html`, add a page visit beacon on load:

```javascript
// Track page visit to bot's funnel
fetch('/api/log_visit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'meta_ad' }),
    keepalive: true, // fires even if user navigates away
}).catch(() => {}); // silent fail
```

Also add tracking to the CTA button click:

```javascript
// On "Join Channel" button click
document.querySelectorAll('a[href*="t.me"]').forEach(el => {
    el.addEventListener('click', () => {
        trackCAPI('Contact', { content_name: 'channel_cta_click' });
        fetch('/api/log_visit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source: 'channel_cta' }),
            keepalive: true,
        }).catch(() => {});
    });
});
```

### 5. Wire `user_connected` and `user_funded` events

In `src/bot.ts`, add funnel tracking at connection and funding points:

**After successful connection** (around line 4285 in the `awaiting_password` handler, and line 4373 in the standalone connect):
```typescript
insertFunnelEvent('user_connected', JSON.stringify({ telegram_id: ctx.from!.id }));
```

**When a user funds / reaches funded tier** (in the auto-promotion or tier check):
```typescript
insertFunnelEvent('user_funded', JSON.stringify({ telegram_id: ctx.from!.id }));
```

## Deploy

1. Run `ALTER TABLE` SQL to add `source` column
2. Update `src/db.ts` — add `getFunnelPipeline()` and `logPageVisit()`
3. Update `src/bot.ts` — replace funnel handler with pipeline view + wire events
4. Update `meta-track.py` — add `/api/log_visit` endpoint
5. Update landing page `index.html` — add visit beacon
6. `npm run build && pm2 restart iqbot-v3-bot --update-env && pm2 restart meta-track`
