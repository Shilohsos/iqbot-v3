/**
 * New onboarding state machine (Section 2 of DIRECTIVE-MASTER-UPDATE).
 * States are persisted in users.onboarding_state.
 */
import type { Context } from 'telegraf';
import {
    getTemplateByKey, setOnboardingState, touchOnboardingActivity,
    getRandomTemplate, type TemplateRecord,
    getOnboardingTracking, setLastFundingAt, incrementDemoTradeCount,
    getSequenceMedia, getConfig,
} from './db.js';
import { resolveUsername, applyPidgin } from './pidgin.js';

const AFFILIATE_LINK = process.env.AFFILIATE_LINK
    ?? 'https://iqbroker.com/lp/regframe-01-light-nosocials/?aff=749367&aff_model=revenue';

type Btn = { text: string; callback_data: string } | { text: string; url: string };

function makeKeyboard(rows: Btn[][]): { inline_keyboard: Btn[][] } {
    return { inline_keyboard: rows };
}

function firstName(ctx: Context): string {
    return ctx.from?.first_name ?? ctx.from?.username ?? 'there';
}

function renderMessage(template: TemplateRecord, name: string, pidgin: boolean): string {
    let msg = resolveUsername(template.message, name);
    if (pidgin) msg = applyPidgin(msg);
    return msg;
}

async function sendTemplate(
    ctx: Context,
    key: string,
    extraKeyboard?: { inline_keyboard: Btn[][] },
    overrideMessage?: string,
): Promise<void> {
    const t = getTemplateByKey(key);
    if (!t) return;
    const name = firstName(ctx);
    const user = (ctx as any).from as { id: number } | undefined;
    const pidgin = false; // caller determines — pass through context if needed

    const msg = overrideMessage ?? renderMessage(t, name, pidgin);
    const markup = extraKeyboard ?? (
        t.button_text && t.button_url
            ? makeKeyboard([[{ text: t.button_text, url: t.button_url }]])
            : undefined
    );

    let mediaFileId: string | undefined;
    let mediaType: string = 'photo';
    if (t.media_file_id) {
        mediaFileId = t.media_file_id;
    } else if (user?.id) {
        const seq = getSequenceMedia(key);
        if (seq) { mediaFileId = seq.file_id; mediaType = seq.media_type; }
    }

    if (mediaFileId && mediaType === 'video') {
        await ctx.replyWithVideo(mediaFileId, { caption: msg, ...(markup ? { reply_markup: markup } : {}) });
    } else if (mediaFileId) {
        await ctx.replyWithPhoto(mediaFileId, { caption: msg, ...(markup ? { reply_markup: markup } : {}) });
    } else {
        await ctx.reply(msg, { ...(markup ? { reply_markup: markup } : {}) });
    }
}

/** Step delay (non-blocking — just waits). */
function delay(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Triggered by /start for new users or users without an SSID. */
export async function startNewOnboarding(ctx: Context, telegramId: number): Promise<void> {
    if (getConfig('features_paused') === '1') return;
    setOnboardingState(telegramId, 'entry');
    const name = firstName(ctx);

    // Message 1 — includes media from sequence_media or template
    if (getTemplateByKey('entry_welcome_1')) {
        await sendTemplate(ctx, 'entry_welcome_1');
    }
    await delay(5_000);

    // Message 2 — includes media
    if (getTemplateByKey('entry_welcome_2')) {
        await sendTemplate(ctx, 'entry_welcome_2');
    }
    await delay(5_000);

    // Branch question — text only (buttons needed, no media)
    setOnboardingState(telegramId, 'entry_branch_sent');
    const t3 = getTemplateByKey('entry_branch_question');
    const branchMsg = t3 ? resolveUsername(t3.message, firstName(ctx)) : 'Are you new to trading?';
    await ctx.reply(branchMsg, {
        reply_markup: makeKeyboard([[
            { text: "I'm new to trading",    callback_data: 'onboard:new' },
            { text: 'I have traded before',  callback_data: 'onboard:experienced' },
        ]]),
    });
}

/** Handler for onboard:new */
export async function handleNewTrader(ctx: Context, telegramId: number): Promise<void> {
    setOnboardingState(telegramId, 'new_user_watch_video');
    await sendTemplate(ctx, 'new_trader_video', makeKeyboard([[
        { text: '✅ I\'ve watched it', callback_data: 'onboard:watched_video' },
    ]]));
}

/** Handler for onboard:watched_video */
export async function handleWatchedVideo(ctx: Context, telegramId: number): Promise<void> {
    setOnboardingState(telegramId, 'awaiting_user_id');
    const name = firstName(ctx);
    const t = getTemplateByKey('after_video_account');
    const msg = t ? resolveUsername(t.message, name) : `Let's get this money ${name}. 💜\n\nDrop your IQ Option User ID below 👇`;
    await ctx.reply(msg);
}

/** Handler for onboard:experienced */
export async function handleExperiencedTrader(ctx: Context, telegramId: number): Promise<void> {
    setOnboardingState(telegramId, 'returning_user_ask_account');
    await sendTemplate(ctx, 'experienced_branch', makeKeyboard([[
        { text: '✅ I have one',      callback_data: 'onboard:have_account' },
        { text: '🆕 Need a new one', callback_data: 'onboard:need_account' },
    ]]));
}

/** Handler for onboard:have_account */
export async function handleHaveAccount(ctx: Context, telegramId: number): Promise<void> {
    setOnboardingState(telegramId, 'awaiting_user_id');
    await sendTemplate(ctx, 'experienced_have_one');
}

/** Handler for onboard:need_account */
export async function handleNeedAccount(ctx: Context, telegramId: number): Promise<void> {
    setOnboardingState(telegramId, 'awaiting_user_id');
    await sendTemplate(ctx, 'experienced_need_new');
}

/** Called when user sends a 9-digit User ID. Returns true if flow advanced. */
export async function handleUserIdInput(
    ctx: Context,
    telegramId: number,
    iqUserId: number,
    onVerifySuccess: (iqUserId: number) => Promise<void>,
    failCount: number,
): Promise<void> {
    const name = firstName(ctx);

    await ctx.reply('⏳ Verifying your account...');

    // Verification is done by the caller (onVerifySuccess / fail path)
    // This function just sends the prompt messages
    void onVerifySuccess; void failCount;
    // Actual verify logic stays in bot.ts because it needs the SDK
}

/** Called after IQ Option User ID verified. Advances to email step. */
export async function handleUserIdVerified(ctx: Context, telegramId: number): Promise<void> {
    setOnboardingState(telegramId, 'awaiting_email');
    const t = getTemplateByKey('verify_success');
    const name = firstName(ctx);
    await ctx.reply(t ? resolveUsername(t.message, name) : '✅ Account verified! Now enter your IQ Option email:');
}

/** Called on User ID verify failure. */
export async function handleUserIdFailed(ctx: Context, telegramId: number, attempt: number): Promise<void> {
    const name = firstName(ctx);
    const key = attempt >= 2 ? 'verify_fail_2' : 'verify_fail_1';
    const t = getTemplateByKey(key);
    await ctx.reply(t ? resolveUsername(t.message, name) : '❌ Verification failed. Try again 👇');
}

/** After email collected. Advances to password step. */
export async function handleEmailCollected(ctx: Context, telegramId: number): Promise<void> {
    setOnboardingState(telegramId, 'awaiting_password');
    const t = getTemplateByKey('awaiting_password');
    await ctx.reply(t?.message ?? '🔑 Now enter your password:');
}

/** Called after successful login. Marks connected. */
export async function handleConnected(ctx: Context, telegramId: number): Promise<void> {
    setOnboardingState(telegramId, 'connected');
    const name = firstName(ctx);
    const t = getTemplateByKey('connected_success');
    const msg = t ? resolveUsername(t.message, name) : `✅ Connected ${name}! 💜\n\nYou're locked in. The bot is ready.`;
    await ctx.reply(msg, {
        reply_markup: makeKeyboard([[{ text: 'Take a trade 👾', callback_data: 'ui:trade' }]]),
    });
}

// ─── Funding sequence ─────────────────────────────────────────────────────────

const FUNDING_TEMPLATES = [
    'funding_win_screenshot', 'funding_lifestyle_video', 'funding_testimonial',
    'funding_payout_proof',  'funding_lifestyle_photo', 'funding_user_result',
];

const PROMO_CODES = ['10xfirst', '10xsecond'];

/** Call this after each demo trade completes. Sends funding message at 2, 5, 10 trades. */
export async function checkFundingSequence(
    telegramId: number,
    sendFn: (msg: string, button: { text: string; url: string }) => Promise<void>,
): Promise<void> {
    if (getConfig('features_paused') === '1') return;
    const count = incrementDemoTradeCount(telegramId);
    if (count !== 2 && count !== 5 && count !== 10 && count % 10 !== 0) return;

    const tracking = getOnboardingTracking(telegramId);
    if (tracking?.last_funding_at) {
        const hoursAgo = (Date.now() - new Date(tracking.last_funding_at).getTime()) / 3_600_000;
        if (hoursAgo < 6) return; // don't spam
    }

    const templateKey = FUNDING_TEMPLATES[Math.floor(Math.random() * FUNDING_TEMPLATES.length)];
    const template = getTemplateByKey(templateKey);
    if (!template) return;

    const promo = PROMO_CODES[count % 2];
    const msg = template.message.replace(/10xfirst|10xsecond/g, promo);
    setLastFundingAt(telegramId);
    await sendFn(msg, {
        text: template.button_text ?? '💎 Fund now',
        url:  template.button_url  ?? 'https://iqoption.com/pwa/payments/deposit',
    });
}

// ─── Re-engagement ────────────────────────────────────────────────────────────

const REENGAGE_MAP: Record<string, string> = {
    'entry_branch_sent':         'reengage_entry_stuck',
    'new_trader_video_sent':     'reengage_video_stuck',
    'awaiting_user_id':          'reengage_userid_stuck',
    'awaiting_email':            'reengage_email_stuck',
    'awaiting_password':         'reengage_password_stuck',
    'connected':                 'reengage_never_traded',
};

export function getReengageTemplateKey(state: string): string {
    return REENGAGE_MAP[state] ?? 'reengage_entry_stuck';
}
