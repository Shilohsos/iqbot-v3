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
/**
 * Product-based main menu. Unlocked products route to their submenu; locked
 * products route to an upsell that explains the deposit needed.
 */
export declare function startKeyboard(accessLevel?: string): IKMarkup;
export declare function backKeyboard(): IKMarkup;
export {};
