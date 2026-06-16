import { hasAccess } from '../access.js';

type Btn = { text: string; callback_data: string } | { text: string; url: string };
type IKMarkup = { inline_keyboard: Btn[][] };

/**
 * Product-based main menu. Unlocked products route to their submenu; locked
 * products route to an upsell that explains the deposit needed.
 */
export function startKeyboard(accessLevel?: string): IKMarkup {
    const supportUrl = process.env.ADMIN_CONTACT_LINK ?? 'https://t.me/shiloh_is_10xing';

    // All products are available to everyone — demo mode gates via daily caps
    // in the individual handlers. No lock icons.
    const aiBtn: Btn = { text: '🤖 AI Trading', callback_data: 'ui:trade' };
    const autoBtn: Btn = { text: '🚀 Auto Trading', callback_data: 'ui:auto' };

    const rows: Btn[][] = [
        [{ text: '⚡ Signals', callback_data: 'ui:signals' }, aiBtn],
        [autoBtn],
        [
            { text: '🎁 Giveaways', callback_data: 'ui:giveaways' },
            { text: 'History 📆', callback_data: 'ui:history' },
            { text: 'Leaderboard 🏆', callback_data: 'ui:leaderboard' },
        ],
        [
            { text: '❓ Help & FAQ', callback_data: 'ui:help' },
            { text: '🔋 Support', url: supportUrl },
        ],
    ];
    return { inline_keyboard: rows };
}

export function backKeyboard(): IKMarkup {
    return {
        inline_keyboard: [[{ text: '🔙 Back', callback_data: 'ui:start' }]],
    };
}
