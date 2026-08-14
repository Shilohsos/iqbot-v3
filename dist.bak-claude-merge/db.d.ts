export declare const db: any;
export declare function seedTemplates(): void;
export interface TradeRecord {
    id?: number;
    telegram_id?: number;
    pair: string;
    direction: string;
    amount: number;
    status: 'WIN' | 'LOSS' | 'TIE' | 'TIMEOUT' | 'ERROR' | 'in_flight';
    pnl: number;
    trade_id?: number;
    error?: string;
    martingale_run?: string;
    external_id?: number;
    created_at?: string;
    rounds?: number;
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
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'paused';
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
    cred?: string | null;
    email?: string | null;
    ssid_valid?: number | null;
    ssid_last_checked?: string | null;
    reconnect_prompt_msg_id?: number | null;
    reconnect_prompt_at?: string | null;
    onboarding_state?: string | null;
    pidgin_enabled?: number;
    analysis_candles?: number | null;
    display_confidence_min?: number | null;
    access_level?: string | null;
    access_expires_at?: string | null;
    signals_used_today?: number | null;
    signals_date?: string | null;
    funded_balance_usd?: number | null;
    total_signals_used?: number | null;
    ui_disabled?: number | null;
}
export interface AutoTradingSession {
    id: number;
    telegram_id: number;
    currency: string;
    amount: number;
    assets: string;
    timeframe: number;
    gale_rounds: number;
    status: 'running' | 'paused' | 'stopped';
    current_asset_index: number;
    trades_done: number;
    evaluations: number;
    pnl: number;
    mode?: 'demo' | 'live';
    last_error?: string | null;
    started_at?: string;
    last_trade_at?: string | null;
    mg_active: number;
    mg_next_amount: number;
    status_msg_id?: number | null;
}
export interface SignalTrackRecord {
    id: number;
    telegram_id: number;
    pair: string;
    direction: string;
    timeframe: number;
    entry_time: string;
    expiry_time: string;
    round: number;
    max_rounds: number;
    entry_price: number | null;
    status: 'active' | 'won' | 'lost';
    result: string | null;
    card_chat_id?: number | null;
    card_msg_id?: number | null;
    created_at?: string;
}
export declare function saveUserCurrency(telegramId: number, currency: string): void;
export declare function maskUserId(id: number): string;
export declare function getUser(telegramId: number): UserRecord | undefined;
export declare function findUsersByUsername(username: string): UserRecord[];
export declare function findUsersByIqUserId(iqUserId: number): UserRecord[];
export declare function saveUserIqUserId(telegramId: number, iqUserId: string): void;
export declare function saveUser(user: Pick<UserRecord, 'telegram_id' | 'ssid'>): void;
export declare function saveUserCred(telegramId: number, cred: string, email: string): void;
export declare function saveUsername(telegramId: number, username: string | undefined): void;
export declare function upsertOnboardingUser(telegramId: number, iqUserId: number): void;
export declare function approveUser(telegramId: number, affiliateData?: string): void;
export declare function rejectUser(telegramId: number): void;
export declare function resetUser(telegramId: number): void;
export declare function pauseUser(telegramId: number): void;
export declare function resumeUser(telegramId: number): void;
export declare function deleteUser(telegramId: number): void;
export declare function clearUserSsid(telegramId: number): void;
/** Mark a user's SSID validity (1 = valid, 0 = expired) and stamp the check time. */
export declare function setSsidValid(telegramId: number, valid: 0 | 1): void;
/** Users who have an SSID stored — candidates for the health check. */
export declare function getUsersWithSsid(): UserRecord[];
/** Broadcast targets: only funded users (PRO/MASTER with SSID), excluding admin. */
export declare function getBroadcastTargetIds(): number[];
/** Expired-SSID users due for a reconnect follow-up (never prompted, or last prompt older than `hours`). */
export declare function getUsersDueForReconnectPrompt(hours: number): UserRecord[];
/** Record the currently-visible reconnect prompt message (so the next one can delete it). */
export declare function setReconnectPrompt(telegramId: number, msgId: number | null): void;
export declare function clearReconnectPrompt(telegramId: number): void;
export declare function setUserAccessLevel(telegramId: number, accessLevel: string, expiresAt?: string | null): void;
/** Downgrade users whose token-granted access has expired. Returns count of downgraded. */
export declare function downgradeExpiredAccess(): number;
/** Cache the user's funded USD balance and (optionally) bump their access level.
 *  When accessLevel is provided, access_expires_at is also written: callers pass
 *  the token expiry to preserve it, or omit it to clear a stale expiry (the common
 *  balance-derived case). */
export declare function setUserFundedBalance(telegramId: number, fundedUsd: number, accessLevel?: string, accessExpiresAt?: string | null): void;
/**
 * Returns the user's signal usage for today, resetting the counter when the
 * stored date is not today. `used` is post-reset, so callers can compare against
 * the daily cap directly.
 */
export declare function getSignalUsage(telegramId: number): {
    used: number;
    date: string;
};
/** Increment today's signal counter (resetting first if the date rolled over). */
export declare function incrementSignalUsage(telegramId: number): number;
/** Lifetime total signals a user has generated (never resets). */
export declare function getTotalSignalCount(telegramId: number): number;
export declare function incrementTotalSignalCount(telegramId: number): number;
/** Total signals consumed across all users today — for the admin panel. */
export declare function getTotalSignalsToday(): number;
export declare function upsertAutoSession(s: {
    telegram_id: number;
    currency: string;
    amount: number;
    assets: string[];
    timeframe: number;
    gale_rounds: number;
    mode?: 'demo' | 'live';
}): void;
export declare function getAutoSession(telegramId: number): AutoTradingSession | undefined;
export declare function getRunningAutoSessions(): AutoTradingSession[];
export declare function setAutoSessionStatus(telegramId: number, status: 'running' | 'paused' | 'stopped', lastError?: string | null): void;
/** Persist progress after a settled run: advance the asset cursor and accumulate stats. */
export declare function recordAutoSessionTrade(telegramId: number, nextAssetIndex: number, pnlDelta: number): void;
/** A market check that did NOT place a trade (e.g. low confidence): advance the
 *  asset cursor and bump the evaluations counter — never trades_done. */
export declare function recordAutoSessionEvaluation(telegramId: number, nextAssetIndex: number): void;
/** Persist martingale gale state so a restart can resume mid-sequence. */
export declare function setAutoSessionMgState(telegramId: number, active: boolean, nextAmount?: number): void;
export declare function insertSignalTrack(r: {
    telegram_id: number;
    pair: string;
    direction: string;
    timeframe: number;
    entry_time: string;
    expiry_time: string;
    round: number;
    max_rounds: number;
    entry_price: number | null;
    card_chat_id?: number;
    card_msg_id?: number;
}): number;
export declare function getExpiredActiveSignals(): SignalTrackRecord[];
export declare function updateSignalTrackResult(id: number, status: 'won' | 'lost', result: string): void;
/** Repoint a tracking record at a freshly-sent card message (dedup fallback). */
export declare function updateSignalTrackCard(id: number, chatId: number, msgId: number): void;
export declare function getActiveSignalTrack(telegramId: number): SignalTrackRecord | undefined;
export declare function cancelActiveSignalTracks(telegramId: number): void;
export declare function getAllActiveSignalTracks(): SignalTrackRecord[];
export declare function getAllUsers(): UserRecord[];
export declare function getAllUserIds(): number[];
/** Users who have connected an IQ Option account (ssid set) */
export declare function getActivatedUserIds(): number[];
/** Users who have NOT connected an IQ Option account OR were rejected */
export declare function getNonActivatedUserIds(): number[];
export declare function getActiveTraderIds(hours?: number): number[];
export declare function getInactiveTraderIds(hours?: number): number[];
export declare function getRecentApprovals(hours?: number): UserRecord[];
export declare function getPendingManualUsers(): UserRecord[];
export interface ApprovalStats {
    approved: number;
    pending: number;
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
export declare function logPageVisit(source?: string): void;
export interface FunnelPipeline {
    page_views_today: number;
    page_views_this_week: number;
    channel_joins_today: number;
    channel_joins_this_week: number;
    connects_today: number;
    connects_this_week: number;
    funded_today: number;
    funded_this_week: number;
    recent_events: Array<{
        event_type: string;
        created_at: string;
        source: string | null;
    }>;
}
export declare function getFunnelPipeline(): FunnelPipeline;
export declare function getConfig(key: string): string | null;
export declare function setConfig(key: string, value: string): void;
export declare function getTestUserId(): number | null;
export declare function setTestUser(id: number | null): void;
export declare function getLastBroadcastMsgId(telegramId: number): number | null;
export declare function saveLastBroadcastMsgId(telegramId: number, messageId: number): void;
export declare function getNextBroadcastAt(): string | null;
export declare function saveNextBroadcastAt(isoStr: string): void;
export declare function getMessageIndex(): number;
export declare function saveMessageIndex(idx: number): void;
export interface PersistedScheduledBroadcast {
    id: number;
    message: string;
    targetIds: number[];
    button?: unknown;
    media?: unknown;
    deleteAfterMs: number;
    scheduledAt: string;
    createdAt: string;
    sent: boolean;
}
export declare function insertScheduledBroadcast(input: Omit<PersistedScheduledBroadcast, 'id' | 'sent'>): number;
export declare function markScheduledBroadcastSent(id: number): void;
export declare function deleteScheduledBroadcast(id: number): void;
export declare function getPendingScheduledBroadcasts(): PersistedScheduledBroadcast[];
interface BroadcastButton {
    text: string;
    type: 'url' | 'callback';
    value: string;
}
interface PendingBroadcastRow {
    chat_id: number;
    message: string;
    target_ids: string;
    button: string | null;
    media: string | null;
    delete_after_ms: number;
    created_at: number;
}
export declare function savePendingBroadcast(chatId: number, data: {
    message: string;
    targetIds: number[];
    button?: {
        text: string;
        type: string;
        value: string;
    };
    media?: Array<{
        type: string;
        fileId: string;
    }>;
    deleteAfterMs?: number;
    createdAt?: number;
}): void;
export declare function getPendingBroadcast(chatId: number): PendingBroadcastRow | undefined;
export declare function deletePendingBroadcast(chatId: number): void;
export declare function loadAllPendingBroadcasts(): Map<number, {
    message: string;
    targetIds: number[];
    button?: BroadcastButton;
    media?: Array<{
        type: 'photo' | 'video' | 'video_note' | 'voice';
        fileId: string;
    }>;
    deleteAfterMs?: number;
    createdAt?: number;
}>;
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
    winner_use_count: number;
    last_used_giveaway_id: number | null;
}
export declare function countFabricatedTraders(): number;
export declare function seedFabricatedTraders(): void;
export declare function getFabricatedTradersDueForUpdate(): FabricatedTrader[];
export declare function updateFabricatedPnl(id: number, newPnl: number, nextUpdateAt: string): void;
export declare function getAllFabricatedTraders(): FabricatedTrader[];
export declare function resetFabricatedPnl(): void;
export declare function getLastCompletedGiveawayId(): number | null;
export declare function getEligibleFabWinnerIds(currentGiveawayId: number): string[];
export declare function markFabWinnerUsed(fabricatedId: string, giveawayId: number): void;
export interface MarathonFabricant {
    id: number;
    giveaway_id: number;
    display_name: string;
    trade_count: number;
    next_update_at: string | null;
    update_interval: number;
}
export declare function seedMarathonFabricants(giveawayId: number): void;
export declare function getMarathonLeaderboardRows(giveawayId: number): Array<{
    telegram_id: number | null;
    display_name: string | null;
    trade_count: number;
}>;
export declare function getMarathonFabricantsDueForUpdate(): MarathonFabricant[];
export declare function updateMarathonFabricantTrades(id: number, tradeCount: number, nextUpdateAt: string): void;
export declare function deleteMarathonFabricants(giveawayId: number): void;
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
    fabricated_claims: number;
    urgency_10_sent: number;
    urgency_5_sent: number;
    urgency_1_sent: number;
    fab_next_tick_at: string | null;
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
export declare function getPendingGiveawaysDue(): GiveawayEvent[];
export declare function setGiveawayStatus(id: number, status: string): void;
export declare function deleteGiveaway(id: number): void;
export declare function incrementGiveawayWinnerCount(id: number): void;
export declare function setPromoFabricatedClaims(id: number, claims: number, nextTickAt: string): void;
export declare function incrementPromoFabricatedClaims(id: number, increment: number, nextTickAt: string): void;
export declare function markPromoUrgencySent(id: number, threshold: 10 | 5 | 1): void;
export declare function getActivePromosDueForFabTick(): GiveawayEvent[];
export interface GiveawayParticipant {
    id: number;
    giveaway_id: number;
    telegram_id: number;
    trade_count: number;
    eligible: number;
    disqualify_reason: string | null;
    winner: number;
    fabricated: number;
    joined_at: string;
    won_at: string | null;
}
export declare function getGiveawayParticipant(giveawayId: number, telegramId: number): GiveawayParticipant | undefined;
export declare function insertGiveawayParticipant(giveawayId: number, telegramId: number): number;
export declare function seedGiveawayFabricants(giveawayId: number): void;
export declare function getRealAndFabricatedCounts(giveawayId: number): {
    real: number;
    fabricated: number;
};
export declare function getGiveawayParticipants(giveawayId: number, eligibleOnly?: boolean): GiveawayParticipant[];
export declare function getGiveawayParticipantCount(giveawayId: number): number;
export declare function getMarathonParticipantCount(giveawayId: number): number;
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
export interface ComposeTone {
    styleGuide: string;
    sample1: string;
    sample2: string;
    sample3: string;
}
export declare function getComposeTone(): ComposeTone;
export declare function setComposeTone(fields: Partial<{
    styleGuide: string;
    sample1: string;
    sample2: string;
    sample3: string;
}>): void;
export declare function getAdminSsid(): string | null;
export declare function setAdminSsid(ssid: string): void;
export declare function clearAdminSsid(): void;
export declare function getGiveawayStats(): {
    active: number;
    scheduled: number;
    completed: number;
};
export interface TemplateRecord {
    key: string;
    category: string;
    state: string | null;
    message: string;
    media_file_id: string | null;
    button_text: string | null;
    button_url: string | null;
    button_callback: string | null;
    auto_delete: number;
    delay_sec: number | null;
    created_at: string;
}
export declare function getTemplateByKey(key: string): TemplateRecord | undefined;
export declare function getTemplatesByCategory(category: string, state?: string): TemplateRecord[];
export declare function getRandomTemplate(category: string, state?: string): TemplateRecord | undefined;
export declare function getTemplateCategories(): {
    category: string;
    count: number;
}[];
export declare function updateTemplateMessage(key: string, message: string): void;
export declare function setOnboardingState(telegramId: number, state: string): void;
export declare function touchOnboardingActivity(telegramId: number): void;
export declare function setUserPidginEnabled(telegramId: number, enabled: boolean): void;
/** Increment demo trade count; returns new count. */
export declare function incrementDemoTradeCount(telegramId: number): number;
export declare function getDemoTradeCount(telegramId: number): number;
export declare function setLastFundingAt(telegramId: number): void;
export declare function getOnboardingTracking(telegramId: number): {
    demo_trade_count: number;
    last_funding_at: string | null;
    last_followup_msg_id: number | null;
} | undefined;
export declare function setLastFollowupMsgId(telegramId: number, messageId: number): void;
export declare function getUserIdFailCount(telegramId: number): number;
export declare function incrementUserIdFailCount(telegramId: number): number;
export declare function resetUserIdFailCount(telegramId: number): void;
export declare function getFundingCycle(telegramId: number): {
    last_sent_at: string | null;
    last_msg_id: number | null;
    next_run_at: string | null;
} | undefined;
export declare function upsertFundingCycle(telegramId: number, last_sent_at: string | null, last_msg_id: number | null, next_run_at: string): void;
export declare function getFundingCycleDueUsers(): Array<{
    telegram_id: number;
}>;
export declare function getDemoUsersWithTrades(): Array<{
    telegram_id: number;
}>;
export declare function getLastTradeTime(telegramId: number): Date | null;
export declare function getReconnectCycle(telegramId: number): {
    last_state: string | null;
    last_msg_id: number | null;
    next_run_at: string | null;
} | undefined;
export declare function upsertReconnectCycle(telegramId: number, last_state: string | null, last_msg_id: number | null, next_run_at: string): void;
export declare function getReconnectCycleDueUsers(): Array<{
    telegram_id: number;
}>;
export declare function getSsidExpiredUsers(): Array<{
    telegram_id: number;
}>;
export declare function getUserIdRejectedUsers(): Array<{
    telegram_id: number;
}>;
export declare function getLoginFailedUsers(): Array<{
    telegram_id: number;
}>;
export declare function getAbandonedOnboardingUsers(): Array<{
    telegram_id: number;
}>;
export declare function getNeverConnectedUsers(): Array<{
    telegram_id: number;
}>;
/** Users stuck in an onboarding state for longer than `hours`. */
export declare function getStuckOnboardingUsers(hours: number): UserRecord[];
/** Users who are connected but have never taken a demo trade. */
export declare function getConnectedNonTraders(hours: number): UserRecord[];
/** Users who have taken at least one demo trade. */
export declare function getDemoTraders(): UserRecord[];
export declare function setReengageMsgId(telegramId: number, msgId: number | null, segment: string): void;
export declare function getReengageTracking(telegramId: number): {
    last_msg_id: number | null;
    last_segment: string | null;
} | undefined;
export declare function getReengageVariant(telegramId: number): number;
/** Advances the variant counter (0→1→2→0) and returns the NEW value to use for this send. */
export declare function cycleReengageVariant(telegramId: number): number;
export declare function getDailyDemoCount(telegramId: number): number;
export declare function incrementDailyDemoCount(telegramId: number): number;
export declare function getProductUsage(telegramId: number, product: string): {
    used: number;
    minutes: number;
};
export declare function incrementProductUsage(telegramId: number, product: string): number;
export declare function addProductMinutes(telegramId: number, product: string, minutes: number): number;
export declare function setProductMinutes(telegramId: number, product: string, minutes: number): void;
/** Live signals counter — tracks how many LIVE signals a funded user has used today.
 *  First SIGNALS_PREMIUM_COUNT (5) get premium analysis; after that, drainage. */
export declare function getLiveSignalsUsed(telegramId: number): number;
export declare function incrementLiveSignalsUsed(telegramId: number): number;
/** Reset live signals counter — call daily or when balance drops below threshold. */
export declare function resetLiveSignalsUsed(telegramId: number): void;
export declare function getSequenceMedia(templateKey: string): {
    media_type: string;
    file_id: string;
} | undefined;
export declare function setSequenceMedia(templateKey: string, mediaType: 'photo' | 'video', fileId: string): void;
export declare function getAllSequenceMediaKeys(): {
    template_key: string;
    media_type: string | null;
    description: string;
}[];
export declare function getAccessDistribution(): {
    access_level: string;
    count: number;
    pct: number;
}[];
export declare function getFundedUserCount(): number;
export declare function getFundedUserIds(): number[];
export declare function getNonFundedUserIds(): number[];
export interface BroadcastHistoryRow {
    id: number;
    type: string;
    category: string | null;
    content: string;
    created_at: string;
    last_sent_at: string | null;
    sent_count: number;
}
export declare function getRecentBroadcasts(limit?: number): BroadcastHistoryRow[];
export declare function getOnboardingFunnelStats(): Record<string, number>;
export declare function getMarketPulseStats(): Record<string, number | string>;
/** Users stuck at awaiting_user_id — started onboarding, never sent their ID. */
export declare function getAwaitingUserIdUsers(): Array<{
    telegram_id: number;
}>;
export declare function getPendingPrompt(telegramId: number): {
    last_msg_id: number | null;
    next_run_at: string | null;
    variant: number;
} | undefined;
export declare function upsertPendingPrompt(telegramId: number, last_msg_id: number | null, next_run_at: string, variant: number): void;
export declare function getPendingPromptDueUsers(): Array<{
    telegram_id: number;
}>;
export declare function getSessionTrades(telegramId: number): number;
export interface MarathonConfig {
    id: number;
    giveaway_id: number;
    min_balance_usd: number;
    min_trades: number;
    min_growth_multiplier: number;
    status: string;
    created_at: string;
}
export interface MarathonParticipant {
    id: number;
    marathon_config_id: number;
    telegram_id: number;
    start_balance_usd: number;
    current_balance_usd: number;
    trades_done: number;
    growth_multiplier: number;
    qualified: number;
    qualified_at: string | null;
    blown_account: number;
    push_count: number;
    last_push_at: string | null;
    joined_at: string;
    start_session_trades: number;
}
export declare function createMarathonConfig(giveawayId: number, minBalanceUsd: number, minTrades: number, minGrowthMultiplier: number): number;
export declare function getActiveMarathonConfig(): MarathonConfig | undefined;
export declare function getMarathonConfig(id: number): MarathonConfig | undefined;
export declare function setMarathonConfigStatus(id: number, status: string): void;
export declare function getMarathonParticipant(marathonConfigId: number, telegramId: number): MarathonParticipant | undefined;
export declare function insertMarathonParticipant(marathonConfigId: number, telegramId: number, startBalanceUsd: number): void;
export declare function updateMarathonParticipantBalance(marathonConfigId: number, telegramId: number, currentBalanceUsd: number, tradesDone: number): void;
export declare function markMarathonParticipantQualified(marathonConfigId: number, telegramId: number): void;
export declare function markMarathonParticipantBlown(marathonConfigId: number, telegramId: number): void;
export declare function incrementMarathonPush(marathonConfigId: number, telegramId: number): void;
export declare function getActiveMarathonParticipants(): MarathonParticipant[];
export declare function getMarathonLeaderboard(marathonConfigId: number): Array<{
    telegram_id: number;
    trades_done: number;
    growth_multiplier: number;
    current_balance_usd: number;
    rank: number;
}>;
export {};
