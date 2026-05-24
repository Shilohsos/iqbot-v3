import { getTierConfig } from '../tiers.js';

type Btn = { text: string; callback_data: string } | { text: string; url: string };
type IKMarkup = { inline_keyboard: Btn[][] };

export function startKeyboard(tier?: string): IKMarkup {
    const supportUrl = process.env.ADMIN_CONTACT_LINK ?? 'https://t.me/shiloh_is_10xing';
    const cfg = getTierConfig(tier);
    const rows: Btn[][] = [
        [{ text: 'Take a trade 👾', callback_data: 'ui:trade' }],
        [
            { text: 'History 📆',  callback_data: 'ui:history' },
            { text: 'Stats 📈',    callback_data: 'ui:stats' },
        ],
        cfg.canViewLeaderboard
            ? [
                { text: 'Upgrade 💡',     callback_data: 'ui:upgrade' },
                { text: 'Leaderboard 🏆', callback_data: 'ui:leaderboard' },
            ]
            : [{ text: 'Upgrade 💡', callback_data: 'ui:upgrade' }],
        [{ text: '🎁 Giveaways', callback_data: 'ui:giveaways' }],
        [{ text: '⚙️ Smart Recovery Settings', callback_data: 'ui:martingale_settings' }],
    ];
    rows.push(
        [{ text: 'Help & FAQ ❓', callback_data: 'ui:help' }],
        [{ text: 'Support 🔋', url: supportUrl }],
    );
    return { inline_keyboard: rows };
}

export function backKeyboard(): IKMarkup {
    return {
        inline_keyboard: [[{ text: '🔙 Back', callback_data: 'ui:start' }]],
    };
}

export function onboardKeyboard(): IKMarkup {
    return {
        inline_keyboard: [
            [{ text: '✅ I have an IQ Option account', callback_data: 'onboard:yes' }],
            [{ text: '🆕 Create one free (takes 2 min)',  callback_data: 'onboard:no' }],
        ],
    };
}
