export interface TradeRecord {
    id?: number;
    telegram_id?: number;
    pair: string;
    direction: string;
    amount: number;
    status: 'WIN' | 'LOSS' | 'TIE' | 'TIMEOUT' | 'ERROR';
    pnl: number;
    trade_id?: number;
    error?: string;
    martingale_run?: string;
    created_at?: string;
}
export interface TradeStats {
    total: number;
    wins: number;
    losses: number;
    ties: number;
    totalPnl: number;
}
export declare function insertTrade(t: TradeRecord): void;
export declare function getRecentTrades(limit?: number, telegramId?: number): TradeRecord[];
export declare function getTradeStats(telegramId?: number): TradeStats;
export declare function getTopTradersToday(limit?: number): Array<{
    telegram_id: number;
    username: string | null;
    trade_count: number;
}>;
export type ApprovalStatus = 'pending' | 'approved' | 'manual' | 'rejected' | 'paused';
export interface UserRecord {
    telegram_id: number;
    username?: string | null;
    ssid?: string | null;
    iq_user_id?: number | null;
    approval_status: ApprovalStatus;
    approved_at?: string | null;
    affiliate_data?: string | null;
    tier?: string | null;
    created_at?: string;
    last_used?: string;
}
export declare function maskUserId(id: number): string;
export declare function getUser(telegramId: number): UserRecord | undefined;
export declare function findUsersByUsername(username: string): UserRecord[];
export declare function saveUser(user: Pick<UserRecord, 'telegram_id' | 'ssid'>): void;
export declare function saveUsername(telegramId: number, username: string | undefined): void;
export declare function upsertOnboardingUser(telegramId: number, iqUserId: number): void;
export declare function approveUser(telegramId: number, affiliateData?: string): void;
export declare function setManualApproval(telegramId: number): void;
export declare function rejectUser(telegramId: number): void;
export declare function resetUser(telegramId: number): void;
export declare function pauseUser(telegramId: number): void;
export declare function resumeUser(telegramId: number): void;
export declare function deleteUser(telegramId: number): void;
export declare function setUserTier(telegramId: number, tier: string): void;
export declare function getAllUsers(): UserRecord[];
export declare function getAllUserIds(): number[];
export declare function getActiveTraderIds(hours?: number): number[];
export declare function getInactiveTraderIds(hours?: number): number[];
export declare function getRecentApprovals(hours?: number): UserRecord[];
export declare function getPendingManualUsers(): UserRecord[];
export interface ApprovalStats {
    approved: number;
    pending: number;
    manual: number;
    rejected: number;
    total: number;
}
export declare function getApprovalStats(): ApprovalStats;
export interface TokenRecord {
    id: number;
    token: string;
    tier: string;
    used_by?: number | null;
    used_at?: string | null;
    expires_at: string;
    created_at: string;
}
export declare function generateToken(tier: string): string;
export declare function validateToken(token: string): {
    valid: boolean;
    tier?: string;
    error?: string;
};
export declare function useToken(token: string, telegramId: number): boolean;
export declare function getTokens(): TokenRecord[];
export declare function updateLeaderboardAuto(telegramId: number, pnl: number): void;
export declare function addLeaderboardManual(telegramId: number, profit: number): boolean;
export declare function getLeaderboard(date?: string): Array<{
    telegram_id: number;
    profit: number;
}>;
export interface LeaderboardDetailedEntry {
    id: number;
    telegram_id: number;
    auto_profit: number;
    manual_profit: number | null;
    date: string;
}
export declare function getLeaderboardDetailed(date?: string): LeaderboardDetailedEntry[];
export declare function updateLeaderboardManual(telegramId: number, profit: number): boolean;
export declare function insertFunnelEvent(eventType: string, metadata?: string): void;
export declare function getFunnelStats(): {
    events: number;
    byType: Array<{
        event_type: string;
        cnt: number;
    }>;
};
export declare function getConfig(key: string): string | null;
export declare function setConfig(key: string, value: string): void;
export interface PairWinRate {
    pair: string;
    winRate: number;
    totalCircles: number;
}
export declare function calculatePairWinRates(): PairWinRate[];
export declare function selectTopPicks(rates: PairWinRate[]): PairWinRate[];
export interface AuditReport {
    newUsers: number;
    autoApproved: number;
    manualPending: number;
    totalTrades: number;
    wins: number;
    losses: number;
    ties: number;
    totalPnl: number;
    martingaleRuns: number;
    martingaleRecovered: number;
    topPerformerId?: number;
    topPerformerProfit?: number;
}
export declare function getAuditReport(): AuditReport;
export declare function setSession(key: string, value: unknown): void;
export declare function getSession<T>(key: string): T | undefined;
export declare function deleteSession(key: string): void;
export declare function cleanStaleSessions(): void;
