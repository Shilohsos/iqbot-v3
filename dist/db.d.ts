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
    currency?: string | null;
    created_at?: string;
    last_used?: string;
}
export declare function saveUserCurrency(telegramId: number, currency: string): void;
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
export declare function getUserMartingaleSettings(telegramId: number): {
    enabled: boolean;
    maxRounds: number;
};
export declare function setUserMartingaleSettings(telegramId: number, enabled: boolean, maxRounds: number): void;
export declare function getUserSessionStats(telegramId: number): {
    trades: number;
    pnl: number;
};
export declare function addUserSessionStats(telegramId: number, tradeDelta: number, pnlDelta: number): void;
export declare function getUserBalanceCache(telegramId: number): {
    line: string;
    ts: number;
} | undefined;
export declare function setUserBalanceCache(telegramId: number, line: string): void;
export declare function clearUserBalanceCache(telegramId: number): void;
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
export declare function insertMessage(telegramId: number, direction: 'incoming' | 'outgoing'): void;
export declare function getRecentlyApprovedUsers(minutes: number): UserRecord[];
export declare function userHasActivity(telegramId: number): boolean;
export declare function setSession(key: string, value: unknown): void;
export declare function getSession<T>(key: string): T | undefined;
export declare function deleteSession(key: string): void;
export declare function cleanStaleSessions(): void;
export declare function saveGeneratedGiveawayId(giveawayRun: string, generatedId: string, pattern: string): void;
export declare function isGeneratedIdUsed(generatedId: string): boolean;
export declare function getTradersIqUserIds(hours: number): number[];
export declare function getGiveawayTargetIds(target: 'all' | '24h'): number[];
export interface FabricatedTrader {
    id: number;
    fabricated_id: string;
    display_name: string;
    current_pnl: number;
    next_update_at: string | null;
    update_interval: number;
    created_at: string;
}
export declare function countFabricatedTraders(): number;
export declare function seedFabricatedTraders(): void;
export declare function getFabricatedTradersDueForUpdate(): FabricatedTrader[];
export declare function updateFabricatedPnl(id: number, newPnl: number, nextUpdateAt: string): void;
export declare function getAllFabricatedTraders(): FabricatedTrader[];
export declare function resetFabricatedPnl(): void;
export declare function getRealTraderLeaderboard(): Array<{
    telegram_id: number;
    username: string | null;
    total_pnl: number;
}>;
export interface GiveawayEvent {
    id: number;
    event_type: string;
    title: string;
    description: string | null;
    criteria_type: string | null;
    criteria_value: string | null;
    prize_pool: number | null;
    prize_per_winner: number | null;
    max_winners: number;
    status: string;
    starts_at: string | null;
    ends_at: string | null;
    winner_count: number;
    created_at: string;
}
export interface GiveawayEventInput {
    event_type: 'giveaway' | 'promo_code' | 'marathon';
    title: string;
    description?: string;
    criteria_type?: string;
    criteria_value?: string;
    prize_pool?: number;
    max_winners: number;
    starts_at?: string;
    ends_at?: string;
}
export declare function dbCreateGiveawayEvent(input: GiveawayEventInput): number;
export declare function getGiveawayEvent(id: number): GiveawayEvent | undefined;
export declare function getGiveawayEvents(status?: string): GiveawayEvent[];
export declare function getActiveGiveaways(): GiveawayEvent[];
export declare function setGiveawayStatus(id: number, status: string): void;
export declare function incrementGiveawayWinnerCount(id: number): void;
export interface GiveawayParticipant {
    id: number;
    giveaway_id: number;
    telegram_id: number;
    trade_count: number;
    eligible: number;
    disqualify_reason: string | null;
    winner: number;
    joined_at: string;
}
export declare function getGiveawayParticipant(giveawayId: number, telegramId: number): GiveawayParticipant | undefined;
export declare function insertGiveawayParticipant(giveawayId: number, telegramId: number): number;
export declare function getGiveawayParticipants(giveawayId: number, eligibleOnly?: boolean): GiveawayParticipant[];
export declare function getGiveawayParticipantCount(giveawayId: number): number;
export declare function incrementParticipantTradeCount(participantId: number): void;
export declare function setParticipantWinner(participantId: number): void;
export declare function disqualifyParticipant(participantId: number, reason: string): void;
export interface ActiveParticipation {
    participation_id: number;
    giveaway_id: number;
    criteria_type: string | null;
    title: string;
    prize_per_winner: number | null;
    prize_pool: number | null;
}
export declare function getActiveParticipations(telegramId: number): ActiveParticipation[];
export interface GiveawayUpdate {
    id: number;
    giveaway_id: number;
    participant_id: number;
    telegram_id: number;
    update_type: string;
    update_text: string | null;
    sent: number;
    send_at: string;
}
export declare function insertGiveawayUpdate(giveawayId: number, participantId: number, telegramId: number, type: string, text: string, sendAt: string): void;
export declare function getPendingGiveawayUpdates(): GiveawayUpdate[];
export declare function markGiveawayUpdateSent(id: number): void;
export interface MotivationalMessage {
    id: number;
    category: string;
    content: string;
}
export declare function getRandomMotivationalMessage(category?: string): MotivationalMessage | undefined;
export interface NotificationQueueItem {
    id: number;
    telegram_id: number;
    message: string;
    reply_markup: string | null;
    image_file_id: string | null;
    delete_after_seconds: number | null;
    priority: number;
    status: string;
    send_after: string | null;
}
export declare function insertNotification(telegramId: number, message: string, opts?: {
    replyMarkup?: string;
    imageFileId?: string;
    deleteAfterSeconds?: number;
    priority?: number;
    sendAfter?: string;
}): void;
export declare function getPendingNotifications(limit?: number): NotificationQueueItem[];
export declare function markNotificationSent(id: number): void;
export declare function markNotificationFailed(id: number): void;
export declare function getApprovedUsersWithTier(): Array<{
    telegram_id: number;
    tier: string | null;
}>;
export interface BroadcastMessage {
    id: number;
    type: string;
    category: string | null;
    content: string;
    image_file_id: string | null;
    enabled: number;
    last_sent_at: string | null;
    sent_count: number;
    created_at: string;
}
export declare function getEnabledAutoMessages(): BroadcastMessage[];
export declare function getBroadcastMessages(type?: string): BroadcastMessage[];
export declare function insertBroadcastMessage(type: string, content: string, category?: string, imageFileId?: string): number;
export declare function markBroadcastSent(id: number, count: number): void;
export declare function updateBroadcastImageFileId(id: number, imageFileId: string): void;
export declare function getGiveawayStats(): {
    active: number;
    scheduled: number;
    completed: number;
};
