export const ADMIN_ID = 1615652240;

type Btn = { text: string; callback_data: string };
type IKMarkup = { inline_keyboard: Btn[][] };

export function adminKeyboard(): IKMarkup {
    return {
        inline_keyboard: [
            [
                { text: '👥 Users',    callback_data: 'admin:users' },
                { text: '📢 Broadcast', callback_data: 'admin:broadcast' },
            ],
            [
                { text: '📊 Stats',  callback_data: 'admin:stats' },
                { text: '🔑 Tokens', callback_data: 'admin:tokens' },
            ],
            [{ text: '🔙 Back', callback_data: 'ui:start' }],
        ],
    };
}
