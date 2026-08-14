/** Current proxy URL — reflects in-process rotations without a restart. */
export declare function getProxyUrl(): string | undefined;
/**
 * Rotate to the next proxy in the pool. Updates .env + .proxy-state.json for
 * persistence (and so the health-check cron sees the same index), and swaps the
 * in-memory URL so the NEXT login uses it immediately — no pm2 restart, which
 * would otherwise drop active trades and sessions. Fire-and-forget; guarded
 * against concurrent rotation so a burst of failures rotates only once.
 */
export declare function triggerProxyRotation(): Promise<void>;
