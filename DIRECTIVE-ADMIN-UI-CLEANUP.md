# Remove items from admin UI

## IMPORTANT: Merge master first

---

## Changes

**File:** `src/ui/admin.ts`

Remove these buttons from the `adminKeyboard()` function:

1. **SSID Health** — `{ text: '🔑 SSID Health', callback_data: 'admin:ssid_health' }`
2. **LLM Templates** — `{ text: '🧠 LLM Templates', callback_data: 'admin:llm_templates' }`
3. **Test Mode ON/OFF** — both `admin:testmode:on` and `admin:testmode:off` buttons
4. **Broadcasts** (history) — `{ text: '📈 Broadcasts', callback_data: 'admin:broadcast_history' }`
5. **Onboarding** — `{ text: '👣 Onboarding', callback_data: 'admin:onboarding_funnel' }`
6. **Media Lib** — `{ text: '📁 Media Lib', callback_data: 'admin:media_library' }`

The remaining keyboard should look like:

```
📊 Today      | 🔌 Activations
🔍 Find Users | 🔑 Tokens
⚙️ System     | 📢 Broadcast
🎁 Giveaways  | 🏆 Top Traders
🔻 Funnel     | 📋 Audits
🛡️ Admin      | ✍️ Compose Post
🟢 Go Live    | 🔙 Back
```

The callback handlers for these removed buttons can stay in the code (they just won't be reachable from the menu anymore).
