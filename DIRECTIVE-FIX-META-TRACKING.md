# Patch: Fix Meta CAPI tracking to increase event match quality score (4.2 → 7+)

## Problem
Facebook Events Manager shows Event Match Quality score of **4.2/10** due to missing/shared parameters:

| Issue | Current | Why |
|-------|---------|-----|
| Click ID (fbc) | ❌ Not sent | Meta links ad click → conversion |
| IP Address | 5.56% | Cloudflare header not detected |
| Browser ID (fbp) | 19.44% | Cookie not being forwarded |
| Email | ❌ Not sent | Needed for Lead/Purchase matching |
| Phone | ❌ Not sent | Nice to have |

## Fix

### 1. Fix IP address detection in meta-track.py
Cloudflare passes the real visitor IP via `CF-Connecting-IP` header, not `X-Forwarded-For`. Change line 35-36:

```python
client_ip = request.headers.get("CF-Connecting-IP") or \
            request.headers.get("X-Forwarded-For", request.remote_addr) or ""
```

### 2. Add fbc (Click ID) forwarding
The `_fbc` cookie is set by Facebook when a user clicks an ad. The funnel page JS reads it and sends it via the `fbc` field. But it may not reach Meta because the payload might drop it or the field name mismatch.

In meta-track.py, ensure `fbc` from incoming data is correctly placed in `user_data`:

```python
"user_data": {
    "client_ip_address": client_ip,
    "client_user_agent": client_ua,
    "fbc": data.get("fbc", ""),
    "fbp": data.get("fbp", ""),
    # Add email and phone if provided (hashed)
    "em": data.get("em", ""),   # SHA-256 hashed email
    "ph": data.get("ph", ""),   # SHA-256 hashed phone
},
```

### 3. Add email hashing support
When the funnel page captures a user's email (on signup/lead), it should hash it before sending:

In the funnel page JS, add an email parameter:
```js
// After user submits email on the funnel:
async function hashEmail(email) {
    const enc = new TextEncoder().encode(email.trim().toLowerCase());
    const hash = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}
// Then include in trackCAPI call:
trackCAPI('Lead', { em: await hashEmail(userEmail) });
```

### 4. Fix fbp cookie coverage
The `_fbp` cookie is set by the Facebook Pixel, but if the pixel is loaded after the `trackCAPI` call, fbp may be empty. Ensure the pixel loads BEFORE the tracking call:

```html
<!-- FB Pixel - must load BEFORE trackCAPI -->
<script>
!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);
t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}
(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '2115121012365333');
fbq('track', 'PageView');
</script>
```

The `_fbp` cookie is set by this pixel code. After it loads, `trackCAPI` will find the cookie.

## Verification
1. Fire a test ViewContent event via curl with fbc and fbp
2. Check FB Events Manager → diagnostics → Event Match Quality should improve
3. Submit a test Lead event with hashed email
4. Score should increase from 4.2/10

## Files
- `/root/iqbot-v3/meta-track.py` — Flask proxy
- `/var/www/10xbot/funnel/index.html` — Funnel page JS (if email hash needed)
