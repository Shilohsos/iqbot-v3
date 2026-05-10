export const OTC_PAIRS = [
    'EURUSD-OTC', 'GBPUSD-OTC', 'EURJPY-OTC', 'GBPJPY-OTC',
    'USDJPY-OTC', 'AUDUSD-OTC', 'USDCAD-OTC', 'EURGBP-OTC',
];

type Btn = { text: string; callback_data: string };
type IKMarkup = { inline_keyboard: Btn[][] };

export function amountKeyboard(): IKMarkup {
    return {
        inline_keyboard: [
            [
                { text: '$10', callback_data: 'amt:10' },
                { text: '$25', callback_data: 'amt:25' },
                { text: '$50', callback_data: 'amt:50' },
                { text: '$100', callback_data: 'amt:100' },
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
                { text: '1m', callback_data: 'tf:60' },
                { text: '5m', callback_data: 'tf:300' },
                { text: '15m', callback_data: 'tf:900' },
            ],
            [{ text: '❌ Cancel', callback_data: 'wizard:cancel' }],
        ],
    };
}

export function pairKeyboard(page = 0): IKMarkup {
    const PAGE_SIZE = 6;
    const start = page * PAGE_SIZE;
    const pagePairs = OTC_PAIRS.slice(start, start + PAGE_SIZE);
    const rows: Btn[][] = [];

    for (let i = 0; i < pagePairs.length; i += 2) {
        const row: Btn[] = [{ text: pagePairs[i], callback_data: `pair:${pagePairs[i]}` }];
        if (pagePairs[i + 1]) row.push({ text: pagePairs[i + 1], callback_data: `pair:${pagePairs[i + 1]}` });
        rows.push(row);
    }

    const navRow: Btn[] = [];
    if (start > 0) navRow.push({ text: '⬅️ Back', callback_data: `page:${page - 1}` });
    if (start + PAGE_SIZE < OTC_PAIRS.length) navRow.push({ text: 'More ➡️', callback_data: `page:${page + 1}` });
    if (navRow.length) rows.push(navRow);

    rows.push([{ text: '❌ Cancel', callback_data: 'wizard:cancel' }]);
    return { inline_keyboard: rows };
}

export function tfLabel(timeframeSec: number): string {
    if (timeframeSec === 60) return '1m';
    if (timeframeSec === 300) return '5m';
    return '15m';
}
