export declare function withRetry<T>(fn: () => Promise<T>, options: {
    maxAttempts?: number;
    delayMs?: number;
    onRetry?: (attempt: number, err: unknown) => void;
}): Promise<T>;
