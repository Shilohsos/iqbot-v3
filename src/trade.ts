import {
    ClientSdk,
    SsidAuthMethod,
    TurboOptionsDirection,
    BalanceType,
    type Positions,
    type Position,
} from './index.js';
import { WS_URL, PLATFORM_ID, IQ_HOST } from './protocol.js';
import { insertTrade } from './db.js';

export interface TradeRequest {
    pair: string;
    direction: 'call' | 'put';
    amount: number;
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

export async function executeTrade(ssid: string, trade: TradeRequest): Promise<TradeResult> {
    const sdk = await ClientSdk.create(WS_URL, PLATFORM_ID, new SsidAuthMethod(ssid), { host: IQ_HOST });

    try {
        // Initialize positions facade before buying so the WS subscription is active
        const positions = await sdk.positions();

        const balances = await sdk.balances();
        const demoBalance = balances.getBalances().find(b => b.type === BalanceType.Demo);
        if (!demoBalance) return errorResult(trade, 'No demo balance found');

        const turboOptions = await sdk.turboOptions();
        const currentTime = sdk.currentTime();

        // Match pair by ticker (e.g. "EURUSD-OTC") or localizationKey (e.g. "front.EURUSD-OTC")
        const normalizedPair = trade.pair.replace(/^front\./i, '');
        const active = turboOptions.getActives().find(a =>
            a.ticker === normalizedPair ||
            a.localizationKey === normalizedPair ||
            a.localizationKey === `front.${normalizedPair}`
        );
        if (!active) return errorResult(trade, `Unknown pair: ${trade.pair}`);

        if (!active.canBeBoughtAt(currentTime)) {
            return errorResult(trade, `${trade.pair} market is closed right now`);
        }

        const instrumentsFacade = await active.instruments();
        const available = instrumentsFacade.getAvailableForBuyAt(currentTime);

        // Prefer 60s expiry, fall back to any available instrument
        const instrument =
            available.find(i => i.expirationSize === 60 && i.durationRemainingForPurchase(currentTime) > 3000) ??
            available.find(i => i.durationRemainingForPurchase(currentTime) > 3000);
        if (!instrument) return errorResult(trade, `No available instrument for ${trade.pair}`);

        const dir = trade.direction === 'call' ? TurboOptionsDirection.Call : TurboOptionsDirection.Put;
        const option = await turboOptions.buy(instrument, dir, trade.amount, demoBalance);

        const result = await waitForResult(positions, option.id, instrument.expirationSize + 90);
        const tradeResult: TradeResult = { ...result, tradeId: option.id, pair: trade.pair, direction: trade.direction, amount: trade.amount };

        insertTrade({
            pair: tradeResult.pair,
            direction: tradeResult.direction,
            amount: tradeResult.amount,
            status: tradeResult.status,
            pnl: tradeResult.pnl,
            trade_id: tradeResult.tradeId,
            error: tradeResult.error,
        });

        return tradeResult;
    } finally {
        await sdk.shutdown();
    }
}

function waitForResult(
    positions: Positions,
    optionId: number,
    timeoutSeconds: number,
): Promise<Pick<TradeResult, 'status' | 'pnl' | 'error'>> {
    return new Promise(resolve => {
        let externalId: number | undefined;
        let done = false;

        const finish = (result: Pick<TradeResult, 'status' | 'pnl' | 'error'>) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            positions.unsubscribeOnUpdatePosition(callback);
            resolve(result);
        };

        const timer = setTimeout(() => {
            finish({ status: 'TIMEOUT', pnl: 0, error: 'Result timeout' });
        }, timeoutSeconds * 1000);

        // Check if position is already synced (in case we missed the open event)
        const existing = positions.getOpenedPositions().find(p => p.orderIds.includes(optionId));
        if (existing) externalId = existing.externalId;

        const callback = (pos: Position) => {
            if (externalId === undefined && pos.orderIds.includes(optionId)) {
                externalId = pos.externalId;
            }
            if (externalId !== undefined && pos.externalId === externalId && pos.status === 'closed') {
                const pnl = pos.closeProfit ?? 0;
                const reason = pos.closeReason ?? '';
                const status: TradeResult['status'] = reason === 'win' ? 'WIN' : reason === 'equal' ? 'TIE' : 'LOSS';
                finish({ status, pnl });
            }
        };

        positions.subscribeOnUpdatePosition(callback);
    });
}

function errorResult(trade: TradeRequest, error: string): TradeResult {
    return { status: 'ERROR', pnl: 0, tradeId: 0, pair: trade.pair, direction: trade.direction, amount: trade.amount, error };
}
