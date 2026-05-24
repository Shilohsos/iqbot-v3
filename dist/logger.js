export const logger = {
    info: (component, msg) => console.log(`[${new Date().toISOString()}] [INFO] [${component}] ${msg}`),
    warn: (component, msg) => console.log(`[${new Date().toISOString()}] [WARN] [${component}] ${msg}`),
    error: (component, msg, err) => console.error(`[${new Date().toISOString()}] [ERROR] [${component}] ${msg}`, err ?? ''),
    trade: (action, pair, telegramId, detail) => console.log(`[${new Date().toISOString()}] [TRADE] [${telegramId}] ${action} ${pair}${detail ? ' ' + detail : ''}`),
};
