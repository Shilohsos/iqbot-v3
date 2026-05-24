export function getAdminId() {
    const fromEnv = parseInt(process.env.ADMIN_USER_ID ?? '', 10);
    return isNaN(fromEnv) ? 1615652240 : fromEnv;
}
export function adminKeyboard() {
    return {
        inline_keyboard: [
            [
                { text: '📊 Today', callback_data: 'admin:today' },
                { text: '🔌 Activations', callback_data: 'admin:activations' },
            ],
            [
                { text: '🔍 Find Users', callback_data: 'admin:find_users' },
                { text: '🔑 Tokens', callback_data: 'admin:tokens' },
            ],
            [
                { text: '⚙️ System', callback_data: 'admin:system' },
                { text: '📢 Broadcast', callback_data: 'admin:broadcast' },
            ],
            [
                { text: '🎁 Giveaways', callback_data: 'admin:giveaways' },
            ],
            [
                { text: '🏆 Top Traders', callback_data: 'admin:top_traders' },
                { text: '🔻 Funnel', callback_data: 'admin:funnel' },
            ],
            [
                { text: '📋 Audits', callback_data: 'admin:audits' },
                { text: '🛡️ Admin', callback_data: 'admin:admin' },
            ],
            [{ text: '✍️ Compose Post', callback_data: 'admin:compose' }],
            [{ text: '🔙 Back', callback_data: 'ui:start' }],
        ],
    };
}
export function adminBackKeyboard() {
    return { inline_keyboard: [[{ text: '🔙 Admin Menu', callback_data: 'admin:back' }]] };
}
export function broadcastTargetKeyboard() {
    return {
        inline_keyboard: [
            [{ text: '🟢 Active Traders (< 5h ago)', callback_data: 'broadcast:active' }],
            [{ text: '🔴 Inactive Traders (5h+ idle)', callback_data: 'broadcast:inactive' }],
            [{ text: '👥 All Users', callback_data: 'broadcast:all' }],
            [{ text: '📅 Scheduled', callback_data: 'admin:scheduled' }],
            [{ text: '🔙 Admin Menu', callback_data: 'admin:back' }],
        ],
    };
}
export function broadcastSendOrScheduleKeyboard() {
    return {
        inline_keyboard: [[
                { text: '📤 Send Now', callback_data: 'broadcast:send_now' },
                { text: '⏰ Schedule', callback_data: 'broadcast:schedule' },
            ]],
    };
}
export function broadcastDelayKeyboard() {
    return {
        inline_keyboard: [[
                { text: '15m', callback_data: 'bcast_delay:900000' },
                { text: '30m', callback_data: 'bcast_delay:1800000' },
                { text: '1h', callback_data: 'bcast_delay:3600000' },
                { text: '2h', callback_data: 'bcast_delay:7200000' },
                { text: '✏️ Custom', callback_data: 'broadcast:custom_schedule' },
            ]],
    };
}
export function scheduledBroadcastsKeyboard(schedules) {
    const rows = schedules.map(s => [
        { text: `❌ Cancel: ${s.label}`, callback_data: `bcast_cancel:${s.id}` },
    ]);
    rows.push([{ text: '🔙 Admin Menu', callback_data: 'admin:back' }]);
    return { inline_keyboard: rows };
}
export function broadcastLinkKeyboard() {
    return {
        inline_keyboard: [
            [
                { text: '🔗 URL link', callback_data: 'broadcast_btn:url' },
                { text: '⚡ Action', callback_data: 'broadcast_btn:action' },
                { text: '✖️ No button', callback_data: 'broadcast_btn:none' },
            ],
        ],
    };
}
export function broadcastActionKeyboard() {
    return {
        inline_keyboard: [
            [{ text: '🎯 Trade Now', callback_data: 'broadcast_action:trade' }],
            [{ text: '📊 Stats', callback_data: 'broadcast_action:stats' }],
            [{ text: '📆 History', callback_data: 'broadcast_action:history' }],
            [{ text: '🏆 Leaderboard', callback_data: 'broadcast_action:leaderboard' }],
            [{ text: '📋 Menu', callback_data: 'broadcast_action:menu' }],
        ],
    };
}
export function broadcastTimerKeyboard() {
    return {
        inline_keyboard: [[
                { text: '5m', callback_data: 'bcast_timer:300000' },
                { text: '15m', callback_data: 'bcast_timer:900000' },
                { text: '1h', callback_data: 'bcast_timer:3600000' },
                { text: '✏️ Custom', callback_data: 'broadcast:custom_timer' },
                { text: 'Never', callback_data: 'bcast_timer:0' },
            ]],
    };
}
export function tokenTierKeyboard() {
    return {
        inline_keyboard: [
            [{ text: '🧪 DEMO Tier', callback_data: 'token_tier:DEMO' }],
            [{ text: '⚡ PRO Tier', callback_data: 'token_tier:PRO' }],
            [{ text: '👑 MASTER Tier', callback_data: 'token_tier:MASTER' }],
            [{ text: '🔙 Admin Menu', callback_data: 'admin:back' }],
        ],
    };
}
export function generateTokenKeyboard() {
    return {
        inline_keyboard: [
            [{ text: '➕ Generate New Token', callback_data: 'admin:generate_token' }],
            [{ text: '🔙 Admin Menu', callback_data: 'admin:back' }],
        ],
    };
}
export function topTradersAdminKeyboard(editableEntries = []) {
    const rows = editableEntries.map(e => [
        { text: `✏️ Edit ${e.masked}`, callback_data: `trader_edit:${e.telegram_id}` },
    ]);
    rows.push([{ text: '➕ Manual Add', callback_data: 'admin:manual_add' }]);
    rows.push([{ text: '🔙 Admin Menu', callback_data: 'admin:back' }]);
    return { inline_keyboard: rows };
}
export function activationsKeyboard(pendingUsers) {
    const rows = [];
    for (const u of pendingUsers) {
        const label = u.username ?? `ID: ${String(u.telegram_id).slice(-4)}`;
        rows.push([
            { text: `✅ Approve ${label}`, callback_data: `activation:approve:${u.telegram_id}` },
            { text: `❌ Reject ${label}`, callback_data: `activation:reject:${u.telegram_id}` },
        ]);
    }
    rows.push([{ text: '🔙 Admin Menu', callback_data: 'admin:back' }]);
    return { inline_keyboard: rows };
}
export function funnelKeyboard() {
    return {
        inline_keyboard: [
            [{ text: '🌐 Set Landing Page URL', callback_data: 'admin:set_funnel_url' }],
            [{ text: '🔙 Admin Menu', callback_data: 'admin:back' }],
        ],
    };
}
export function giveawayTargetKeyboard() {
    return {
        inline_keyboard: [
            [{ text: '👥 All Approved Users', callback_data: 'giveaway:all' }],
            [{ text: '🔥 Active Traders (last 24h)', callback_data: 'giveaway:24h' }],
            [{ text: '🔙 Admin Menu', callback_data: 'admin:back' }],
        ],
    };
}
export function giveawayManagerKeyboard(stats) {
    return {
        inline_keyboard: [
            [{ text: '➕ New Giveaway', callback_data: 'giveaway_v2:create' }],
            [{ text: '📋 View Active', callback_data: 'giveaway_v2:active' }],
            [{ text: '📅 Scheduled', callback_data: 'giveaway_v2:scheduled' }],
            [{ text: '✅ Pick Winners', callback_data: 'giveaway_v2:pick_winners' }],
            [{ text: '🔙 Admin Menu', callback_data: 'admin:back' }],
        ],
    };
}
export function giveawayTypeKeyboard() {
    return {
        inline_keyboard: [
            [{ text: '🎁 Giveaway', callback_data: 'giveaway_type:giveaway' }],
            [{ text: '🏷️ Promo Code', callback_data: 'giveaway_type:promo_code' }],
            [{ text: '🏃 Marathon', callback_data: 'giveaway_type:marathon' }],
            [{ text: '🔙 Admin Menu', callback_data: 'admin:back' }],
        ],
    };
}
export function giveawayCriteriaKeyboard() {
    return {
        inline_keyboard: [
            [{ text: '🚫 No Criteria', callback_data: 'giveaway_criteria:none' }],
            [{ text: '🆕 New User', callback_data: 'giveaway_criteria:new_user' }],
            [{ text: '💰 Min Balance', callback_data: 'giveaway_criteria:min_balance' }],
            [{ text: '🏆 Top Traders', callback_data: 'giveaway_criteria:top_traders' }],
            [{ text: '🔙 Admin Menu', callback_data: 'admin:back' }],
        ],
    };
}
export function giveawayScheduleKeyboard() {
    return {
        inline_keyboard: [
            [{ text: '🚀 Send Now', callback_data: 'giveaway_schedule:now' }],
            [{ text: '⏰ In 1h', callback_data: 'giveaway_schedule:3600' }],
            [{ text: '⏰ In 6h', callback_data: 'giveaway_schedule:21600' }],
            [{ text: '⏰ In 24h', callback_data: 'giveaway_schedule:86400' }],
            [{ text: '🔙 Admin Menu', callback_data: 'admin:back' }],
        ],
    };
}
export function promoScheduleKeyboard() {
    return {
        inline_keyboard: [
            [{ text: '🚀 Send Now', callback_data: 'promo_schedule:now' }],
            [{ text: '⏰ In 1h', callback_data: 'promo_schedule:3600' }],
            [{ text: '⏰ In 6h', callback_data: 'promo_schedule:21600' }],
            [{ text: '⏰ In 24h', callback_data: 'promo_schedule:86400' }],
            [{ text: '🔙 Admin Menu', callback_data: 'admin:back' }],
        ],
    };
}
export function marathonDurationKeyboard() {
    return {
        inline_keyboard: [
            [{ text: '24 hours', callback_data: 'marathon_duration:86400' }],
            [{ text: '3 days', callback_data: 'marathon_duration:259200' }],
            [{ text: '7 days', callback_data: 'marathon_duration:604800' }],
            [{ text: '14 days', callback_data: 'marathon_duration:1209600' }],
            [{ text: '🔙 Admin Menu', callback_data: 'admin:back' }],
        ],
    };
}
export function marathonScheduleKeyboard() {
    return {
        inline_keyboard: [
            [{ text: '🚀 Start Now', callback_data: 'marathon_schedule:now' }],
            [{ text: '⏰ In 1h', callback_data: 'marathon_schedule:3600' }],
            [{ text: '⏰ In 6h', callback_data: 'marathon_schedule:21600' }],
            [{ text: '⏰ In 24h', callback_data: 'marathon_schedule:86400' }],
            [{ text: '🔙 Admin Menu', callback_data: 'admin:back' }],
        ],
    };
}
export function activeGiveawaysKeyboard(giveaways, action) {
    const rows = giveaways.map(g => [{
            text: action === 'winners' ? `🏆 ${g.title}` : `📋 ${g.title}`,
            callback_data: action === 'winners' ? `giveaway_winners:${g.id}` : `giveaway_view:${g.id}`,
        }]);
    rows.push([{ text: '🔙 Giveaways', callback_data: 'admin:giveaways' }]);
    return { inline_keyboard: rows };
}
export function memberManagementKeyboard() {
    return {
        inline_keyboard: [
            [
                { text: '👥 View All', callback_data: 'member:view' },
                { text: '➕ Add', callback_data: 'member:add' },
            ],
            [
                { text: '⏸️ Pause', callback_data: 'member:pause' },
                { text: '▶️ Resume', callback_data: 'member:resume' },
            ],
            [
                { text: '🗑️ Remove', callback_data: 'member:remove' },
                { text: '✉️ Message', callback_data: 'member:message' },
            ],
            [{ text: '🔙 Admin Menu', callback_data: 'admin:back' }],
        ],
    };
}
export function composeTopicKeyboard() {
    return {
        inline_keyboard: [
            [{ text: '⭐ Reviews', callback_data: 'compose_topic:reviews' }],
            [{ text: '💪 Motivation', callback_data: 'compose_topic:motivation' }],
            [{ text: '💰 Trade Wins', callback_data: 'compose_topic:trade_win' }],
            [{ text: '🏖️ Life Wins', callback_data: 'compose_topic:life_win' }],
            [{ text: '🔙 Admin Menu', callback_data: 'admin:back' }],
        ],
    };
}
export function composeResultKeyboard() {
    return {
        inline_keyboard: [
            [
                { text: '✅ Approve & Send', callback_data: 'compose:approve' },
                { text: '🔄 Regenerate', callback_data: 'compose:regenerate' },
            ],
            [{ text: '✏️ Edit (new description)', callback_data: 'compose:edit' }],
            [{ text: '❌ Cancel', callback_data: 'admin:back' }],
        ],
    };
}
export function composeDeliveryKeyboard() {
    return {
        inline_keyboard: [
            [{ text: '🤖 Bot Users Only', callback_data: 'compose_delivery:bot' }],
            [{ text: '📢 Channel Only', callback_data: 'compose_delivery:channel' }],
            [{ text: '📱 Both Bot + Channel', callback_data: 'compose_delivery:both' }],
            [{ text: '🔙 Cancel', callback_data: 'admin:back' }],
        ],
    };
}
