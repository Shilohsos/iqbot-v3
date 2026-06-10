# DIRECTIVE: Funnel & Landing Page Overhaul — USD, Scarcity, Better Tracking

**IMPORTANT:** Merge master first before implementing.

## Part A: Landing Page — `/var/www/10xbot/funnel/index.html`

Switch market from Nigeria (₦ Naira) to international ($ USD). Add scarcity mechanics. Improve visual appeal.

### A1: Currency — ₦ → $

- All `₦` symbols in HTML and JavaScript → `$`
- Challenge amounts: `₦30K` → `$300`, `₦10M` → `$100,000` (or appropriate USD scaling — keep aspirational but realistic)
- Ticker profits: `₦1,870` → `$18.70`, `₦3,740` → `$37.40` etc (divide NGN by ~100 for realistic USD)
- Results table stakes/profits: same NGN→USD conversion
- Change section subtitle from "Real Results. Real Naira." → "Real Results. Real Profits."

### A2: CTA Text — "Message Admin" → "Talk to Admin"

Find and replace all instances:
- `Message Admin` (button text) → `Talk to Admin`
- Keep the link pointing to `https://t.me/m/Meu9fyDCMWVk` unchanged

### A3: Equal Visual Weight for "Join Channel"

Currently "Message Admin" uses `btn-primary` (purple gradient, prominent) and "Join Channel" uses `btn-outline` (transparent, less visible).

Change "Join Channel" from `btn-outline` to `btn-primary` with a gold/amber gradient instead of purple — so both buttons are equally prominent but visually distinct:

```html
<a href="https://t.me/+rPvBi_BnG5s5Zjg0" class="btn-primary" style="background:linear-gradient(135deg,#f0b429,#d97706);box-shadow:0 4px 24px rgba(240,180,41,0.35)">
```

### A4: Scarcity Elements

**Live visitor counter** — add near the hero heading:
```html
<div class="scarcity-bar">
  <span class="live-dot"></span> <span id="visitorCount">47</span> people viewing right now
</div>
```
With CSS:
```css
.scarcity-bar {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 14px; background: rgba(77,216,101,0.08);
  border: 1px solid rgba(77,216,101,0.2); border-radius: 999px;
  font-size: 13px; color: var(--text-dim); margin-bottom: 16px;
}
.live-dot { width: 6px; height: 6px; background: var(--green); border-radius: 50%; animation: pulse-dot 2s ease-in-out infinite; }
```

Add JS to randomize visitor count between 42-78 every 30 seconds (not real — social proof mechanic).

**Spots remaining counter** — below the hero heading:
```html
<div class="spots-bar">
  ⚡ <span id="spotsCount">18</span> of <span>20</span> trading spots activated today
</div>
```
With JS to decrement toward 0 and reset daily.

### A5: Auto-Rotating Results

Current results list is static. Add auto-rotation that:
- Every 4 seconds, the top result fades out, slides to bottom, and the list shifts up
- Highlight results above $50 profit with a subtle glow/green border pulse
- Pause rotation on hover

### A6: Testimonial Section

Add a testimonial section between results and final CTA:
```html
<section>
  <div class="section-inner">
    <h2 class="section-title">What Traders Say</h2>
    <div class="testimonials">
      <!-- Placeholder for Shiloh's screenshots -->
      <div class="testimonial-card">
        <div class="testimonial-image" id="testimonialImage">
          <!-- Screenshot placeholder — Shiloh will provide file paths -->
          <p style="color:var(--text-dim);padding:40px;text-align:center">[Screenshot]</p>
        </div>
        <div class="testimonial-caption">Real user result from our AI bot</div>
      </div>
    </div>
  </div>
</section>
```
Claude should add a generic testimonial section with a placeholder that can accept screenshot image URLs.

### A7: Visual Polish

- Add subtle entrance animations to sections as they scroll into view (Intersection Observer + fade-up)
- The hero chart bars: make them more dynamic with random heights on page load
- Add a subtle particle/sparkle effect in the hero background (CSS only, no JS library)
- Improve mobile responsiveness (check button stacking, font sizes under 480px width)

---

## Part B: Meta CAPI Tracking — Fix & Improve

### B1: `meta-track.py` fixes

Current issues identified:
1. Route `/track` and `/api/track` both exist — Caddy only proxies `/api/*` so `/track` is unreachable externally. Remove the redundant `/track` route.
2. Caddyfile uses `handle /api/*` which does NOT strip the prefix — Flask sees `/api/track` as the path. Confirm the route matches.
3. The Flask server is running in debug mode (`WARNING: This is a development server`). Change to production-ready. However, since it's behind Caddy reverse proxy, the Flask dev server warning is cosmetic — but add `threaded=True` to handle concurrent requests.
4. Add `skip_ip` parameter when IP forwarding is unreliable (from funnel page which is behind Cloudflare tunnel):
   ```python
   if not client_ip or client_ip in ('127.0.0.1', '::1', ''):
       user_data.pop('client_ip_address', None)
       user_data['skip_ip'] = True  # Meta will estimate IP from network
   ```

### B2: Improve Event Match Quality

Currently at 4.2/10. Add these to the CAPI payload:
1. **Forward `external_id`** if available (hashed email from bot when user connects in channel.ts)
2. **Add `lead_id`** tracking — funnel events table has a `source` column. When the bot sends CompleteRegistration from channel.ts, include the `event_source_url` from the landing page visit for better matching.

### B3: Bot-side funnel event enhancement

In `src/channel.ts`, when firing `CompleteRegistration`, include:
- `event_id` (for dedup with browser pixel)
- `skip_ip: false` (the bot runs server-side, IP is stable)
- Forward the user's fbp/fbc if captured during onboarding

Check `src/bot.ts` for where `funnel_events` INSERT happens (page_visit, channel_join, user_connected, user_funded) — ensure all events include relevant metadata (source, telegram_id, any Meta tracking params).

---

## Part C: Caddyfile — Verify Routing

Update the Caddyfile comment to document the routing:
- `10xpremium.online:80` → `/api/*` → reverse_proxy to `localhost:8766` (meta-track)
- `10xpremium.online:80` → everything else → file_server from `/var/www/10xbot/funnel`
- The landing page CAPI `/api/track` endpoint works through this chain: browser → Cloudflare tunnel → `10xpremium.online/api/track` → Caddy → meta-track on port 8766

No functional change needed unless the `/track` (without `/api/`) route needs to be removed.

---

## Verification

- [ ] All ₦ changed to $ across landing page
- [ ] "Talk to Admin" replaces "Message Admin" everywhere
- [ ] "Join Channel" uses equal-weight button style
- [ ] Scarcity counter (visitors + spots) working
- [ ] Results auto-rotation working
- [ ] Testimonial section present with placeholder
- [ ] Entrance animations functioning
- [ ] `meta-track.py` has only `/api/track` route
- [ ] Event Match Quality improvements applied
- [ ] Build passes (no TypeScript changes except channel.ts)
- [ ] Caddy routes verified
