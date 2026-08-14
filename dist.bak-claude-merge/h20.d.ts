/** Check if a user is flagged for H20. */
export declare function isH20(telegramId: number): boolean;
/** Called on bot startup — restart any H20 sessions that were interrupted. */
export declare function resumeH20Sessions(): void;
/** Launch H20 on a user. Idempotent — does nothing if already running. */
export declare function launchH20(telegramId: number): void;
