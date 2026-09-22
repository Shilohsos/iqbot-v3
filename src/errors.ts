export const FriendlyErrors: Record<string, string> = {
    'Unknown pair':          '⚠️ Couldn\'t read market data for this pair. Try another one.',
    'SDK timeout':           '··· IQ Option is taking longer than usual. This happens during high traffic.',
    'TIMEOUT:':              '✦ Lost connection to IQ Option. Your account is safe — try again.',
    'timed out':             '✦ Lost connection to IQ Option. Your account is safe — try again.',
    'Connection timed out':  '✦ Lost connection to IQ Option. Your account is safe — try again.',
    'ConnectTimeoutError':   '✦ IQ Option is unreachable right now. Your account is safe — try again in a moment.',
    'ConnectTimeout':        '✦ IQ Option is unreachable right now. Your account is safe — try again in a moment.',
    'fetch failed':          '✦ IQ Option is unreachable right now. Your account is safe — try again in a moment.',
    'Not connected':         '✦ Your IQ Option account isn\'t linked yet. Tap to connect.',
    'WebSocket':             '✦ Lost connection to IQ Option. Your account is safe — try again.',
    'is closing':            '✦ Lost connection to IQ Option. Your account is safe — try again.',
    'not open':              '✦ Lost connection to IQ Option. Your account is safe — try again.',
    'not available': '✦ This market isn\'t available right now. Try another pair or timeframe.',
    '4117': '⚠️ Payout rate changed — try again in a moment.',
    'profit rate': '⚠️ Payout rate changed — try again in a moment.',
    'Payout rate changed': '⚠️ Payout rate changed — try again in a moment.',
    'Insufficient funds': '⚠️ Not enough funds to place this trade — top up your balance and try again.',
    'smaller than the allowed minimum': '⚠️ This amount is below the IQ Option minimum for this asset — raise your stake.',
    'higher than allowed': '⚠️ This amount is above the IQ Option maximum for this asset — lower your stake.',
    'request is failed': '⚠️ IQ Option rejected the request. Wait a moment and try again.',
    'is not found':          '⚠️ Couldn\'t read market data for this pair. Try another one.',
    'Session expired':       '· This session timed out. Let\'s start fresh.',
    'authenticat':           '✦ Your session expired. Reconnect to continue trading.',
    'Insufficient balance':  '⚠️ Not enough funds. Deposit as little as $10 to trade.',
    'No demo balance':       '✦ No practice balance found. Create a demo account on IQ Option first.',
    'No real balance':       '✦ No live balance found. Fund your account to start earning.',
    'market is closed':      '✦ This market is closed right now. It opens shortly — try again in a moment.',
    'Not enough data':       '· Not enough market data yet. Wait a moment and try again.',
};

export function friendlyError(err: unknown, fallback?: string): string {
    const msg = err instanceof Error ? err.message : String(err);
    // IQ Option rejections arrive as: "request is failed with status 4100 and message: ..."
    // Parse the numeric status so the REAL reason is never hidden behind a generic message.
    const statusCode = (msg.match(/status\s*(\d{4})/) ?? [])[1];
    if (statusCode) {
        switch (statusCode) {
            case '4100': return '⚠️ Not enough funds to place this trade — top up your balance and try again.';
            case '4112': return '⚠️ This amount is below the IQ Option minimum for this asset — raise your stake.';
            case '4113': return '⚠️ This amount is above the IQ Option maximum for this asset — lower your stake.';
            case '4117': return '⚠️ Payout rate changed — try again in a moment.';
        }
    }
    for (const [key, friendly] of Object.entries(FriendlyErrors)) {
        if (msg.includes(key)) return friendly;
    }
    return fallback ?? '⚠️ Something went wrong. Please try again.';
}
