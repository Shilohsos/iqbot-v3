import { getTemplateByKey, setOnboardingState, getSequenceMedia, } from './db.js';
import { resolveUsername } from './pidgin.js';
const AFFILIATE_LINK = process.env.AFFILIATE_LINK
    ?? 'https://iqbroker.com/lp/regframe-01-light-nosocials/?aff=749367&aff_model=revenue';
function makeKeyboard(rows) {
    return { inline_keyboard: rows };
}
function firstName(ctx) {
    return ctx.from?.first_name ?? ctx.from?.username ?? 'there';
}
export async function sendTemplate(ctx, key, extraKeyboard, overrideMessage) {
    const t = getTemplateByKey(key);
    if (!t)
        return;
    const name = firstName(ctx);
    const msg = overrideMessage ?? resolveUsername(t.message, name);
    const markup = extraKeyboard ?? (t.button_text && t.button_url
        ? makeKeyboard([[{ text: t.button_text, url: t.button_url }]])
        : undefined);
    let mediaFileId;
    let mediaType = 'photo';
    if (t.media_file_id) {
        mediaFileId = t.media_file_id;
    }
    else {
        const seq = getSequenceMedia(key);
        if (seq) {
            mediaFileId = seq.file_id;
            mediaType = seq.media_type;
        }
    }
    if (mediaFileId && mediaType === 'video') {
        await ctx.replyWithVideo(mediaFileId, { caption: msg, ...(markup ? { reply_markup: markup } : {}) });
    }
    else if (mediaFileId) {
        await ctx.replyWithPhoto(mediaFileId, { caption: msg, ...(markup ? { reply_markup: markup } : {}) });
    }
    else {
        await ctx.reply(msg, { ...(markup ? { reply_markup: markup } : {}) });
    }
}
/** Called after IQ Option User ID verified. Advances to email step. */
export async function handleUserIdVerified(ctx, telegramId) {
    setOnboardingState(telegramId, 'awaiting_email');
    const t = getTemplateByKey('verify_success');
    const name = firstName(ctx);
    await ctx.reply(t ? resolveUsername(t.message, name) : '✅ Account verified! Now enter your IQ Option email:');
}
/** Called on User ID verify failure. */
export async function handleUserIdFailed(ctx, telegramId, attempt) {
    const name = firstName(ctx);
    const key = attempt >= 2 ? 'verify_fail_2' : 'verify_fail_1';
    const t = getTemplateByKey(key);
    if (t) {
        await sendTemplate(ctx, key);
    }
    else {
        await ctx.reply(resolveUsername(' Verification failed. Try again ─ ', name));
    }
}
/** After email collected. Advances to password step. */
export async function handleEmailCollected(ctx, telegramId) {
    setOnboardingState(telegramId, 'awaiting_password');
    const t = getTemplateByKey('awaiting_password');
    const name = firstName(ctx);
    await ctx.reply(t ? resolveUsername(t.message, name) : ' Now enter your password:');
}
/** Called after successful login. Marks connected. */
export async function handleConnected(ctx, telegramId, balanceText) {
    setOnboardingState(telegramId, 'connected');
    const name = firstName(ctx);
    let msg;
    if (balanceText) {
        msg = `✅ Connected ${name}! \n\n${balanceText}\n\nYou're now locked in. The 10x AI is live and ready.\n\n· How to use 10x AI:\nhttps://youtu.be/5h6RyYflM6U?si=at7JABo9gfL9VfFS\n\n· How to fund & withdraw:\nhttps://youtu.be/0GAD3MeiZsA?si=q486KAxkvryf7u9z\n\n─  Tap below to take your first trade.`;
    }
    else {
        const t = getTemplateByKey('connected_success');
        msg = t ? resolveUsername(t.message, name) : `✅ Connected ${name}! \n\nYou're locked in. The bot is ready.`;
    }
    await ctx.reply(msg, {
        reply_markup: makeKeyboard([[{ text: 'Take a trade ', callback_data: 'ui:trade' }]]),
    });
    await ctx.reply(`Here are your commands:\n\n` +
        `/start — Open main menu\n` +
        `/help — Help & FAQ\n` +
        `/refresh — Reset everything and start over\n` +
        `/connect — Reconnect your IQ Option account\n\n` +
        `Tap the menu button below to begin ─ `, { reply_markup: makeKeyboard([[{ text: ' Menu', callback_data: 'ui:start' }]]) });
}
