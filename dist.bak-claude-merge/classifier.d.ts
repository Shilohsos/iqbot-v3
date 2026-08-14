export interface UserContext {
    onboarding_state: string | null;
    ssid_valid: number | null;
    has_ssid: boolean;
    demo_trade_count: number | null;
    access_level: string;
    user_id_fail_count?: number;
    brain_response_count?: number;
    is_activated: boolean;
}
export interface BrainResult {
    flow: string;
    message: string;
    shouldReply: boolean;
}
export declare function getBrainFlow(userId: number, text: string, context: UserContext): Promise<BrainResult>;
