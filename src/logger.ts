export const logger = {
    info: (component: string, msg: string) =>
        console.log(`[${new Date().toISOString()}] [INFO] [${component}] ${msg}`),
    warn: (component: string, msg: string) =>
        console.log(`[${new Date().toISOString()}] [WARN] [${component}] ${msg}`),
    error: (component: string, msg: string, err?: unknown) =>
        console.error(`[${new Date().toISOString()}] [ERROR] [${component}] ${msg}`, err ?? ''),
    trade: (action: string, pair: string, telegramId: number, detail?: string) =>
        console.log(`[${new Date().toISOString()}] [TRADE] [${telegramId}] ${action} ${pair}${detail ? ' ' + detail : ''}`),
};
