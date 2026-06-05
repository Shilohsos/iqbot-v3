import { getTierConfig } from './tiers.js';

export const OTC_PAIRS = [
    'EURUSD-OTC', 'GBPUSD-OTC', 'EURJPY-OTC', 'GBPJPY-OTC',
    'AUDUSD-OTC', 'USDCAD-OTC', 'EURGBP-OTC', 'USDCHF-OTC',
];

type Btn = { text: string; callback_data: string } | { text: string; url: string };
type IKMarkup = { inline_keyboard: Btn[][] };

export function amountKeyboard(): IKMarkup {
    return {
        inline_keyboard: [
            [
                { text: '$10',  callback_data: 'amt:10' },
                { text: '$25',  callback_data: 'amt:25' },
                { text: '$50',  callback_data: 'amt:50' },
                { text: '$100', callback_data: 'amt:100' },
            ],
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

export function timeframeKeyboard(tier?: string): IKMarkup {
    const allowed = getTierConfig(tier).allowedTimeframes;
    const labels: Record<number, string> = { 30: '30s', 60: '1m', 300: '5m' };
    const row: Btn[] = ALL_TIMEFRAMES.map(s => {
        const label = labels[s] ?? `${s}s`;
        return allowed.includes(s)
            ? { text: label, callback_data: `tf:${s}` }
            : { text: `🔒 ${label}`, callback_data: `upgrade:tf:${s}` };
    });
    return {
        inline_keyboard: [
            row,
            [{ text: '❌ Cancel', callback_data: 'wizard:cancel' }],
        ],
    };
}

export function pairKeyboard(page = 0, tier?: string): IKMarkup {
    const allowed = new Set(getTierConfig(tier).pairs);
    const PAGE_SIZE = 6;
    const start = page * PAGE_SIZE;
    const pagePairs = ALL_PAIRS.slice(start, start + PAGE_SIZE);
    const rows: Btn[][] = [];

    for (let i = 0; i < pagePairs.length; i += 2) {
        const row: Btn[] = [
            allowed.has(pagePairs[i])
                ? { text: pagePairs[i], callback_data: `pair:${pagePairs[i]}` }
                : { text: `🔒 ${pagePairs[i]}`, callback_data: `upgrade:pair:${pagePairs[i]}` },
        ];
        if (pagePairs[i + 1]) {
            row.push(
                allowed.has(pagePairs[i + 1])
                    ? { text: pagePairs[i + 1], callback_data: `pair:${pagePairs[i + 1]}` }
                    : { text: `🔒 ${pagePairs[i + 1]}`, callback_data: `upgrade:pair:${pagePairs[i + 1]}` }
            );
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
