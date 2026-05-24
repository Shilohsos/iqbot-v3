export async function withRetry(fn, options) {
    const maxAttempts = options.maxAttempts ?? 2;
    const delayMs = options.delayMs ?? 5000;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        }
        catch (err) {
            if (attempt === maxAttempts)
                throw err;
            options.onRetry?.(attempt, err);
            await new Promise(r => setTimeout(r, delayMs));
        }
    }
    throw new Error('Unreachable');
}
