export interface LlmRequest {
    topic: 'reviews' | 'motivation' | 'trade_win' | 'life_win';
    description: string;
    tone?: 'persuasive' | 'motivational' | 'social_proof' | 'urgent';
}
export interface LlmResponse {
    content: string;
    usage: {
        prompt_tokens: number;
        completion_tokens: number;
    };
}
export declare function generatePost(req: LlmRequest): Promise<LlmResponse>;
export declare function generateDiaryEntry(type: 'giveaway' | 'review' | 'post' | 'live_topics' | 'market_pulse', context?: Record<string, number | string>): Promise<{
    content: string;
}>;
