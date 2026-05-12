type Btn = { text: string; callback_data: string } | { text: string; url: string };
type IKMarkup = { inline_keyboard: Btn[][] };

export function getAdminId(): number {
    const fromEnv = parseInt(process.env.ADMIN_USER_ID ?? '', 10);
    return isNaN(fromEnv) ? 1615652240 : fromEnv;
}

export function adminKeyboard(): IKMarkup {
    return {
        inline_keyboard: [
            [
                { text: '📊 Today',       callback_data: 'admin:today' },
                { text: '🔌 Activations', callback_data: 'admin:activations' },
            ],
            [
                { text: '🔍 Find Users',  callback_data: 'admin:find_users' },
                { text: '🔑 Tokens',      callback_data: 'admin:tokens' },
            ],
            [
                { text: '⚙️ System',     callback_data: 'admin:system' },
                { text: '📢 Broadcast',   callback_data: 'admin:broadcast' },
            ],
            [
                { text: '🏆 Top Traders', callback_data: 'admin:top_traders' },
                { text: '🔻 Funnel',      callback_data: 'admin:funnel' },
            ],
            [
                { text: '📋 Audits',      callback_data: 'admin:audits' },
                { text: '🛡️ Admin',      callback_data: 'admin:admin' },
            ],
            [{ text: '🔙 Back', callback_data: 'ui:start' }],
        ],
    };
}

export function adminBackKeyboard(): IKMarkup {
    return { inline_keyboard: [[{ text: '🔙 Admin Menu', callback_data: 'admin:back' }]] };
}

export function broadcastTargetKeyboard(): IKMarkup {
    return {
        inline_keyboard: [
            [{ text: '🟢 Active Traders (< 5h ago)',   callback_data: 'broadcast:active' }],
            [{ text: '🔴 Inactive Traders (5h+ idle)', callback_data: 'broadcast:inactive' }],
            [{ text: '👥 All Users',                   callback_data: 'broadcast:all' }],
            [{ text: '🔙 Admin Menu',                  callback_data: 'admin:back' }],
        ],
    };
}

export function broadcastLinkKeyboard(): IKMarkup {
    return {
        inline_keyboard: [
            [
                { text: '🔗 URL link',          callback_data: 'broadcast_btn:url' },
                { text: '⚡ Action',            callback_data: 'broadcast_btn:action' },
                { text: '✖️ No button',         callback_data: 'broadcast_btn:none' },
            ],
        ],
    };
}

export function broadcastActionKeyboard(): IKMarkup {
    return {
        inline_keyboard: [
            [{ text: '🎯 Trade Now',    callback_data: 'broadcast_action:trade' }],
            [{ text: '📊 Stats',        callback_data: 'broadcast_action:stats' }],
            [{ text: '📆 History',      callback_data: 'broadcast_action:history' }],
            [{ text: '🏆 Leaderboard',  callback_data: 'broadcast_action:leaderboard' }],
            [{ text: '📋 Menu',         callback_data: 'broadcast_action:menu' }],
        ],
    };
}

export function broadcastTimerKeyboard(): IKMarkup {
    return {
        inline_keyboard: [[
            { text: '5m',        callback_data: 'bcast_timer:300000' },
            { text: '15m',       callback_data: 'bcast_timer:900000' },
            { text: '1h',        callback_data: 'bcast_timer:3600000' },
            { text: '✏️ Custom', callback_data: 'broadcast:custom_timer' },
            { text: 'Never',     callback_data: 'bcast_timer:0' },
        ]],
    };
}

export function tokenTierKeyboard(): IKMarkup {
    return {
        inline_keyboard: [
            [{ text: '🚀 Newbie Tier', callback_data: 'token_tier:NEWBIE' }],
            [{ text: '⚡ PRO Tier',    callback_data: 'token_tier:PRO' }],
            [{ text: '🔙 Admin Menu',  callback_data: 'admin:back' }],
        ],
    };
}

export function generateTokenKeyboard(): IKMarkup {
    return {
        inline_keyboard: [
            [{ text: '➕ Generate New Token', callback_data: 'admin:generate_token' }],
            [{ text: '🔙 Admin Menu',         callback_data: 'admin:back' }],
        ],
    };
}

export function topTradersAdminKeyboard(): IKMarkup {
    return {
        inline_keyboard: [
            [{ text: '➕ Manual Add',  callback_data: 'admin:manual_add' }],
            [{ text: '🔙 Admin Menu', callback_data: 'admin:back' }],
        ],
    };
}

export function funnelKeyboard(): IKMarkup {
    return {
        inline_keyboard: [
            [{ text: '🌐 Set Landing Page URL', callback_data: 'admin:set_funnel_url' }],
            [{ text: '🔙 Admin Menu',           callback_data: 'admin:back' }],
        ],
    };
}

export function memberManagementKeyboard(): IKMarkup {
    return {
        inline_keyboard: [
            [
                { text: '👥 View All', callback_data: 'member:view' },
                { text: '➕ Add',      callback_data: 'member:add' },
            ],
            [
                { text: '⏸️ Pause',   callback_data: 'member:pause' },
                { text: '▶️ Resume',  callback_data: 'member:resume' },
            ],
            [
                { text: '🗑️ Remove', callback_data: 'member:remove' },
                { text: '✉️ Message', callback_data: 'member:message' },
            ],
            [{ text: '🔙 Admin Menu', callback_data: 'admin:back' }],
        ],
    };
}
