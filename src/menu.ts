export const OTC_PAIRS = [
    'EURUSD-OTC', 'GBPUSD-OTC', 'EURJPY-OTC', 'GBPJPY-OTC',
    'AUDUSD-OTC', 'USDCAD-OTC', 'EURGBP-OTC', 'USDCHF-OTC',
];

type Btn = { text: string; callback_data: string } | { text: string; url: string };
type IKMarkup = { inline_keyboard: Btn[][] };

const CURRENCY_SYMS: Record<string, string> = { NGN: '₦', EUR: '€', GBP: '£', USD: '$' };

export function currencyKeyboard(): IKMarkup {
    return {
        inline_keyboard: [
            [
                { text: '₦ NGN', callback_data: 'cur:NGN' },
                { text: '$ USD', callback_data: 'cur:USD' },
            ],
            [
                { text: '€ EUR', callback_data: 'cur:EUR' },
                { text: '£ GBP', callback_data: 'cur:GBP' },
            ],
            [{ text: '❌ Cancel', callback_data: 'wizard:cancel' }],
        ],
    };
}

export function amountKeyboard(currency = 'USD'): IKMarkup {
    let row: Btn[];
    if (currency === 'NGN') {
        row = [
            { text: '₦500',  callback_data: 'amt:500' },
            { text: '₦1,000', callback_data: 'amt:1000' },
            { text: '₦2,000', callback_data: 'amt:2000' },
            { text: '₦5,000', callback_data: 'amt:5000' },
        ];
    } else {
        const sym = CURRENCY_SYMS[currency] ?? '$';
        row = [10, 25, 50, 100].map(v => ({ text: `${sym}${v}`, callback_data: `amt:${v}` }));
    }
    return {
        inline_keyboard: [
            row,
            [
                { text: '✏️ Custom', callback_data: 'amt:custom' },
                { text: '❌ Cancel', callback_data: 'wizard:cancel' },
            ],
        ],
    };
}

const ALL_TIMEFRAMES = [30, 60, 300];
const ALL_PAIRS = [
    'EURUSD-OTC', 'GBPUSD-OTC', 'EURJPY-OTC', 'GBPJPY-OTC',
    'AUDUSD-OTC', 'USDCAD-OTC', 'EURGBP-OTC', 'USDCHF-OTC',
];

// `tier` params are retained for call-site compatibility but no longer gate
// anything — all timeframes and pairs are available to every product now.
export function timeframeKeyboard(_tier?: string): IKMarkup {
    const labels: Record<number, string> = { 30: '30s', 60: '1m', 300: '5m' };
    const row: Btn[] = ALL_TIMEFRAMES.map(s => ({ text: labels[s] ?? `${s}s`, callback_data: `tf:${s}` }));
    return {
        inline_keyboard: [
            row,
            [{ text: '❌ Cancel', callback_data: 'wizard:cancel' }],
        ],
    };
}

export function pairKeyboard(page = 0, _tier?: string): IKMarkup {
    const PAGE_SIZE = 6;
    const start = page * PAGE_SIZE;
    const pagePairs = ALL_PAIRS.slice(start, start + PAGE_SIZE);
    const rows: Btn[][] = [];

    for (let i = 0; i < pagePairs.length; i += 2) {
        const row: Btn[] = [{ text: pagePairs[i], callback_data: `pair:${pagePairs[i]}` }];
        if (pagePairs[i + 1]) {
            row.push({ text: pagePairs[i + 1], callback_data: `pair:${pagePairs[i + 1]}` });
        }
        rows.push(row);
    }

    const navRow: Btn[] = [];
    if (start > 0) navRow.push({ text: '⬅️ Back', callback_data: `page:${page - 1}` });
    if (start + PAGE_SIZE < ALL_PAIRS.length) navRow.push({ text: 'More ➡️', callback_data: `page:${page + 1}` });
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
