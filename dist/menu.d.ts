export declare const OTC_PAIRS: string[];
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
export declare function amountKeyboard(currency?: string): IKMarkup;
export declare function timeframeKeyboard(): IKMarkup;
export declare function pairKeyboard(page?: number, tier?: string): IKMarkup;
export declare function tfLabel(timeframeSec: number): string;
export declare function tierKeyboard(): IKMarkup;
export declare function hasAccountKeyboard(): IKMarkup;
export declare function tradeModeKeyboard(): IKMarkup;
export declare function affiliateFailKeyboard(): IKMarkup;
export declare function demoUpsellKeyboard(): IKMarkup;
export {};
