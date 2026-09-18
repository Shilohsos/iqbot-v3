/**
 * Product-based main menu.
 * Removed per Master: Marathon, History, Leaderboard, Swarm.
 */
export function startKeyboard(_accessLevel?: string) {
    const supportUrl = process.env.ADMIN_CONTACT_LINK ?? 'https://t.me/shiloh_is_10xing';
    // Private Trader opens Smart Flow first (DIRECTIVE-SMART-FLOW.md) — the card's
    // "Choose manually" button opens the existing ui:trade wizard unchanged.
    const aiBtn = { text: '⟡ Private Trader', callback_data: 'smart:open' };
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
