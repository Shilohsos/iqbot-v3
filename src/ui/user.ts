import { hasAccess } from '../access.js';

type Btn = { text: string; callback_data: string } | { text: string; url: string };
type IKMarkup = { inline_keyboard: Btn[][] };

/**
 * Product-based main menu. Unlocked products route to their submenu; locked
 * products route to an upsell that explains the deposit needed.
 */
export function startKeyboard(accessLevel?: string): IKMarkup {
    const supportUrl = process.env.ADMIN_CONTACT_LINK ?? 'https://t.me/shiloh_is_10xing';

    const aiUnlocked = hasAccess(accessLevel, 'ai_trading');
    const autoUnlocked = hasAccess(accessLevel, 'auto_trading');

    const aiBtn: Btn = aiUnlocked
        ? { text: '🤖 AI Trading', callback_data: 'ui:trade' }
        : { text: '🔒 AI Trading', callback_data: 'lock:ai_trading' };
    const autoBtn: Btn = autoUnlocked
        ? { text: '🚀 Auto Trading', callback_data: 'ui:auto' }
        : { text: '🔒 Auto Trading', callback_data: 'lock:auto_trading' };

    const rows: Btn[][] = [
        [{ text: '⚡ Signals', callback_data: 'ui:signals' }, aiBtn, autoBtn],
        [
            { text: '🎁 Giveaways', callback_data: 'ui:giveaways' },
            { text: 'History 📆', callback_data: 'ui:history' },
            { text: 'Leaderboard 🏆', callback_data: 'ui:leaderboard' },
        ],
        [{ text: '⚙️ Smart Recovery Settings', callback_data: 'ui:martingale_settings' }],
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
