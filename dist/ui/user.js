export function startKeyboard(tier) {
    const supportUrl = process.env.ADMIN_CONTACT_LINK ?? 'https://t.me/shiloh_is_10xing';
    const rows = [
        [{ text: 'Take a trade 👾', callback_data: 'ui:trade' }],
        [
            { text: 'History 📆', callback_data: 'ui:history' },
            { text: 'Stats 📈', callback_data: 'ui:stats' },
        ],
        [
            { text: 'Upgrade 💡', callback_data: 'ui:upgrade' },
            { text: 'Leaderboard 🏆', callback_data: 'ui:leaderboard' },
        ],
        [{ text: '⚙️ Smart Recovery Settings', callback_data: 'ui:martingale_settings' }],
    ];
    rows.push([{ text: 'Help & FAQ ❓', callback_data: 'ui:help' }], [{ text: 'Support 🔋', url: supportUrl }]);
    return { inline_keyboard: rows };
}
export function backKeyboard() {
    return {
        inline_keyboard: [[{ text: '🔙 Back', callback_data: 'ui:start' }]],
    };
}
export function onboardKeyboard() {
    return {
        inline_keyboard: [
            [{ text: '✅ I have an IQ Option account', callback_data: 'onboard:yes' }],
            [{ text: '🆕 Create one free (takes 2 min)', callback_data: 'onboard:no' }],
        ],
    };
}
