import type { Context } from 'telegraf';
import {
    getTemplateByKey, setOnboardingState, touchOnboardingActivity,
    getSequenceMedia, type TemplateRecord,
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

export async function sendTemplate(
    ctx: Context,
    key: string,
    extraKeyboard?: { inline_keyboard: Btn[][] },
    overrideMessage?: string,
): Promise<void> {
    const t = getTemplateByKey(key);
    if (!t) return;
    const name = firstName(ctx);
    const msg = overrideMessage ?? resolveUsername(t.message, name);
    const markup = extraKeyboard ?? (
        t.button_text && t.button_url
            ? makeKeyboard([[{ text: t.button_text, url: t.button_url }]])
            : undefined
    );

    let mediaFileId: string | undefined;
    let mediaType = 'photo';
    if (t.media_file_id) {
        mediaFileId = t.media_file_id;
    } else {
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
    if (t) {
        await sendTemplate(ctx, key);
    } else {
        await ctx.reply(resolveUsername('❌ Verification failed. Try again 👇', name));
    }
}

/** After email collected. Advances to password step. */
export async function handleEmailCollected(ctx: Context, telegramId: number): Promise<void> {
    setOnboardingState(telegramId, 'awaiting_password');
    const t = getTemplateByKey('awaiting_password');
    const name = firstName(ctx);
    await ctx.reply(t ? resolveUsername(t.message, name) : '🔑 Now enter your password:');
}

/** Called after successful login. Marks connected. */
export async function handleConnected(ctx: Context, telegramId: number, balanceText?: string): Promise<void> {
    setOnboardingState(telegramId, 'connected');
    const name = firstName(ctx);
    let msg: string;
    if (balanceText) {
        msg = `✅ Connected ${name}! 💜\n\n${balanceText}\n\nYou're now locked in. The 10x Special Bot is live and ready.\n\n👇 Tap below to take your first trade.`;
    } else {
        const t = getTemplateByKey('connected_success');
        msg = t ? resolveUsername(t.message, name) : `✅ Connected ${name}! 💜\n\nYou're locked in. The bot is ready.`;
    }
    await ctx.reply(msg, {
        reply_markup: makeKeyboard([[{ text: 'Take a trade 👾', callback_data: 'ui:trade' }]]),
    });
}

