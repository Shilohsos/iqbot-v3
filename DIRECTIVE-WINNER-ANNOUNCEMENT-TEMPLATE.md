# DIRECTIVE: Winner Announcement Template — Structured Format + Admin Contact

## New Template
Replace the current announcement message (giveaway.ts line 255-259) with:

```ts
const perWinner = event.prize_per_winner != null ? `$${event.prize_per_winner.toFixed(2)}` : 'N/A';
const totalPool = event.prize_pool != null ? `$${event.prize_pool.toFixed(2)}` : 'N/A';

let winnersList = '';
winnerDisplayIds.forEach((id, i) => {
    winnersList += `${i + 1}. \`${maskFabId(id)}\`\n`;
});

const announcementMsg =
    `🎉 *GIVEAWAY RESULTS*\n\n` +
    `💰 *Total Prize Pool:* ${totalPool}\n` +
    `💵 *Amount Per Winner:* ${perWinner}\n\n` +
    `🏆 *WINNERS:*\n${winnersList}\n` +
    `Winners contact admin now for your winnings!\n\n` +
    `Missed out? Don't let it happen again. Upgrade to PRO and join the next one! 🔥`;
```

## Admin Contact Button
Add an inline button below the announcement to contact admin:
```ts
const adminLink = process.env.ADMIN_CONTACT_LINK ?? 'https://t.me/shiloh_is_10xing';
const replyMarkup = {
    inline_keyboard: [[{ text: '👤 Contact Admin', url: adminLink }]],
};

// Pass replyMarkup to insertNotification
insertNotification(uid, announcementMsg, { replyMarkup: JSON.stringify(replyMarkup) });
```

## Full Example Output
```
🎉 GIVEAWAY RESULTS

💰 Total Prize Pool: $200.00
💵 Amount Per Winner: $50.00

🏆 WINNERS:
1. 192***247
2. 185***258
3. 181***471
4. 183***519

Winners contact admin now for your winnings!

Missed out? Don't let it happen again. Upgrade to PRO and join the next one! 🔥

[ 👤 Contact Admin ]
```

## Notes
- `prize_per_winner` may be null — show "N/A" if so
- `prize_pool` may be null — show "N/A" if so
- Winner IDs must be masked via `maskFabId()` (already exists)
- Admin contact button must use `url` type (not callback) so it works for users who haven't started the bot
