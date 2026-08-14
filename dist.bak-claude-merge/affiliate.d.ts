export interface AffiliateResult {
    found: boolean;
    data?: {
        message: string;
        date: string;
    } | null;
}
/**
 * Search the affiliate tracking channel for a given IQ Option User ID.
 * Throws if required env vars are missing or the Telegram session is invalid.
 */
export declare function checkAffiliate(iqUserId: number): Promise<AffiliateResult>;
