# DIRECTIVE: Wire Testimonial Screenshots into Landing Page

**IMPORTANT:** Merge master first, then edit `/var/www/10xbot/funnel/index.html`.

Replace the 3 testimonial screenshot placeholders in the testimonial section with these actual images:

## Screenshot 1 — User Tony (trade win)
**File:** `/var/www/10xbot/funnel/assets/testimonial-tony.jpg`
**URL:** `https://10xpremium.online/assets/testimonial-tony.jpg`
**Caption:** "Waoh, I won the first trade — Tony"
**Context:** Real user who just won his first trade with the bot.

## Screenshot 2 — User Josh ($200 in 4 days)
**File:** `/var/www/10xbot/funnel/assets/testimonial-josh.jpg`
**URL:** `https://10xpremium.online/assets/testimonial-josh.jpg`
**Caption:** "Made about $200 in 4 days now — Josh"
**Context:** User sharing his consistent results.

## Screenshot 3 — $28k Account Balance Goal
**File:** `/var/www/10xbot/funnel/assets/testimonial-28k-balance.jpg`
**URL:** `https://10xpremium.online/assets/testimonial-28k-balance.jpg`
**Caption:** "I must take this account to $50k. All thanks to 10x AI."
**Context:** User showing $27,937.80 balance, aiming for $50k.

## Screenshot 4 — Car Buyer (bonus — most powerful testimonial)
**File:** `/var/www/10xbot/funnel/assets/testimonial-car.jpg`
**URL:** `https://10xpremium.online/assets/testimonial-car.jpg`
**Caption:** "I'm the newest car owner in town. All thanks to you and 10x AI. It happened so quickly, less than 3 weeks."
**Context:** User bought a car using 10x AI profits in under 3 weeks.

Replace the generic `[Screenshot]` placeholders in the testimonial section with actual `<img>` tags loading these images. Use the car testimonial as the hero testimonial (first position). Display them as screenshots inside a mock phone frame for visual context.

## Verification
- [ ] All 4 images load correctly on the landing page
- [ ] Captions match the screenshots
- [ ] Car testimonial is first (most powerful)
- [ ] Images are responsive on mobile
