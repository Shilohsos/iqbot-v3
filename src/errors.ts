export const FriendlyErrors: Record<string, string> = {
    'Unknown pair':          '⚠️ Couldn\'t read market data for this pair. Try another one.',
    'SDK timeout':           '⏱ IQ Option is taking longer than usual. This happens during high traffic.',
    'Connection timed out':  '🔌 Lost connection to IQ Option. Your account is safe — try again.',
    'ConnectTimeoutError':   '🔌 IQ Option is unreachable right now. Your account is safe — try again in a moment.',
    'ConnectTimeout':        '🔌 IQ Option is unreachable right now. Your account is safe — try again in a moment.',
    'fetch failed':          '🔌 IQ Option is unreachable right now. Your account is safe — try again in a moment.',
    'Not connected':         '🔗 Your IQ Option account isn\'t linked yet. Tap to connect.',
    'Session expired':       '⏰ This session timed out. Let\'s start fresh.',
    'Insufficient balance':  '🚫 Not enough funds. Deposit as little as $10 to trade.',
    'No demo balance':       '🧪 No practice balance found. Create a demo account on IQ Option first.',
    'No real balance':       '💳 No live balance found. Fund your account to start earning.',
    'market is closed':      '🔒 This market is closed right now. It opens shortly — try again in a moment.',
    'Not enough data':       '📉 Not enough market data yet. Wait a moment and try again.',
};

export function friendlyError(err: unknown, fallback?: string): string {
    const msg = err instanceof Error ? err.message : String(err);
    for (const [key, friendly] of Object.entries(FriendlyErrors)) {
        if (msg.includes(key)) return friendly;
    }
    return fallback ?? '⚠️ Something went wrong. Please try again.';
}
