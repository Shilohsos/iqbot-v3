/**
 * Product-based main menu. Unlocked products route to their submenu; locked
 * products route to an upsell that explains the deposit needed.
 *
 * Removed per Master: Marathon, History, Leaderboard, Swarm.
 */
export function startKeyboard(accessLevel) {
    const supportUrl = process.env.ADMIN_CONTACT_LINK ?? 'https://t.me/shiloh_is_10xing';
    // All products are available to everyone — demo mode gates via daily caps
    // in the individual handlers. No lock icons.
    const aiBtn = { text: '⟡ Private Trader', callback_data: 'ui:trade' };
    const autoBtn = { text: '✦ Autopilot', callback_data: 'ui:auto' };
    const rows = [
        [{ text: '· Signals', callback_data: 'ui:signals' }, aiBtn],
        [autoBtn],
        [{ text: '◆ Copy Trading', callback_data: 'ui:copy' }],
        [{ text: '⟢ 10x Yacht Club', callback_data: 'ui:yacht' }],
        [
            { text: '❖ Help & FAQ', callback_data: 'ui:help' },
            { text: '✆ Support', url: supportUrl },
        ],
    ];
    return { inline_keyboard: rows };
}
export function backKeyboard() {
    return {
        inline_keyboard: [[{ text: '⟵ Back', callback_data: 'ui:start' }]],
    };
}
