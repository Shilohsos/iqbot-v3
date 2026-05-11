type Btn = { text: string; callback_data: string };
type IKMarkup = { inline_keyboard: Btn[][] };

export function startKeyboard(): IKMarkup {
    return {
        inline_keyboard: [
            [
                { text: '📊 Trade',   callback_data: 'ui:trade' },
                { text: '📈 History', callback_data: 'ui:history' },
            ],
            [
                { text: '💰 Balance',  callback_data: 'ui:balance' },
                { text: '⚙️ Settings', callback_data: 'ui:settings' },
            ],
        ],
    };
}

export function backKeyboard(): IKMarkup {
    return {
        inline_keyboard: [[{ text: '🔙 Back', callback_data: 'ui:start' }]],
    };
}
