# Fix Meta Conversions API Issues

## Issue 1: Missing currency in Lead events

### Problem
100% of Lead events lack `currency` — Meta rejects them.

### Fix in `src/channel.ts` (Claude)
If channel.ts sends Lead events, add `currency: 'USD'` to custom_data. (Currently channel.ts only sends `CompleteRegistration`.)

### Fix in `meta-track.py` (manual)
Add a default currency fallback at line 90:
```python
custom_data = data.get("custom_data", {})
if event_name == "Lead" and "currency" not in custom_data:
    custom_data["currency"] = "USD"
```

### Fix in funnel HTML (manual)
In `/var/www/10xbot/funnel/index.html` and `/var/www/10xbot/funnel/go/index.html`, add `currency:'USD'` to all `trackCAPI('Lead',...)` calls:
```html
onclick="trackCAPI('Lead',{content_name:'hero_cta_click',currency:'USD'});fbq('track','Lead',{content_name:'hero_cta_click',content_category:'conversion',currency:'USD'});"
```

There are 3 Lead event calls in each file (lines 1319, 1490, 1504).

## Issue 2: Client IP shared across users (83% events affected)

### Problem
Server-side `CompleteRegistration` events from `channel.ts` POST to `localhost:8766` with no real client IP. `request.remote_addr` = `127.0.0.1` → Meta sees ALL users sharing the same IP.

### Fix in `src/channel.ts` (Claude)
Add `skip_ip: true` to the server-side event:

```typescript
body: JSON.stringify({
    event_name: 'CompleteRegistration',
    event_source_url: 'https://t.me/10xpremium',
    custom_data: { source: 'telegram_channel', telegram_id: userId, language_code: lang },
    skip_ip: true,
}),
```

### Fix in `meta-track.py` (manual)
Add `skip_ip` handling. Change the user_data building section from:
```python
user_data: dict = {
    "client_ip_address": client_ip,
    "client_user_agent": client_ua,
}
```
to:
```python
skip_ip = data.get("skip_ip", False)
user_data: dict = {}
if not skip_ip:
    user_data["client_ip_address"] = client_ip
    user_data["client_user_agent"] = client_ua
```

## Files to modify (Claude — in git repo)
- `src/channel.ts` — add `skip_ip: true` to the CompleteRegistration event

## Files to modify (Manual — outside git repo)
- `/root/iqbot-v3/meta-track.py` — default currency + skip_ip handling
- `/var/www/10xbot/funnel/index.html` — currency in Lead events
- `/var/www/10xbot/funnel/go/index.html` — currency in Lead events
- Facebook Events Manager UI — add `10xpremium.online` to domain allowlist

## Verification
1. Trigger Lead → Events Manager currency warning should clear
2. User auto-approves → IP sharing percentage should drop
3. Domain allowlist — manual step in Events Manager settings
