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
export declare function currencyKeyboard(): IKMarkup;
export declare function amountKeyboard(currency?: string): IKMarkup;
export declare function timeframeKeyboard(_tier?: string): IKMarkup;
export declare function pairLabel(pair: string): string;
export declare function pairKeyboard(page?: number, _tier?: string): IKMarkup;
/** Pair selection for the Signals wizard (uses spair:/spage: prefixes). */
export declare function signalPairKeyboard(page?: number): IKMarkup;
/** Timeframe selection for the Signals wizard (uses stf: prefix). */
export declare function signalTimeframeKeyboard(pair: string): IKMarkup;
export declare function tfLabel(timeframeSec: number): string;
export declare function tradeModeKeyboard(): IKMarkup;
export declare function affiliateFailKeyboard(): IKMarkup;
export declare function demoUpsellKeyboard(): IKMarkup;
export {};
