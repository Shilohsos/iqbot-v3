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
export declare function startKeyboard(tier?: string): IKMarkup;
export declare function backKeyboard(): IKMarkup;
export declare function onboardKeyboard(): IKMarkup;
export {};
