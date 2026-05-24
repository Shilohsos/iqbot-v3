export declare const logger: {
    info: (component: string, msg: string) => void;
    warn: (component: string, msg: string) => void;
    error: (component: string, msg: string, err?: unknown) => void;
    trade: (action: string, pair: string, telegramId: number, detail?: string) => void;
};
