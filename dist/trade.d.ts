import { ClientSdk } from './index.js';
export interface TradeRequest {
    pair: string;
    direction: 'call' | 'put';
    amount: number;
    martingaleRunId?: string;
    timeframeSec?: number;
    balanceType?: 'demo' | 'live';
    telegramId?: number;
}
export interface TradeResult {
    status: 'WIN' | 'LOSS' | 'TIE' | 'TIMEOUT' | 'ERROR';
    pnl: number;
    tradeId: number;
    pair: string;
    direction: string;
    amount: number;
    error?: string;
}
/**
 * Runs a single trade on an already-authenticated SDK instance.
 * The caller owns the SDK lifecycle (connect / shutdown).
 * Catches SDK-internal TimeoutError and converts it to an ERROR result
 * so the martingale loop can handle it gracefully instead of crashing.
 *
 * All timeframes (30s / 60s / 300s) execute via BlitzOptions.
 */
export declare function executeTradeWithSdk(sdk: ClientSdk, trade: TradeRequest): Promise<TradeResult>;
/**
 * Convenience wrapper for one-shot trades.
 * Creates its own SDK connection and shuts it down after the trade.
 */
export declare function executeTrade(ssid: string, trade: TradeRequest): Promise<TradeResult>;
export declare function createSdk(ssid: string): Promise<ClientSdk>;
