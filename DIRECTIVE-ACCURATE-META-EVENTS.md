# Patch: IP geolocation + channel join Meta events for accurate ad targeting

## Goal
Feed Meta precise location (country, state, city) on every event, and fire a conversion event when a user joins the Telegram channel.

---

### 1. IP Geolocation in meta-track.py

After extracting `client_ip`, do a free lookup via `ip-api.com` and include city/state/country in the CAPI `user_data`.

Add to `meta-track.py` after line 38 (where `client_ua` is set):

```python
# IP Geolocation via ip-api.com (free, no key, 45 req/min — fine for our volume)
geo_data: dict = {}
try:
    import urllib.request as ureq
    geo_req = ureq.urlopen(f"http://ip-api.com/json/{client_ip}?fields=city,regionName,countryCode", timeout=3)
    geo_data = json.loads(geo_req.read().decode())
except Exception:
    pass  # geo-optional — don't block the event

# After building user_data dict, add geo fields:
if geo_data.get("countryCode"):
    user_data["country"] = geo_data["countryCode"]
if geo_data.get("regionName"):
    user_data["st"] = geo_data["regionName"]
if geo_data.get("city"):
    user_data["ct"] = geo_data["city"]
```

**Note:** This is async-optional — if ip-api.com is slow or down, the event still fires without geo data. The 3s timeout prevents blocking.

---

### 2. Channel join → Meta conversion event

In `src/channel.ts`, after a user is approved (`approveChatJoinRequest` succeeds), send a POST to the meta-track proxy to fire a `CompleteRegistration` event.

Add at the top of `channel.ts`:
```ts
const META_TRACK_URL = process.env.META_TRACK_URL ?? 'http://localhost:8766/track';
```

After line 25 (`insertFunnelEvent('channel_join_approved', ...)`) inside the try block, add:

```ts
// Fire Meta conversion event for ad attribution
try {
    const lang = (ctx.from as any)?.language_code ?? '';
    await fetch(META_TRACK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            event_name: 'CompleteRegistration',
            event_source_url: 'https://t.me/10xpremium',
            fbp: '',
            fbc: '',
            custom_data: {
                source: 'telegram_channel',
                telegram_id: userId,
                language_code: lang,
            },
        }),
    });
    console.log(`[meta] CompleteRegistration sent for user ${userId}`);
} catch (err) {
    console.error(`[meta] failed to send join event for ${userId}:`, err);
}
```

Note: Telegram doesn't expose user IP, so we can't get country for channel joiners. But we send `language_code` (e.g., "en", "fr", "de") as a signal. To get precise country for Telegram users, we could add a country selection during onboarding — but that's optional for now.

---

### 3. Result: Event flow per user

| Touchpoint | Events sent to Meta | Geo data |
|------------|--------------------|----------|
| Funnel page visit | `ViewContent` | ✅ Country + State + City |
| Funnel signup | `Lead` | ✅ Country + State + City |
| Channel join | `CompleteRegistration` | ❌ No IP (Telegram API) — only language_code |

For the best accuracy, we could add a country picker during the onboarding flow (after channel join). Want that added too?

---

## Verification
1. Fire a test event with a known IP → check logs for geo data
2. Join the Telegram channel → check bot logs for `[meta] CompleteRegistration sent`
3. Check FB Events Manager → diagnostics → Event Match Quality should improve
