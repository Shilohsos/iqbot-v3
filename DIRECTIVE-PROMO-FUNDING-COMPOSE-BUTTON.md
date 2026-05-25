# DIRECTIVE: Promo Code Funding Link + Compose Post Button

## 1. Promo Code Broadcast — Add Funding Link

When a promo code is announced to users, include a funding button so they can deposit immediately.

### Current
Promo code announcement just shows the code and "Claim Code" button.

### New
Add a funding button below the claim button:

```
🏷️ NEW PROMO CODE

150% BONUS CODE
Code: BONUS150
Limited: 50 claims available

Tap below to claim your code 👇

[ 🎁 Claim Code ]   [ 💰 Fund Account ]
```

### Implementation
In `activateGiveaway()` or promo broadcast (giveaway.ts ~line 304), add the funding URL button:
```ts
const fundingUrl = process.env.FUNDING_URL ?? 'https://iqoption.com/pwa/payments/deposit';
const markup = canClaim
    ? { inline_keyboard: [
        [{ text: '🎁 Claim Code', callback_data: `promo:claim:${giveawayId}` }],
        [{ text: '💰 Fund Account', url: fundingUrl }],
      ]}
    : { inline_keyboard: [
        [{ text: '⚡ Upgrade to PRO', callback_data: 'ui:upgrade' }],
        [{ text: '💰 Fund Account', url: fundingUrl }],
      ]};
```

---

## 2. Compose Post — Add CTA Button

When admin composes a post for the channel, add an option to attach a button.

### Flow
1. Admin clicks "✍️ Compose Post"
2. Selects topic, AI generates post
3. Admin reviews/edits
4. **NEW:** "Add a button?" → choose from:
   - 🚀 Start Bot (deep link)
   - 🎯 Trade Now (callback)
   - 💰 Fund Account (URL)
   - 📊 Stats (callback)
   - No button

### Implementation
After the post is composed, prompt:
```ts
await ctx.reply(
    '✅ Post ready. Add a button?',
    { reply_markup: composeButtonKeyboard() }
);

// composeButtonKeyboard():
{
    inline_keyboard: [
        [{ text: '🚀 Start Bot', callback_data: 'compose_btn:start' }],
        [{ text: '🎯 Trade Now', callback_data: 'compose_btn:trade' }],
        [{ text: '💰 Fund Account', callback_data: 'compose_btn:fund' }],
        [{ text: '❌ No Button', callback_data: 'compose_btn:none' }],
    ],
}
```

When a button is selected, attach it to the post and send to channel:
```ts
const fundingUrl = process.env.FUNDING_URL ?? 'https://iqoption.com/pwa/payments/deposit';
const buttonMap = {
    start: { text: '🚀 Start Bot', url: `https://t.me/${botUsername}?start=` },
    trade: { text: '🎯 Trade Now', callback_data: 'ui:trade' },
    fund:  { text: '💰 Fund Account', url: fundingUrl },
};

const replyMarkup = selected !== 'none'
    ? { inline_keyboard: [[buttonMap[selected]]] }
    : undefined;

await bot.telegram.sendMessage(CHANNEL_ID, postText, {
    parse_mode: 'Markdown',
    reply_markup: replyMarkup,
});
```

---

## Funding URL (shared)
```
https://iqoption.com/pwa/payments/deposit
```
Configurable via `FUNDING_URL` env var. Used everywhere: locked feature prompts, promo codes, compose posts.
