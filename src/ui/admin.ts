type Btn = { text: string; callback_data: string } | { text: string; url: string };
type IKMarkup = { inline_keyboard: Btn[][] };

interface GiveawayEventLike { id: number; status: string; event_type: string }

export function giveawayViewKeyboard(event: GiveawayEventLike): IKMarkup {
    const rows: Btn[][] = [];
    if (event.status === 'active') {
        rows.push([{ text: '🏆 Pick Winners',      callback_data: `giveaway_winners:${event.id}` }]);
        rows.push([{ text: '👥 View Participants', callback_data: `giveaway_participants:${event.id}` }]);
        rows.push([{ text: '⏹ End Giveaway',       callback_data: `giveaway_end:${event.id}` }]);
    }
    if (event.status === 'pending') {
        rows.push([{ text: '▶️ Activate Now', callback_data: `giveaway_activate:${event.id}` }]);
    }
    if (event.event_type === 'marathon') {
        rows.push([{ text: '📊 Leaderboard', callback_data: `marathon:leaderboard:${event.id}` }]);
    }
    rows.push([{ text: '❌ Delete',       callback_data: `giveaway_delete:${event.id}` }]);
    rows.push([{ text: '🔙 Giveaways',   callback_data: 'admin:giveaways' }]);
    return { inline_keyboard: rows };
}

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
                { text: '🎁 Giveaways',   callback_data: 'admin:giveaways' },
                { text: '🏆 Top Traders', callback_data: 'admin:top_traders' },
            ],
            [
                { text: '🔻 Funnel',      callback_data: 'admin:funnel' },
                { text: '📋 Audits',      callback_data: 'admin:audits' },
            ],
            [
                { text: '🛡️ Admin',      callback_data: 'admin:admin' },
                { text: '✍️ Compose Post', callback_data: 'admin:compose' },
            ],
            [{ text: '📔 Admin Diary',     callback_data: 'admin:diary' }],
            [{ text: '🟢 Go Live',         callback_data: 'admin:golive' }],
            [{ text: '🔙 Back', callback_data: 'ui:start' }],
        ],
    };
}

export function memberFilterKeyboard(): IKMarkup {
    return {
        inline_keyboard: [
            [
                { text: 'All',      callback_data: 'member:filter:all' },
                { text: 'DEMO',     callback_data: 'member:filter:DEMO' },
                { text: 'PRO',      callback_data: 'member:filter:PRO' },
                { text: 'MASTER',   callback_data: 'member:filter:MASTER' },
            ],
            [
                { text: '✅ Active',  callback_data: 'member:filter:active' },
                { text: '⏸ Inactive',callback_data: 'member:filter:inactive' },
                { text: '💎 Funded', callback_data: 'member:filter:funded' },
            ],
            [{ text: '🔙 Admin Menu', callback_data: 'admin:back' }],
        ],
    };
}

export function userDetailKeyboard(telegramId: number): IKMarkup {
    return {
        inline_keyboard: [
            [
                { text: '✅ Approve',    callback_data: `user_action:approve:${telegramId}` },
                { text: '⏸ Pause',      callback_data: `user_action:pause:${telegramId}` },
            ],
            [
                { text: '🔄 Reset SSID', callback_data: `user_action:reset_ssid:${telegramId}` },
                { text: '📊 Trades',     callback_data: `user_action:trades:${telegramId}` },
            ],
            [
                { text: '✉️ Message',    callback_data: `user_action:message:${telegramId}` },
            ],
            [{ text: '🔙 Back', callback_data: 'admin:admin' }],
        ],
    };
}

export function mediaLibraryKeyboard(keys: { template_key: string; media_type: string | null; description?: string }[]): IKMarkup {
    const rows = keys.map(k => [{
        text: `${k.media_type ? '✅' : '❌'} ${k.template_key}${k.description ? ` — ${k.description}` : ''}`,
        callback_data: `media:select:${k.template_key}`,
    }]);
    rows.push([{ text: '🔙 Admin Menu', callback_data: 'admin:back' }]);
    return { inline_keyboard: rows };
}

export function llmCategoryKeyboard(categories: { category: string; count: number }[]): IKMarkup {
    const rows: Btn[][] = [];
    for (let i = 0; i < categories.length; i += 2) {
        const row: Btn[] = [{ text: `${categories[i].category} (${categories[i].count})`, callback_data: `llm:cat:${categories[i].category}` }];
        if (categories[i + 1]) row.push({ text: `${categories[i + 1].category} (${categories[i + 1].count})`, callback_data: `llm:cat:${categories[i + 1].category}` });
        rows.push(row);
    }
    rows.push([{ text: '🔙 Admin Menu', callback_data: 'admin:back' }]);
    return { inline_keyboard: rows };
}

export function broadcastPreviewKeyboard(): IKMarkup {
    return {
        inline_keyboard: [
            [
                { text: '✅ Send',          callback_data: 'broadcast:preview_approve' },
                { text: '✏️ Edit Content',  callback_data: 'broadcast:preview_edit' },
            ],
            [{ text: '🔙 Cancel', callback_data: 'admin:back' }],
        ],
    };
}

export function adminBackKeyboard(): IKMarkup {
    return { inline_keyboard: [[{ text: '🔙 Admin Menu', callback_data: 'admin:back' }]] };
}

export function broadcastTargetKeyboard(): IKMarkup {
    return {
        inline_keyboard: [
            [{ text: '👥 All Users',                           callback_data: 'broadcast:all' }],
            [{ text: '💰 Funded',                              callback_data: 'broadcast:funded' }],
            [{ text: '💎 Non-Funded (connected, no deposit)',  callback_data: 'broadcast:nonfunded' }],
            [{ text: '❌ Non-Activated (no IQ / rejected)',    callback_data: 'broadcast:nonactivated' }],
            [{ text: '🧪 Test User Only',                      callback_data: 'broadcast:testuser' }],
            [{ text: '🔙 Admin Menu',                          callback_data: 'admin:back' }],
        ],
    };
}

export function broadcastSendOrScheduleKeyboard(): IKMarkup {
    return {
        inline_keyboard: [[
            { text: '📤 Send Now', callback_data: 'broadcast:send_now' },
            { text: '⏰ Schedule', callback_data: 'broadcast:schedule' },
        ]],
    };
}

export function broadcastDelayKeyboard(): IKMarkup {
    return {
        inline_keyboard: [[
            { text: '15m',       callback_data: 'bcast_delay:900000' },
            { text: '30m',       callback_data: 'bcast_delay:1800000' },
            { text: '1h',        callback_data: 'bcast_delay:3600000' },
            { text: '2h',        callback_data: 'bcast_delay:7200000' },
            { text: '✏️ Custom', callback_data: 'broadcast:custom_schedule' },
        ]],
    };
}

export function scheduledBroadcastsKeyboard(schedules: { id: number; label: string }[]): IKMarkup {
    const rows: Btn[][] = schedules.map(s => [
        { text: `❌ Cancel: ${s.label}`, callback_data: `bcast_cancel:${s.id}` },
    ]);
    rows.push([{ text: '🔙 Admin Menu', callback_data: 'admin:back' }]);
    return { inline_keyboard: rows };
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
            [{ text: '🚀 Start Bot',    callback_data: 'broadcast_action:start' }],
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
            [{ text: '🧪 DEMO Tier',   callback_data: 'token_tier:DEMO' }],
            [{ text: '⚡ PRO Tier',    callback_data: 'token_tier:PRO' }],
            [{ text: '👑 MASTER Tier', callback_data: 'token_tier:MASTER' }],
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

export function topTradersAdminKeyboard(editableEntries: Array<{ telegram_id: number; masked: string }> = []): IKMarkup {
    const rows: Btn[][] = editableEntries.map(e => [
        { text: `✏️ Edit ${e.masked}`, callback_data: `trader_edit:${e.telegram_id}` },
    ]);
    rows.push([{ text: '➕ Manual Add', callback_data: 'admin:manual_add' }]);
    rows.push([{ text: '🔙 Admin Menu', callback_data: 'admin:back' }]);
    return { inline_keyboard: rows };
}

export function activationsKeyboard(
    pendingUsers: Array<{ telegram_id: number; username?: string | null }>
): IKMarkup {
    const rows: Btn[][] = [];
    for (const u of pendingUsers) {
        const label = u.username ?? `ID: ${String(u.telegram_id).slice(-4)}`;
        rows.push([
            { text: `✅ Approve ${label}`, callback_data: `activation:approve:${u.telegram_id}` },
            { text: `❌ Reject ${label}`,  callback_data: `activation:reject:${u.telegram_id}` },
        ]);
    }
    rows.push([{ text: '🔙 Admin Menu', callback_data: 'admin:back' }]);
    return { inline_keyboard: rows };
}

export function funnelKeyboard(): IKMarkup {
    return {
        inline_keyboard: [
            [{ text: '🌐 Set Landing Page URL', callback_data: 'admin:set_funnel_url' }],
            [{ text: '🔙 Admin Menu',           callback_data: 'admin:back' }],
        ],
    };
}

export function giveawayTargetKeyboard(): IKMarkup {
    return {
        inline_keyboard: [
            [{ text: '👥 All Approved Users',          callback_data: 'giveaway:all' }],
            [{ text: '🔥 Active Traders (last 24h)',   callback_data: 'giveaway:24h' }],
            [{ text: '🔙 Admin Menu',                  callback_data: 'admin:back' }],
        ],
    };
}

export function giveawayManagerKeyboard(stats: { active: number; scheduled: number; completed: number }): IKMarkup {
    return {
        inline_keyboard: [
            [{ text: '➕ New Giveaway',   callback_data: 'giveaway_v2:create' }],
            [{ text: '📋 View Active',    callback_data: 'giveaway_v2:active' }],
            [{ text: '📅 Scheduled',      callback_data: 'giveaway_v2:scheduled' }],
            [{ text: '✅ Pick Winners',   callback_data: 'giveaway_v2:pick_winners' }],
            [{ text: '🔙 Admin Menu',     callback_data: 'admin:back' }],
        ],
    };
}

export function giveawayTypeKeyboard(): IKMarkup {
    return {
        inline_keyboard: [
            [{ text: '🎁 Giveaway',    callback_data: 'giveaway_type:giveaway' }],
            [{ text: '🏷️ Promo Code', callback_data: 'giveaway_type:promo_code' }],
            [{ text: '🏃 Marathon',    callback_data: 'giveaway_type:marathon' }],
            [{ text: '🔙 Admin Menu',  callback_data: 'admin:back' }],
        ],
    };
}

export function giveawayCriteriaKeyboard(): IKMarkup {
    return {
        inline_keyboard: [
            [{ text: '🚫 No Criteria',    callback_data: 'giveaway_criteria:none' }],
            [{ text: '🆕 New User',       callback_data: 'giveaway_criteria:new_user' }],
            [{ text: '💰 Min Balance',    callback_data: 'giveaway_criteria:min_balance' }],
            [{ text: '🏆 Top Traders',    callback_data: 'giveaway_criteria:top_traders' }],
            [{ text: '🔙 Admin Menu',     callback_data: 'admin:back' }],
        ],
    };
}

export function giveawayScheduleKeyboard(): IKMarkup {
    return {
        inline_keyboard: [
            [{ text: '🚀 Send Now',       callback_data: 'giveaway_schedule:now' }],
            [{ text: '⏰ In 1h',          callback_data: 'giveaway_schedule:3600' }],
            [{ text: '⏰ In 6h',          callback_data: 'giveaway_schedule:21600' }],
            [{ text: '⏰ In 24h',         callback_data: 'giveaway_schedule:86400' }],
            [{ text: '🔙 Admin Menu',     callback_data: 'admin:back' }],
        ],
    };
}

export function promoScheduleKeyboard(): IKMarkup {
    return {
        inline_keyboard: [
            [{ text: '🚀 Send Now',   callback_data: 'promo_schedule:now' }],
            [{ text: '⏰ In 1h',      callback_data: 'promo_schedule:3600' }],
            [{ text: '⏰ In 6h',      callback_data: 'promo_schedule:21600' }],
            [{ text: '⏰ In 24h',     callback_data: 'promo_schedule:86400' }],
            [{ text: '🔙 Admin Menu', callback_data: 'admin:back' }],
        ],
    };
}

export function marathonDurationKeyboard(): IKMarkup {
    return {
        inline_keyboard: [
            [{ text: '24 hours',      callback_data: 'marathon_duration:86400' }],
            [{ text: '3 days',        callback_data: 'marathon_duration:259200' }],
            [{ text: '7 days',        callback_data: 'marathon_duration:604800' }],
            [{ text: '14 days',       callback_data: 'marathon_duration:1209600' }],
            [{ text: '🔙 Admin Menu', callback_data: 'admin:back' }],
        ],
    };
}

export function marathonScheduleKeyboard(): IKMarkup {
    return {
        inline_keyboard: [
            [{ text: '🚀 Start Now',  callback_data: 'marathon_schedule:now' }],
            [{ text: '⏰ In 1h',      callback_data: 'marathon_schedule:3600' }],
            [{ text: '⏰ In 6h',      callback_data: 'marathon_schedule:21600' }],
            [{ text: '⏰ In 24h',     callback_data: 'marathon_schedule:86400' }],
            [{ text: '🔙 Admin Menu', callback_data: 'admin:back' }],
        ],
    };
}

export function activeGiveawaysKeyboard(giveaways: Array<{ id: number; title: string }>, action: 'view' | 'winners'): IKMarkup {
    const rows: Btn[][] = giveaways.map(g => [{
        text: action === 'winners' ? `🏆 ${g.title}` : `📋 ${g.title}`,
        callback_data: action === 'winners' ? `giveaway_winners:${g.id}` : `giveaway_view:${g.id}`,
    }]);
    rows.push([{ text: '🔙 Giveaways', callback_data: 'admin:giveaways' }]);
    return { inline_keyboard: rows };
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

export function composeTopicKeyboard(): IKMarkup {
    return {
        inline_keyboard: [
            [{ text: '⭐ Reviews',        callback_data: 'compose_topic:reviews' }],
            [{ text: '💪 Motivation',     callback_data: 'compose_topic:motivation' }],
            [{ text: '💰 Trade Wins',     callback_data: 'compose_topic:trade_win' }],
            [{ text: '🏖️ Life Wins',     callback_data: 'compose_topic:life_win' }],
            [{ text: '📝 Manual Text',    callback_data: 'compose:manual' }],
            [{ text: '🎭 Tone Settings',  callback_data: 'admin:compose_tone' }],
            [{ text: '🔙 Admin Menu',     callback_data: 'admin:back' }],
        ],
    };
}

export function composeToneKeyboard(): IKMarkup {
    return {
        inline_keyboard: [
            [{ text: '📝 Edit Style Guide', callback_data: 'compose_tone:guide' }],
            [{ text: '📄 Sample Post 1',    callback_data: 'compose_tone:sample1' }],
            [{ text: '📄 Sample Post 2',    callback_data: 'compose_tone:sample2' }],
            [{ text: '📄 Sample Post 3',    callback_data: 'compose_tone:sample3' }],
            [{ text: '👁️ View Current Tone', callback_data: 'compose_tone:view' }],
            [{ text: '🔙 Compose Post',     callback_data: 'admin:compose' }],
        ],
    };
}

export function composeResultKeyboard(): IKMarkup {
    return {
        inline_keyboard: [
            [
                { text: '✅ Approve & Send', callback_data: 'compose:approve' },
                { text: '🔄 Regenerate',     callback_data: 'compose:regenerate' },
            ],
            [{ text: '✏️ Edit (new description)', callback_data: 'compose:edit' }],
            [{ text: '❌ Cancel',                  callback_data: 'admin:back' }],
        ],
    };
}

export function composeButtonKeyboard(): IKMarkup {
    return {
        inline_keyboard: [
            [{ text: '🚀 Start Bot',      callback_data: 'compose_btn:start' }],
            [{ text: '🎯 Trade Now',       callback_data: 'compose_btn:trade' }],
            [{ text: '💰 Fund Account',    callback_data: 'compose_btn:fund' }],
            [{ text: '📞 Contact Admin',  callback_data: 'compose_btn:contact' }],
            [{ text: '❌ No Button',       callback_data: 'compose_btn:none' }],
        ],
    };
}

export function composeDeliveryKeyboard(): IKMarkup {
    return {
        inline_keyboard: [
            [{ text: '🤖 Bot Users Only',     callback_data: 'compose_delivery:bot' }],
            [{ text: '📢 Channel Only',        callback_data: 'compose_delivery:channel' }],
            [{ text: '📱 Both Bot + Channel',  callback_data: 'compose_delivery:both' }],
            [{ text: '🔙 Cancel',              callback_data: 'admin:back' }],
        ],
    };
}
