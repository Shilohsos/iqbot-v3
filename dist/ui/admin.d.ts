type Btn = {
    text: string;
    callback_data: string;
} | {
    text: string;
    url: string;
};
type IKMarkup = {
    inline_keyboard: Btn[][];
};
export declare function getAdminId(): number;
export declare function adminKeyboard(): IKMarkup;
export declare function adminBackKeyboard(): IKMarkup;
export declare function broadcastTargetKeyboard(): IKMarkup;
export declare function broadcastSendOrScheduleKeyboard(): IKMarkup;
export declare function broadcastDelayKeyboard(): IKMarkup;
export declare function scheduledBroadcastsKeyboard(schedules: {
    id: number;
    label: string;
}[]): IKMarkup;
export declare function broadcastLinkKeyboard(): IKMarkup;
export declare function broadcastActionKeyboard(): IKMarkup;
export declare function broadcastTimerKeyboard(): IKMarkup;
export declare function tokenTierKeyboard(): IKMarkup;
export declare function generateTokenKeyboard(): IKMarkup;
export declare function topTradersAdminKeyboard(editableEntries?: Array<{
    telegram_id: number;
    masked: string;
}>): IKMarkup;
export declare function activationsKeyboard(pendingUsers: Array<{
    telegram_id: number;
    username: string | null;
}>): IKMarkup;
export declare function funnelKeyboard(): IKMarkup;
export declare function memberManagementKeyboard(): IKMarkup;
export {};
