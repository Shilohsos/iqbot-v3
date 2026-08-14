import { ClientSdk, type Positions } from './index.js';
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
 * One-shot trade — fresh connection per call, shut down when done.
 */
export declare function executeTrade(ssid: string, trade: TradeRequest): Promise<TradeResult>;
export declare function createSdk(ssid: string): Promise<ClientSdk>;
export interface MartingaleParams {
    pair: string;
    direction: 'call' | 'put';
    amount: number;
    timeframeSec: number;
    galeRounds: number;
    balanceType: 'demo' | 'live';
    telegramId?: number;
    cooldownMs?: number;
}
export interface MartingaleRoundInfo {
    round: number;
    amount: number;
    result: TradeResult;
}
export interface MartingaleOutcome {
    status: 'WIN' | 'LOSS' | 'TIE' | 'ERROR' | 'TIMEOUT';
    totalPnl: number;
    rounds: number;
}
/**
 * UI-free martingale runner: executes a trade on an already-connected SDK and
 * doubles the stake on loss until a win/tie, an error, or `galeRounds` recovery
 * rounds are exhausted. Shared execution primitive (`executeTradeWithSdk`) with
 * the Telegram-coupled runMartingale in bot.ts. The optional `onRound` callback
 * lets callers render progress without this function knowing about Telegram.
 */
export declare function runMartingaleCore(sdk: ClientSdk, params: MartingaleParams, onRound?: (info: MartingaleRoundInfo) => void | Promise<void>): Promise<MartingaleOutcome>;
export declare function waitForResult(positions: Positions, optionId: number, timeoutSeconds: number): Promise<Pick<TradeResult, 'status' | 'pnl' | 'error'> & {
    externalId?: number;
}>;
