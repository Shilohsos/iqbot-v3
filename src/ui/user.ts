type Btn = { text: string; callback_data: string };
type IKMarkup = { inline_keyboard: Btn[][] };

export function startKeyboard(): IKMarkup {
    return {
        inline_keyboard: [
            [{ text: 'Take a trade 👾', callback_data: 'ui:trade' }],
            [
                { text: 'History 📆',  callback_data: 'ui:history' },
                { text: 'Stats 📈',    callback_data: 'ui:stats' },
            ],
            [
                { text: 'Upgrade 💡',    callback_data: 'ui:upgrade' },
                { text: 'Help & FAQ ❓', callback_data: 'ui:help' },
            ],
            [{ text: 'Support 🔋', callback_data: 'ui:support' }],
        ],
    };
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
