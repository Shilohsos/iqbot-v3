# IQ Bot V3 — Admin UI & System Audit (2026-05-30)

## Current Admin Menu Structure

**Dashboard overview** (admin:back)
📊 Today — Top traders for today
🔌 Activations — Pending manual approvals
🔍 Find Users — Search by telegram ID
🔑 Tokens — Generate/manage tier tokens
⚙️ System — Uptime, memory, user/trade stats
📢 Broadcast — Multi-step: target → content → button → schedule/send
🎁 Giveaways — Creator + manager for Giveaway/Promo Code/Marathon
🏆 Top Traders — Edit leaderboard, manual add
🔻 Funnel — Set landing page URL only
📋 Audits — 24h report (trades, PnL, martingale)
🛡️ Admin — Member management (view/add/pause/resume/remove/message)
✍️ Compose Post — AI post generator (DeepSeek)
🔴/🟢 Test Mode — Toggle

## Integrated Systems (what works)

✅ IQ Option SDK trading
✅ Smart Recovery / Martingale (per-user settings)
✅ 3-tier system (DEMO/PRO/MASTER)
✅ Token-based tier upgrade
✅ Auto-broadcast (random interval)
✅ Giveaway / Promo Code / Marathon events
✅ Fabricated traders (leaderboard)
✅ Affiliate funnel tracking
✅ AI Compose Post (DeepSeek)
✅ Meta CAPI tracking
✅ DB-backed sessions + balance cache
✅ Test mode (Shara only)
✅ 195 LLM brain templates ready

## Gaps Found — What's Missing

### Admin UI Gaps

1. \`\`\`
   ❌ SSID Health Dashboard
   → 92 users with SSID, but can't see who's valid/expired
   → Must manually check logs
   💡 Add: "SSID Health" button → shows valid/expired/missing counts
   \`\`\`

2. \`\`\`
   ❌ User Detail Drilldown
   → Can view all users but can't click one to see full profile
   → Trades, tier, SSID status, last activity, referral info hidden
   💡 Add: Tap user → full profile card with actions
   \`\`\`

3. \`\`\`
   ❌ Funnel Page is Bare
   → Only "Set Landing Page URL" — nothing else
   💡 Add: Funnel stats (clicks, joins, connects, funds) → conversion flow
   \`\`\`

4. \`\`\`
   ❌ Broadcast Analytics
   → No tracking if messages were seen or clicked
   💡 Add: Delivery count, pending, failed per broadcast
   \`\`\`

5. \`\`\`
   ❌ No User Filters/Search
   → Can only find by telegram ID
   💡 Add: Filter by tier, activity, funding status, approval status
   \`\`\`

6. \`\`\`
   ❌ No Template Preview
   → 195 LLM templates in DB but admin can't see/preview/edit them
   💡 Add: "LLM Templates" admin menu → browse, preview, edit templates
   \`\`\`

7. \`\`\`
   ❌ No Onboarding Flow Visual
   → Can't see where users are getting stuck in the funnel
   💡 Add: Funnel stats showing drop-off at each step
   \`\`\`

8. \`\`\`
   ❌ Compose Post Uses DeepSeek
   → Old model. We're switching to Gemini 2.5 Flash-Lite
   → Plus no vision support for image analysis
   \`\`\`

### Missing Features (Already Planned)

| Feature | Status |
|---------|--------|
| 🏗️ LLM Brain (Gemini + 195 templates + vision) | Update #2 — Ready |
| 📁 Admin Media Library (upload images/videos per template) | Update #3 — Ready |
| 🔄 SSID Stability (auto-reconnect, health check) | Update #1 — Ready |
| 📊 Daily VIP Stats (admin approval before post) | Update #4a — Added |
| 📚 Educational Drip (daily tips) | Update #4b — Added |
| 🗣️ Pidgin Toggle (/pidgin command) | Update #4c — Added |

### Admin UI Improvements (New Recommendations)

9. **User Onboarding Dashboard**
   → "Where users are stuck" — visual funnel: joined → connected → traded → funded
   → Shows drop-off rates per step → identify bottleneck immediately

10. **Quick User Actions from List**
    → From member list: tap user → [Approve] [Pause] [Message] [View Trades] [Reset SSID]
    → Currently buried in separate menus

11. **Tier Distribution Overview**
    → How many DEMO / PRO / MASTER users at a glance
    → Conversion rate from each tier

12. **Broadcast Preview Before Send**
    → Show exactly how the message + button will look before sending
    → Currently sends blind

13. **Admin Notification Inbox**
    → Important alerts: SSID batch failures, low balance alerts, trade anomalies
    → Currently only visible in PM2 logs

## Recommendation — Priority Order

**High Impact, Low Effort (ship with the master directive):**
1. SSID Health button in admin menu
2. Funnel stats upgrade
3. Tier distribution in dashboard
4. Broadcast analytics (sent count)

**Requires Claude (next directive batch):**
5. User detail drilldown
6. Onboarding funnel visual
7. LLM Template admin preview
8. User filters (tier, status, activity)
9. Quick user actions
10. Broadcast preview
