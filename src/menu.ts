export const OTC_PAIRS = [
    'EURUSD-OTC', 'GBPUSD-OTC', 'EURJPY-OTC', 'GBPJPY-OTC',
    'AUDUSD-OTC', 'USDCAD-OTC', 'EURGBP-OTC', 'USDCHF-OTC',
];

type Btn = { text: string; callback_data: string } | { text: string; url: string };
type IKMarkup = { inline_keyboard: Btn[][] };

const CURRENCY_SYMBOLS: Record<string, string> = {
    USD: '$', NGN: '₦', EUR: '€', GBP: '£', JPY: '¥', AUD: 'A$', CAD: 'C$',
};

export function amountKeyboard(currency = 'USD'): IKMarkup {
    const sym = CURRENCY_SYMBOLS[currency] || currency;
    return {
        inline_keyboard: [
            [
                { text: `${sym}10`,  callback_data: 'amt:10' },
                { text: `${sym}25`,  callback_data: 'amt:25' },
                { text: `${sym}50`,  callback_data: 'amt:50' },
                { text: `${sym}100`, callback_data: 'amt:100' },
            ],
            [
                { text: '✏️ Custom', callback_data: 'amt:custom' },
                { text: '❌ Cancel', callback_data: 'wizard:cancel' },
            ],
        ],
    };
}

export function timeframeKeyboard(): IKMarkup {
    return {
        inline_keyboard: [
            [
                { text: '30s', callback_data: 'tf:30' },
                { text: '1m',  callback_data: 'tf:60' },
                { text: '5m',  callback_data: 'tf:300' },
            ],
            [{ text: '❌ Cancel', callback_data: 'wizard:cancel' }],
        ],
    };
}

const NEWBIE_PAIRS = ['EURUSD-OTC', 'GBPUSD-OTC', 'AUDUSD-OTC'];

export function pairKeyboard(page = 0, tier?: string): IKMarkup {
    const available = (tier ?? '').toUpperCase() === 'PRO' ? OTC_PAIRS : NEWBIE_PAIRS;
    const PAGE_SIZE = 6;
    const start = page * PAGE_SIZE;
    const pagePairs = available.slice(start, start + PAGE_SIZE);
    const rows: Btn[][] = [];

    for (let i = 0; i < pagePairs.length; i += 2) {
        const row: Btn[] = [{ text: pagePairs[i], callback_data: `pair:${pagePairs[i]}` }];
        if (pagePairs[i + 1]) row.push({ text: pagePairs[i + 1], callback_data: `pair:${pagePairs[i + 1]}` });
        rows.push(row);
    }

    const navRow: Btn[] = [];
    if (start > 0) navRow.push({ text: '⬅️ Back', callback_data: `page:${page - 1}` });
    if (start + PAGE_SIZE < available.length) navRow.push({ text: 'More ➡️', callback_data: `page:${page + 1}` });
    if (navRow.length) rows.push(navRow);

    rows.push([{ text: '❌ Cancel', callback_data: 'wizard:cancel' }]);
    return { inline_keyboard: rows };
}

export function tfLabel(timeframeSec: number): string {
    if (timeframeSec === 30) return '30s';
    if (timeframeSec === 60) return '1m';
    if (timeframeSec === 300) return '5m';
    return '15m';
}

export function tierKeyboard(): IKMarkup {
    return {
        inline_keyboard: [
            [{ text: '🧪 DEMO — try the bot risk-free', callback_data: 'tier:demo' }],
            [{ text: '🚀 Newbie — trade with $20+ capital', callback_data: 'tier:newbie' }],
            [{ text: '⚡ PRO — trade with $100+ capital', callback_data: 'tier:pro' }],
        ],
    };
}

export function hasAccountKeyboard(): IKMarkup {
    return {
        inline_keyboard: [
            [{ text: '✅ I have an IQ Option account', callback_data: 'onboard:yes' }],
            [{ text: '🆕 Create one free (takes 2 min)', callback_data: 'onboard:no' }],
        ],
    };
}

export function tradeModeKeyboard(): IKMarkup {
    return {
        inline_keyboard: [
            [
                { text: 'Trade Live', callback_data: 'mode:live' },
                { text: 'Trade Demo', callback_data: 'mode:demo' },
            ],
        ],
    };
}

export function affiliateFailKeyboard(): IKMarkup {
    const affiliateLink = process.env.AFFILIATE_LINK ?? 'https://iqbroker.com/lp/regframe-01-light-nosocials/?aff=749367&aff_model=revenue';
    const adminLink = process.env.ADMIN_CONTACT_LINK ?? 'https://t.me/shiloh_is_10xing';
    return {
        inline_keyboard: [
            [{ text: '🆕 Create free account (takes 2 min)', url: affiliateLink }],
            [{ text: '👾 Contact admin', url: adminLink }],
        ],
    };
}

export function demoUpsellKeyboard(): IKMarkup {
    return {
        inline_keyboard: [
            [{ text: 'Switch to live 🔋 earn real money', callback_data: 'upsell:live' }],
            [{ text: 'Continue demo 🪫 keep testing', callback_data: 'upsell:demo' }],
        ],
    };
}
