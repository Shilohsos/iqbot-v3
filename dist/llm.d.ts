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
