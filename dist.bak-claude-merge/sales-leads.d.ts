export interface LeadEvent {
    id: number;
    event_type: 'ftd' | 'redep';
    iq_user_id: number;
    amount: number;
    country: string | null;
    afftrack: string | null;
    channel_msg_id: number;
    event_date: string;
    claimed: 0 | 1;
    claimed_by: string | null;
    claimed_at: string | null;
}
export interface RepStats {
    name: string;
    ftd_count: number;
    ftd_volume: number;
    redep_count: number;
    redep_volume: number;
    total_count: number;
    total_volume: number;
}
export interface WeeklyReport {
    week_start: string;
    week_end: string;
    reps: RepStats[];
    total_ftds: number;
    total_redeps: number;
    total_volume: number;
}
/**
 * Scan the affiliate channel for new FTD/redep events.
 * Only inserts events we haven't seen before (by channel_msg_id).
 */
export declare function scanChannelForLeads(): Promise<{
    newFtd: number;
    newRedep: number;
}>;
/** Look up the most recent unclaimed event for an IQ user ID. */
export declare function getLatestUnclaimed(iqUserId: number): LeadEvent | null;
/** Look up ALL unclaimed events for an IQ user ID. */
export declare function getAllUnclaimed(iqUserId: number): LeadEvent[];
/** Claim an event for a rep. */
export declare function claimLead(eventId: number, repName: string): boolean;
/** Get a specific event by ID. */
export declare function getEventById(eventId: number): LeadEvent | null;
/** Get weekly stats for all reps (Monday 00:00 to Sunday 23:59 UTC). */
export declare function getWeeklyReport(): WeeklyReport;
/** Get leaderboard sorted by FTD count (for weekly contest). */
export declare function getLeaderboard(): RepStats[];
/** Get an individual rep's current week stats. */
export declare function getRepStats(name: string): RepStats | null;
/** Get TOTAL stats for a rep for the current week (shortcut). */
export declare function getRepWeeklyCount(repName: string): {
    ftd: number;
    redep: number;
};
/** Get all claimed events for this week (for verification). */
export declare function getWeeklyClaimedEvents(): LeadEvent[];
export declare function getKpiTargets(): {
    ftd: number;
    redep: number;
};
export declare function setKpiTargets(ftd: number, redep: number): void;
export declare function getContestConfig(): {
    prize: number;
    description: string;
};
export declare function setContestConfig(prize: number, description: string): void;
export declare function getAdminId(): number;
export declare function setAdminId(id: number): void;
export declare function getRepTelegramId(name: string): number | null;
export declare function setRepTelegramId(name: string, id: number): void;
export declare function getAllRepIds(): {
    name: string;
    telegramId: number;
}[];
