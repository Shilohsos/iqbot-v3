/**
 * This is the entry point of this SDK for your application. Use it to implement the business logic of your application.
 */
export declare class ClientSdk {
    /**
     * Refreshable user profile class instance.
     */
    readonly userProfile: UserProfile;
    /**
     * Instance of WebSocket API client.
     * @private
     */
    private readonly wsApiClient;
    /**
     * Host extracted from WebSocket URL.
     * @private
     */
    private readonly host;
    /**
     * WebSocket connection state facade.
     * @private
     */
    private wsConnectionStateFacade;
    private wsConnectionStatePromise;
    /**
     * Balances facade cache.
     * @private
     */
    private balancesFacade;
    private balancesPromise;
    /**
     * Positions facade cache.
     * @private
     */
    private positionsFacade;
    private positionsPromise;
    /**
     * Orders facade cache.
     * @private
     */
    private ordersFacade;
    private ordersPromise;
    /**
     * Quotes facade cache.
     * @private
     */
    private quotesFacade;
    private quotesPromise;
    /**
     *  Actives facade cache.
     *  @private
     */
    private activesFacade;
    private activesPromise;
    /**
     * Currencies facade cache.
     * @private
     */
    private currenciesFacade;
    private currenciesPromise;
    /**
     * Blitz options facade cache.
     * @private
     */
    private blitzOptionsFacade;
    private blitzOptionsPromise;
    /**
     * Turbo options facade cache.
     * @private
     */
    private turboOptionsFacade;
    private turboOptionsPromise;
    /**
     * Binary options facade cache.
     * @private
     */
    private binaryOptionsFacade;
    private binaryOptionsPromise;
    /**
     * Digital options facade cache.
     * @private
     */
    private digitalOptionsFacade;
    private digitalOptionsPromise;
    /**
     * Margin forex facade cache.
     * @private
     */
    private marginForexFacade;
    private marginForexPromise;
    /**
     * Margin cfd facade cache
     * @private
     */
    private marginCfdFacade;
    private marginCfdPromise;
    /**
     * Margin crypto facade cache
     * @private
     */
    private marginCryptoFacade;
    private marginCryptoPromise;
    /**
     * Candles facade cache
     * @private
     */
    private candlesFacade;
    private candlesPromise;
    /**
     * Chats facade cache.
     * @private
     */
    private chatsFacade;
    private chatsPromise;
    /**
     * Host for static resources.
     * @private
     */
    private readonly staticHost;
    /**
     * Instruments availability cache.
     * @private
     */
    private instrumentsIsAvailable;
    /**
     * Translations facade cache.
     * @private
     */
    private translationsFacade;
    private translationsPromise;
    /**
     * Real-time chart data layer facade cache.
     * @private
     */
    private realTimeChartDataLayerFacade;
    /**
     * Consistency manager instance.
     * @private
     */
    private candlesConsistencyManagerFacade;
    private candlesConsistencyManagerPromise;
    /**
     * Creates instance of class.
     * @param userProfile - Information about the user on whose behalf your application is working.
     * @param wsApiClient - Instance of WebSocket API client.
     * @param options
     * @internal
     * @private
     */
    private constructor();
    /**
     * Extracts host from WebSocket URL.
     * @param wsUrl - WebSocket URL (e.g. wss://trade.broker.com/echo/websocket)
     * @returns Host without protocol and path (e.g. https://trade.broker.com)
     * @private
     */
    private extractHostFromWsUrl;
    private normalizeHost;
    /**
     * Creates instance of SDK entry point class.
     * This method establishes and authenticates connection to system API.
     * @param apiUrl - URL to system API. Usually it has the following format: `wss://ws.trade.{brand_domain}/echo/websocket`.
     * @param platformId - Identification number of your application.
     * @param authMethod - Authentication method used for connection authentication.
     * @param options
     */
    static create(apiUrl: string, platformId: number, authMethod: AuthMethod, options?: ClientSDKAdditionalOptions): Promise<ClientSdk>;
    /**
     * Shuts down instance of SDK entry point class.
     */
    shutdown(): Promise<void>;
    /**
     * Returns balances facade class.
     */
    balances(): Promise<Balances>;
    /**
     * Returns positions facade class.
     */
    positions(): Promise<Positions>;
    /**
     * Returns actives facade class.
     */
    actives(): Promise<Actives>;
    currencies(): Promise<Currencies>;
    /**
     * Returns quotes facade class.
     */
    quotes(): Promise<Quotes>;
    /**
     * Returns blitz options facade class.
     */
    blitzOptions(): Promise<BlitzOptions>;
    /**
     * Blitz options availability check.
     */
    blitzOptionsIsAvailable(): Promise<boolean>;
    /**
     * Returns turbo options facade class.
     */
    turboOptions(): Promise<TurboOptions>;
    /**
     * Turbo options availability check.
     */
    turboOptionsIsAvailable(): Promise<boolean>;
    /**
     * Returns binary options facade class.
     */
    binaryOptions(): Promise<BinaryOptions>;
    /**
     * Binary options availability check.
     */
    binaryOptionsIsAvailable(): Promise<boolean>;
    /**
     * Returns digital options facade class.
     */
    digitalOptions(): Promise<DigitalOptions>;
    /**
     * Digital options availability check.
     */
    digitalOptionsIsAvailable(): Promise<boolean>;
    /**
     * Returns margin forex facade class.
     */
    marginForex(): Promise<MarginForex>;
    /**
     * Margin forex availability check.
     */
    marginForexIsAvailable(): Promise<boolean>;
    /**
     * Returns margin cfd facade class.
     */
    marginCfd(): Promise<MarginCfd>;
    /**
     * Margin cfd availability check.
     */
    marginCfdIsAvailable(): Promise<boolean>;
    /**
     * Returns margin crypto facade class.
     */
    marginCrypto(): Promise<MarginCrypto>;
    /**
     * Margin crypto availability check.
     */
    marginCryptoIsAvailable(): Promise<boolean>;
    private instrumentIsAvailable;
    /**
     * Returns orders facade class.
     */
    orders(): Promise<Orders>;
    candles(): Promise<Candles>;
    /**
     * Returns chats facade class.
     */
    chats(): Promise<Chats>;
    realTimeChartDataLayer(activeId: number, size: number): Promise<RealTimeChartDataLayer>;
    /**
     * Returns ws current time.
     */
    currentTime(): Date;
    /**
     * Subscribe to WebSocket current time updates.
     * @param callback - Callback function that will be called when current time updates.
     */
    subscribeOnWsCurrentTime(callback: (currentTime: Date) => void): void;
    /**
     * Unsubscribe from WebSocket current time updates.
     * @param callback - Callback function to unsubscribe.
     */
    unsubscribeOnWsCurrentTime(callback: (currentTime: Date) => void): void;
    /**
     * Get WebSocket connection state facade.
     */
    wsConnectionState(): Promise<WsConnectionState>;
    /**
     * Returns translations facade class.
     */
    translations(): Promise<Translations>;
    private candlesConsistencyManager;
}
export interface ClientSDKAdditionalOptions {
    staticHost?: string;
    host?: string;
}
/**
 * Authenticates user in system APIs.
 */
export interface AuthMethod {
    /**
     * Should implement authentication logic in WebSocket API.
     * @param wsApiClient - Instance of WebSocket API client.
     */
    authenticateWsApiClient(wsApiClient: WsApiClient): Promise<boolean>;
}
/**
 * Storage interface for OAuth tokens.
 */
export interface OAuthTokensStorage {
    /**
     * Gets stored OAuth tokens.
     */
    get(): Promise<{
        accessToken: string;
        refreshToken?: string;
    }>;
    /**
     * Stores OAuth tokens.
     * @param tokens
     */
    set(tokens: {
        accessToken: string;
        refreshToken?: string;
    }): Promise<void>;
}
/**
 * Implements SSID authentication flow.
 */
export declare class SsidAuthMethod implements AuthMethod {
    private readonly ssid;
    /**
     * Accepts SSID for authentication.
     *
     * @param ssid - User's session ID.
     */
    constructor(ssid: string);
    /**
     * Authenticates client in WebSocket API.
     * @param wsApiClient - Instance of WebSocket API client.
     */
    authenticateWsApiClient(wsApiClient: WsApiClient): Promise<boolean>;
}
/**
 * Implements OAuth2 authentication flow.
 */
export declare class OAuthMethod implements AuthMethod {
    private readonly apiBaseUrl;
    private readonly clientId;
    private readonly redirectUri;
    private readonly scope;
    private readonly clientSecret?;
    private accessToken?;
    private refreshToken?;
    private readonly affId?;
    private readonly afftrack?;
    private readonly affModel?;
    private readonly tokensStorage?;
    private isBrowser;
    private attempts;
    /**
     * Accepts parameters for OAuth2 authentication.
     * @param apiBaseUrl - Base URL for API requests.
     * @param clientId - Client ID.
     * @param redirectUri - Redirect URI.
     * @param scope - Scope.
     * @param clientSecret - Client secret (optional, only for server-side applications).
     * @param accessToken - Access token (optional).
     * @param refreshToken - Refresh token (optional, only for server-side applications). @deprecated Use tokensStorage instead.
     * @param affId - Affiliate ID (optional).
     * @param afftrack - Affiliate tracking info (optional).
     * @param affModel - Affiliate model (optional).
     * @param tokensStorage - Storage for OAuth tokens (optional).
     */
    constructor(apiBaseUrl: string, clientId: number, redirectUri: string, scope: string, clientSecret?: string | undefined, accessToken?: string | undefined, refreshToken?: string | undefined, affId?: number | undefined, afftrack?: string | undefined, affModel?: string | undefined, tokensStorage?: OAuthTokensStorage | undefined);
    /**
     * Authenticates client in WebSocket API.
     * @param wsApiClient
     */
    authenticateWsApiClient(wsApiClient: WsApiClient): Promise<boolean>;
    private authenticateWsApiClientWithoutAttempts;
    private sleep;
    /**
     * Creates authorization URL and code verifier for PKCE flow.
     */
    createAuthorizationUrl(): Promise<{
        url: string;
        codeVerifier: string;
    }>;
    /**
     * Exchanges authorization code for access token and refresh token.
     * @param code
     * @param codeVerifier
     */
    issueAccessTokenWithAuthCode(code: string, codeVerifier: string): Promise<{
        accessToken: string;
        expiresIn: number;
        refreshToken?: string;
    }>;
    private generateCodeVerifier;
    private generateCodeChallenge;
    private randomUrlSafe;
    private base64url;
    refreshAccessToken(): Promise<{
        accessToken: string;
        expiresIn: number;
        refreshToken?: string;
    }>;
    private httpApiClient;
}
/**
 * @deprecated Use {@link OAuthMethod} instead.
 * Implements login/password authentication flow.
 */
export declare class LoginPasswordAuthMethod implements AuthMethod {
    private readonly httpApiUrl;
    private readonly login;
    private readonly password;
    private readonly httpApiClient;
    /**
     * Accepts login and password for authentication.
     *
     * @param httpApiUrl Base URL for HTTP API.
     * @param login User login.
     * @param password User password.
     */
    constructor(httpApiUrl: string, login: string, password: string);
    /**
     * Authenticates client in WebSocket API.
     * @param wsApiClient WebSocket API client instance.
     */
    authenticateWsApiClient(wsApiClient: WsApiClient): Promise<boolean>;
}
export declare class AuthMethodRequestedReconnectException extends Error {
    constructor(message?: string, options?: {
        cause?: unknown;
    });
}
/**
 * Don't use this class directly from your code. Use {@link ClientSdk.userProfile} field instead.
 *
 * User profile facade class. Stores information about the user on whose behalf your application is working.
 */
export declare class UserProfile {
    readonly userId: number;
    readonly firstName: string;
    readonly lastName: string;
    /**
     * Creates instance of class {@link UserProfile}.
     * @internal
     * @private
     * @param profile
     */
    private constructor();
    /**
     * Requests information about current user, puts the information to instance of class UserProfile and returns it.
     * @param wsApiClient - Instance of WebSocket API client.
     */
    static create(wsApiClient: WsApiClient): Promise<UserProfile>;
}
/**
 * Don't use this class directly from your code. Use {@link ClientSdk.balances} static method instead.
 *
 * Balances facade class. Stores information about user's balances. Keeps balances' information up to date.
 */
export declare class Balances {
    private readonly types;
    /**
     * Balances current state.
     * @private
     */
    private balances;
    /**
     * Create instance from DTO.
     * @param types - List of supported balance type ids.
     * @param balancesMsg - Balances data transfer object.
     * @param wsApiClient - Instance of WebSocket API client.
     * @internal
     * @private
     */
    private constructor();
    /**
     * Requests information about user's balances, subscribes on user's balances updates, puts the information to instance of class Balances and returns it.
     * @param wsApiClient - Instance of WebSocket API client.
     */
    static create(wsApiClient: WsApiClient): Promise<Balances>;
    /**
     * Returns list of user's balances. Every item of the list is reference to refreshable object.
     */
    getBalances(): Balance[];
    /**
     * Returns user's balance with specified ID. If balance does not exist then error will be thrown.
     * @param balanceId - Balance identification number.
     */
    getBalanceById(balanceId: number): Balance;
    /**
     * Adds specified callback to balance update subscribers' list.
     *
     * @param balanceId
     * @param callback
     */
    subscribeOnUpdateBalance(balanceId: number, callback: CallbackForBalanceUpdate): void;
    /**
     * Removes specified callback from balance update subscribers' list.
     *
     * @param balanceId
     * @param callback
     */
    unsubscribeOnUpdateBalance(balanceId: number, callback: CallbackForBalanceUpdate): void;
    /**
     * Updates instance from DTO.
     * @param balanceChangedMsg - Balances data transfer object.
     * @private
     */
    private updateBalance;
    /**
     * Updates instance from DTO.
     * @param balanceChangedMsg - Margin balances data transfer object.
     * @private
     */
    private updateMarginBalance;
}
/**
 * User's balance refreshable class.
 */
export declare class Balance {
    /**
     * User's balance identification number.
     */
    id: number;
    /**
     * User's balance type.
     */
    type: BalanceType | undefined;
    /**
     * Current amount of money on user's balance.
     */
    amount: number;
    /**
     * Current amount of bonuses.
     */
    bonusAmount: number;
    /**
     * User's balance currency code (ISO 4217).
     */
    currency: string;
    /**
     * User's identification number.
     */
    userId: number;
    /**
     * Is margin balance.
     */
    isMargin: boolean;
    /**
     * Gross Profit and Loss (PnL).
     */
    pnl: number | undefined;
    /**
     * Net Profit and Loss (PnL) after deductions.
     */
    pnlNet: number | undefined;
    /**
     * Total equity in the account.
     */
    equity: number | undefined;
    /**
     * Total equity in USD.
     */
    equityUsd: number | undefined;
    /**
     * Swap charges for holding positions overnight.
     */
    swap: number | undefined;
    /**
     * Dividends received or paid.
     */
    dividends: number | undefined;
    /**
     * Margin used by the account.
     */
    margin: number | undefined;
    /**
     * Available margin for new positions.
     */
    available: number | undefined;
    /**
     * Current amount of money on margin user's balance.
     */
    cash: number | undefined;
    /**
     * Margin level as a percentage.
     */
    marginLevel: number | undefined;
    /**
     * Stop out level where positions are closed to prevent losses.
     */
    stopOutLevel: number | undefined;
    /**
     * Balance updates observer.
     * @private
     */
    private onUpdateObserver;
    /**
     * Instance of WebSocket API client.
     * @private
     */
    private wsApiClient;
    /**
     * Initialises the class instance from DTO.
     * @param msg - Balance data transfer object.
     * @param wsApiClient
     * @internal
     * @private
     */
    constructor(msg: BalancesAvailableBalancesV1Balance, wsApiClient: WsApiClient);
    /**
     * Adds specified callback to balance update subscribers' list.
     * @param callback - Callback will be called for every change of balance.
     */
    subscribeOnUpdate(callback: CallbackForBalanceUpdate): void;
    /**
     * Removes specified callback from balance update subscribers' list.
     * @param callback - Callback for remove.
     */
    unsubscribeOnUpdate(callback: CallbackForBalanceUpdate): void;
    /**
     * Resets demo balance to 10000.
     */
    resetDemoBalance(): Promise<void>;
    /**
     * Returns available amount for margin trading.
     */
    availableForMarginAmount(): number;
    /**
     * Returns available amount for options trading.
     */
    availableForOptionsAmount(): number;
    /**
     * Updates the class instance from DTO.
     * @param msg - Balance data transfer object.
     * @private
     */
    update(msg: BalancesBalanceChangedV1): void;
    updateMargin(msg: MarginPortfolioBalanceV1): void;
    /**
     * Converts balance type id to text representation.
     * @param typeId - Balance type ID.
     * @private
     */
    private convertBalanceType;
}
/**
 * WebSocket connection state enum.
 */
export declare enum WsConnectionStateEnum {
    /**
     * WebSocket is connected and ready to use
     */
    Connected = "connected",
    /**
     * WebSocket is disconnected
     */
    Disconnected = "disconnected"
}
/**
 * Do not use this class directly from your code. Use {@link ClientSdk.wsConnectionState} static method instead.
 *
 * WebSocket connection state facade.
 */
export declare class WsConnectionState {
    private readonly wsApiClient;
    private onStateChangedObserver;
    private constructor();
    static create(wsApiClient: WsApiClient): Promise<WsConnectionState>;
    /**
     * Subscribe to WebSocket connection state changes.
     * @param callback - Callback function that will be called when the state changes.
     */
    subscribeOnStateChanged(callback: (state: WsConnectionStateEnum) => void): void;
    /**
     * Unsubscribe from WebSocket connection state changes.
     * @param callback - Callback function to unsubscribe.
     */
    unsubscribeOnStateChanged(callback: (state: WsConnectionStateEnum) => void): void;
}
/**
 * Don't use this class directly from your code. Use {@link ClientSdk.candles} static method instead.
 *
 * Candles facade class.
 */
export declare class Candles {
    /**
     * Instance of WebSocket API client.
     * @private
     */
    private wsApiClient;
    /**
     * Creates class instance.
     * @param wsApiClient - Instance of WebSocket API client.
     * @internal
     * @private
     */
    constructor(wsApiClient: WsApiClient);
    /**
     * Get candles for specified active.
     * @param activeId
     * @param size
     * @param options
     */
    getCandles(activeId: number, size: number, options?: {
        from?: number;
        to?: number;
        fromId?: number;
        toId?: number;
        count?: number;
        backoff?: number;
        onlyClosed?: boolean;
        kind?: string;
        splitNormalization?: boolean;
    } | undefined): Promise<Candle[]>;
}
/**
 * Candle data transfer object.
 */
export declare class Candle {
    id: number;
    from: number;
    to: number;
    open: number;
    close: number;
    min: number;
    max: number;
    volume: number;
    at: number | undefined;
    constructor(data: {
        id: number;
        from: number;
        to: number;
        open: number;
        close: number;
        min: number;
        max: number;
        volume: number;
        at: number | undefined;
    });
}
/**
 * Available translation groups.
 */
export declare enum TranslationGroup {
    Front = "front",
    Assets = "assets",
    Desktop = "desktop"
}
/**
 * Don't use this class directly from your code. Use {@link ClientSdk.translations} static method instead.
 *
 * Translations facade class.
 */
export declare class Translations {
    private translations;
    private reloadInterval;
    private readonly reloadIntervalMs;
    private readonly httpApiClient;
    private loadedLanguages;
    private loadedGroups;
    private inFlight;
    private readonly retryAttempts;
    private readonly retryBaseDelayMs;
    private readonly retryMaxDelayMs;
    private constructor();
    static create(host: string): Promise<Translations>;
    private startAutoReload;
    /**
     * Fetches translations from the server.
     * @param lang - Language code (e.g. 'en', 'ru')
     * @param groups - Array of translation groups to fetch
     */
    fetchTranslations(lang: string, groups: TranslationGroup[]): Promise<void>;
    private fetchTranslationsWithRetry;
    private tryFetchTranslationsOnce;
    private makeFetchKey;
    private calcRetryDelay;
    private sleep;
    /**
     * Gets translation for a specific key in the specified language.
     * @param key - Translation key (e.g. 'front.W')
     * @param lang - Language code (defaults to 'en')
     */
    getTranslation(key: string, lang?: string): string;
    /**
     * Stops automatic reloading of translations and cleans up resources.
     */
    close(): void;
}
/**
 * Callback for handle balance's update.
 */
export type CallbackForBalanceUpdate = (balance: Balance) => void;
/**
 * Balance type enum.
 */
export declare enum BalanceType {
    /**
     * Real balance type. This type is used for trading on real funds.
     */
    Real = "real",
    /**
     * Demo balance type. This type is used for practice/testing on non-real funds. Funds on demo balance can't be withdrawal.
     */
    Demo = "demo"
}
/**
 * Don't use this class directly from your code. Use {@link ClientSdk.actives} static method instead.
 *
 * Actives facade class. Stores information about actives. Keeps actives' information up to date.
 */
export declare class Actives {
    private wsApiClient;
    private translations;
    private activeCache;
    private activeData;
    private staticHost;
    constructor(wsApiClient: WsApiClient, staticHost: string, translations: Translations);
    /**
     * Returns active data with caching.
     * @param activeId - Active ID.
     */
    getActive(activeId: number): Promise<Active>;
}
/**
 * Active data transfer object.
 */
export declare class Active {
    /**
     * Active ID.
     */
    id: number;
    /**
     * Active name.
     */
    name: string;
    /**
     * Active description.
     */
    description: string;
    /**
     * Active localization key.
     */
    localizationKey: string;
    /**
     * Active image URL.
     */
    imageUrl: string;
    /**
     * Is active OTC.
     */
    isOtc: boolean;
    /**
     * Trading time from.
     */
    timeFrom: string;
    /**
     * Trading time to.
     */
    timeTo: string;
    /**
     * Active precision.
     */
    precision: number;
    /**
     * Active pip scale.
     */
    pipScale: number;
    /**
     * Active spread plus.
     */
    spreadPlus: number;
    /**
     * Active spread minus.
     */
    spreadMinus: number;
    /**
     * Active expiration days.
     */
    expirationDays: number[];
    /**
     * Active currency left side.
     */
    currencyLeftSide: string;
    /**
     * Active currency right side.
     */
    currencyRightSide: string;
    /**
     * Active type.
     */
    type: string;
    /**
     * Active min quantity.
     */
    minQty: number;
    /**
     * Active quantity step.
     */
    qtyStep: number;
    /**
     * Active quantity type.
     */
    typeQty: string;
    constructor(response: ActiveV5, staticHost: string, translations: Translations);
}
/**
 * Don't use this class directly from your code. Use {@link ClientSdk.currencies} static method instead.
 *
 * Currencies facade class. Stores information about currencies. Keeps currencies information up to date.
 */
export declare class Currencies {
    private wsApiClient;
    private currencyCache;
    private currencyData;
    private staticHost;
    constructor(wsApiClient: WsApiClient, staticHost: string);
    /**
     * Returns currency data with caching.
     * @param currencyCode - Currency code (example: USD).
     */
    getCurrency(currencyCode: string): Promise<Currency>;
}
/**
 * Currency data transfer object.
 */
export declare class Currency {
    /**
     * Currency ID.
     */
    id: number;
    /**
     * Currency name.
     */
    name: string;
    /**
     * Currency description.
     */
    description: string;
    /**
     * Currency symbol ($).
     */
    symbol: string;
    /**
     * Currency mask ($%s).
     */
    mask: string;
    /**
     * Currency is tradable.
     */
    isTradable: boolean;
    /**
     * Currency code
     */
    code: string;
    /**
     * Currency unit.
     */
    unit: number;
    /**
     * Currency rate.
     */
    rate: number;
    /**
     * Currency rate in USD.
     */
    rateUsd: number;
    /**
     * Currency min deal amount.
     */
    minDealAmount: number;
    /**
     * Currency max deal amount.
     */
    maxDealAmount: number;
    /**
     * Currency minor units.
     */
    minorUnits: number;
    /**
     * Currency image URL.
     */
    imageUrl: string;
    /**
     * Currency is crypto.
     */
    isCrypto: boolean;
    /**
     * Currency is inout.
     */
    isInout: boolean;
    /**
     * Currency interest rate.
     */
    interestRate: number;
    constructor(response: CurrencyV5, staticHost: string);
}
/**
 * RealTimeChartDataLayer provides real-time and historical candle data for a given activeId and candleSize.
 */
export declare class RealTimeChartDataLayer {
    private readonly wsApiClient;
    private readonly candlesFacade;
    private readonly candlesConsistencyManager;
    private readonly activeId;
    private readonly candleSize;
    private candles;
    private connected;
    private subscribed;
    private loadedFrom;
    private loadedTo;
    private firstCandleFrom;
    private currentReject;
    private wsUnsubscribe;
    private onUpdateObserver;
    private onConsistencyUpdateObserver;
    private candleQueue;
    private isProcessingQueue;
    private isRecoveringMissedCandles;
    private candlesMutationsLock;
    private static readonly MAX_CANDLES_PER_REQUEST;
    private constructor();
    static create(wsApiClient: WsApiClient, wsConnectionState: WsConnectionState, consistencyManager: CandlesConsistencyManager, candles: Candles, activeId: number, candleSize: number): Promise<RealTimeChartDataLayer>;
    /**
     * Returns the last candle for the activeId and candleSize.
     */
    getAllCandles(): Candle[];
    /**
     * Returns the first candle timestamp for the activeId and candleSize.
     */
    getFirstCandleFrom(): number | null;
    /**
     * Fetch candles for the activeId and candleSize.
     *
     * Limitation: A maximum of 1000 candles can be fetched in a single request.
     * Therefore, the 'from' parameter must be chosen so that the time range between 'from' and 'to'
     * does not exceed 1000 * candleSize seconds.
     *
     * Formula:
     *   (to - from) <= 1000 * candleSize
     *
     * If 'to' is not provided, it defaults to the latest loaded candle or the current time.
     *
     * Example: If candleSize = 60 (1 minute), the time range between 'from' and 'to'
     * must be less than or equal to 60,000 seconds (~16.6 hours).
     *
     * @param from - UNIX timestamp in seconds from which to fetch candles.
     */
    fetchAllCandles(from: number): Promise<Candle[]>;
    /**
     * Fetches candles for the activeId and candleSize within a specified time range.
     *
     * This method should be called iteratively with a maximum of 1000 candles per call (countBack <= 1000).
     * After each call, the "to" value should be updated to candles[0].from - 1 to fetch older data in steps.
     * This approach allows backward pagination of historical candles while avoiding overload or data gaps.
     *
     * @param to - Unix timestamp (in seconds) representing the end of the time range (inclusive).
     * @param countBack - Number of candles to fetch backward from the "to" timestamp.
     * @returns Promise resolving to an array of Candle objects.
     */
    fetchCandles(to: number, countBack: number): Promise<Candle[]>;
    private processQueue;
    /**
     * Subscribes to real-time updates for the last candle.
     * @param handler
     */
    subscribeOnLastCandleChanged(handler: (candle: Candle) => void): void;
    /**
     * Unsubscribes from real-time updates for the last candle.
     * @param handler
     */
    unsubscribeOnLastCandleChanged(handler: (candle: Candle) => void): void;
    /**
     * Subscribes to consistency updates for the candles.
     * @param handler
     */
    subscribeOnConsistencyRecovered(handler: (data: {
        from: number;
        to: number;
    }) => void): void;
    /**
     * Unsubscribes from consistency updates for the candles.
     * @param handler
     */
    unsubscribeOnConsistencyRecovered(handler: (data: {
        from: number;
        to: number;
    }) => void): void;
    private recoverGapsAsync;
    private handleRealtimeUpdate;
    private buildMissedCandlesRequest;
    private buildMissedCandlesFallbackRequest;
    private isOpenCandle;
    private isRequestErrorWithStatus;
    private errorDetails;
    private logMissedCandlesRecoveryError;
    private loadMissedCandlesOnReconnect;
}
declare class CandlesConsistencyManager {
    private readonly candlesFacade;
    private isProcessingQueue;
    private connected;
    private readonly maxRetries;
    private candleQueue;
    private currentQueueElement;
    constructor(wsConnectionState: WsConnectionState, candles: Candles);
    fetchCandles(fromId: number, toId: number, activeId: number, candleSize: number): Promise<Candle[]>;
    private processQueue;
}
/**
 * Don't use this class directly from your code. Use {@link ClientSdk.quotes} static method instead.
 *
 * Quotes facade class. Stores information about quotes (market data). Keeps quotes' information up to date.
 */
export declare class Quotes {
    /**
     * Instance of WebSocket API client.
     * @private
     */
    private wsApiClient;
    /**
     * Quotes current state.
     * @private
     */
    private currentQuotes;
    /**
     * Creates class instance.
     * @param wsApiClient - Instance of WebSocket API client.
     * @internal
     * @private
     */
    constructor(wsApiClient: WsApiClient);
    /**
     * Returns refreshable current quote instance for specified active.
     * @param activeId - Active ID for which the current quote is requested.
     */
    getCurrentQuoteForActive(activeId: number): Promise<CurrentQuote>;
}
/**
 * Active's current quote refreshable class.
 */
export declare class CurrentQuote {
    /**
     * Current quote's active ID.
     */
    activeId: number | undefined;
    /**
     * Current quote's time.
     */
    time: Date | undefined;
    /**
     * Current quote's ask (offer) price.
     */
    ask: number | undefined;
    /**
     * Current quote's bid price.
     */
    bid: number | undefined;
    /**
     * Current quote's middle price between ask and bid. `value=(ask+bid)/2`. This price is used for buy/expire option's orders.
     */
    value: number | undefined;
    /**
     * Current quote's phase.
     *
     * `T` - quote is inside regular trading session.
     *
     * `C` - quote is outside any trading session.
     */
    phase: string | undefined;
    /**
     * Position updates observer.
     * @private
     */
    private onUpdateObserver;
    /**
     * Adds specified callback to current quote update subscribers' list.
     * @param callback - Callback will be called for every change of current quote.
     */
    subscribeOnUpdate(callback: CallbackForCurrentQuoteUpdate): void;
    /**
     * Removes specified callback from current quote update subscribers' list.
     * @param callback - Callback for remove.
     */
    unsubscribeOnUpdate(callback: CallbackForCurrentQuoteUpdate): void;
    /**
     * Updates current quote from DTO.
     * @param msg - Current quote data transfer object.
     * @private
     */
    update(msg: {
        /**
         * Active ID.
         */
        activeId: number;
        /**
         * Quote UNIX time.
         */
        time: number;
        /**
         * Quote ask (offer) price.
         */
        ask: number;
        /**
         * Quote bid price.
         */
        bid: number;
        /**
         * Quote middle price.
         */
        value: number;
        /**
         * Quote trading phase.
         */
        phase: string;
    }): void;
}
/**
 * Callback for handle current quote update.
 */
export type CallbackForCurrentQuoteUpdate = (currentQuote: CurrentQuote) => void;
/**
 * Don't use this class directly from your code. Use the following methods instead:
 *
 * * {@link ClientSdk.chats}
 *
 * Chats facade class. Provides access to chat rooms and real-time chat messages.
 */
export declare class Chats {
    /**
     * Instance of WebSocket API client.
     * @private
     */
    private readonly wsApiClient;
    /**
     * Cached list of available chat rooms.
     * @private
     */
    private chatRooms;
    /**
     * Active chat subscriptions keyed by room ID.
     * @private
     */
    private activeSubscriptions;
    /**
     * Chat message observers keyed by room ID.
     * @private
     */
    private messageObservers;
    /**
     * Creates class instance.
     * @param wsApiClient - Instance of WebSocket API client.
     * @internal
     * @private
     */
    private constructor();
    /**
     * Creates and initializes Chats facade. Fetches available chat rooms on creation.
     * @param wsApiClient - Instance of WebSocket API client.
     * @internal
     */
    static create(wsApiClient: WsApiClient): Promise<Chats>;
    /**
     * Fetches list of available chat rooms from the server.
     * @private
     */
    private fetchChatRooms;
    /**
     * Returns the cached list of available chat rooms.
     */
    getChatRooms(): ReadonlyArray<ChatRoom>;
    /**
     * Subscribes to real-time messages for the specified chat room.
     * @param chatId - Chat room ID to subscribe to.
     * @param callback - Callback that will be called for each incoming message batch.
     */
    subscribeChat(chatId: string, callback: CallbackForChatMessageEvent): Promise<void>;
    /**
     * Unsubscribes a specific callback from chat room messages.
     * If no callbacks remain, the WebSocket subscription is also removed.
     * @param chatId - Chat room ID to unsubscribe from.
     * @param callback - The callback to remove.
     */
    unsubscribeChat(chatId: string, callback: CallbackForChatMessageEvent): Promise<void>;
    /**
     * Cleans up all active chat subscriptions.
     */
    close(): void;
}
/**
 * Callback for handling chat message events.
 */
export type CallbackForChatMessageEvent = (event: ChatMessage) => void;
/**
 * Chat room information.
 */
export declare class ChatRoom {
    /**
     * Chat room ID.
     */
    readonly id: string;
    /**
     * Chat room type (e.g. "global", "notification", "support").
     */
    readonly type: string;
    /**
     * Chat room locale (e.g. "en_US") or null.
     */
    readonly locale: string | null;
    /**
     * Chat room subject.
     */
    readonly subject: string;
    /**
     * Chat room internal name.
     */
    readonly name: string;
    /**
     * Localized chat room name.
     */
    readonly nameLoc: string;
    /**
     * Chat room icon URL.
     */
    readonly icon: string;
    /**
     * Chat room icon 2x URL.
     */
    readonly icon2x: string;
    /**
     * Whether the chat uses real names for senders.
     */
    readonly useRealName: boolean;
    /**
     * Whether the chat is public.
     */
    readonly isPublic: boolean;
    /**
     * Whether writing to the chat is allowed.
     */
    readonly isWrite: boolean;
    /**
     * Whether the chat is regulated.
     */
    readonly isRegulated: boolean | null;
    /**
     * Whether there are unread messages.
     */
    readonly isUnreadMessages: boolean;
    /**
     * Last read message ID.
     */
    readonly lastReadMessageId: string | number;
    /**
     * Number of online users in the chat.
     */
    readonly onlineUsers: number;
    constructor(data: any);
}
/**
 * Incoming chat message event containing one or more messages.
 */
export declare class ChatMessageEvent {
    /**
     * Array of chat messages received in this event.
     */
    readonly messages: ChatMessage[];
    constructor(data: any);
}
/**
 * Individual chat message.
 */
export declare class ChatMessage {
    /**
     * Message ID.
     */
    readonly id: string;
    /**
     * Room ID this message belongs to.
     */
    readonly roomId: string;
    /**
     * Message type.
     */
    readonly type: string;
    /**
     * Message text content.
     */
    readonly text: string;
    /**
     * Sender display name.
     */
    readonly sender: string;
    /**
     * Sender user ID.
     */
    readonly senderId: number;
    /**
     * Sender country flag code.
     */
    readonly senderFlag: string;
    /**
     * Sender avatar URL.
     */
    readonly senderAvatarUrl: string;
    /**
     * Whether the sender is a VIP user.
     */
    readonly isSenderVip: boolean;
    /**
     * Whether the sender is a professional.
     */
    readonly isSenderProfessional: boolean;
    /**
     * Whether the sender is an admin.
     */
    readonly isSenderAdmin: boolean;
    /**
     * Whether the sender is a system account.
     */
    readonly isSenderSystem: boolean;
    /**
     * Message timestamp in milliseconds.
     */
    readonly date: Date;
    /**
     * Whether the message has been removed.
     */
    readonly removed: boolean;
    /**
     * Whether the message is visible to author only.
     */
    readonly authorOnly: boolean;
    /**
     * Message attachments.
     */
    readonly attachments: any[];
    /**
     * Previous message ID in the room.
     */
    readonly previousId: string | null;
    constructor(data: any);
}
/**
 * Don't use this class directly from your code. Use the following methods instead:
 *
 * * {@link ClientSdk.positions}
 *
 * Positions facade class. Stores information about opened positions. Keeps positions' information up to date.
 */
export declare class Positions {
    /**
     * Positions current state.
     * @private
     */
    private positions;
    /**
     * Positions history.
     * @private
     */
    private positionsHistoryFacade;
    /**
     * Positions' history array.
     * @private
     */
    private positionsHistory;
    /**
     * Positions' IDs cache.
     * @private
     */
    private positionsIds;
    /**
     * Positions updates observer.
     * @private
     */
    private onUpdatePositionObserver;
    /**
     * Timer for periodical actives list update.
     * @private
     */
    private intervalId;
    /**
     * Instance of WebSocket API client.
     * @private
     */
    private wsApiClient;
    /**
     * Actives facade.
     * @private
     */
    private actives;
    /**
     * Digital options facade.
     * @private
     */
    private digitalOptions;
    /**
     * List of supported instrument types.
     * @private
     */
    private instrumentTypes;
    /**
     * Just private constructor. Just private constructor. Use {@link Positions.create create} instead.
     * @internal
     * @private
     */
    private constructor();
    /**
     * Subscribes on opened positions' updates, requests current state of opened positions, puts the current state to instance of class Positions and returns it.
     * @param wsApiClient - Instance of WebSocket API client.
     * @param userId - User's identification number.
     * @param actives - Actives facade.
     */
    static create(wsApiClient: WsApiClient, userId: number, actives: Actives, state: WsConnectionState): Promise<Positions>;
    /**
     * Subscribes on position's updates.
     *
     * @private
     */
    private subscribePositionChanged;
    /**
     * Subscribes on positions states updates.
     * @private
     */
    private subscribePositionsState;
    /**
     * Synchronizes old active positions.
     * @private
     */
    private syncOldActivePositions;
    /**
     * @deprecated. Use {@link Positions.getOpenedPositions} instead.
     * Returns list of all positions.
     */
    getAllPositions(): Position[];
    /**
     * Returns list of opened positions.
     */
    getOpenedPositions(): Position[];
    /**
     * Returns positions history.
     */
    getPositionsHistory(): PositionsHistory;
    /**
     * Checks if a given order ID matches any of the order IDs associated with a position.
     * @param orderId
     * @param position
     */
    isOrderMatchingPosition(orderId: number, position: Position): boolean;
    /**
     * Adds specified callback to position update subscribers' list.
     * @param callback - Callback will be called for every change of position.
     */
    subscribeOnUpdatePosition(callback: CallbackForPositionUpdate): void;
    /**
     * Removes specified callback from position update subscribers' list.
     * @param callback - Callback for remove.
     */
    unsubscribeOnUpdatePosition(callback: CallbackForPositionUpdate): void;
    /**
     * Updates instance from DTO.
     * @param msg - Positions state data transfer object.
     * @private
     */
    private syncPositionsStateFromEvent;
    /**
     * Updates instance from DTO.
     * @param msg - Position data transfer object.
     * @private
     */
    private syncPositionFromResponse;
    /**
     * Updates instance from DTO.
     * @param position - Position object.
     * @private
     */
    private syncPosition;
    /**
     * Updates instance from DTO.
     * @param msg - Position data transfer object.
     * @private
     */
    private syncPositionFromEvent;
    private subscribePositions;
    /**
     * Closes the instance.
     */
    close(): void;
}
/**
 * Don't use this class directly from your code. Use the following methods instead:
 *
 * * {@link ClientSdk.orders}
 *
 * Orders facade class. Stores information about opened orders. Keeps order's information up to date.
 */
export declare class Orders {
    /**
     * Orders current state.
     * @private
     */
    private orders;
    /**
     * Orders updates observer.
     * @private
     */
    private onUpdateOrderObserver;
    /**
     * Instance of WebSocket API client.
     * @private
     */
    private wsApiClient;
    /**
     * List of supported instrument types.
     * @private
     */
    private instrumentTypes;
    /**
     * Just private constructor. Just private constructor. Use {@link Orders.create create} instead.
     * @internal
     * @private
     */
    private constructor();
    /**
     * Subscribes on opened order's updates, requests current state of opened order's, puts the current state to instance of class Orders and returns it.
     * @param wsApiClient - Instance of WebSocket API client.
     * @param userId
     * @param balanceIds
     */
    static create(wsApiClient: WsApiClient, userId: number, balanceIds: number[]): Promise<Orders>;
    /**
     * Subscribes on order's updates.
     *
     * @private
     */
    private subscribeOrderChanged;
    /**
     * Synchronizes old active orders.
     * @private
     */
    private syncOldActiveOrders;
    /**
     * Returns list of all orders.
     */
    getAllOrders(): Order[];
    /**
     * Checks if a given position associated with an order.
     * @param position
     * @param order
     */
    isPositionMatchingOrder(position: Position, order: Order): boolean;
    /**
     * Adds specified callback to order update subscribers' list.
     * @param callback - Callback will be called for every change of order.
     */
    subscribeOnUpdateOrder(callback: CallbackForOrderUpdate): void;
    /**
     * Removes specified callback from order update subscribers' list.
     * @param callback - Callback for remove.
     */
    unsubscribeOnUpdateOrder(callback: CallbackForOrderUpdate): void;
    /**
     * Updates instance from DTO.
     * @param msg - Order data transfer object.
     * @private
     */
    private syncOrderFromResponse;
    /**
     * Updates instance from DTO.
     * @param msg - Order data transfer object.
     * @private
     */
    private syncOrderFromEvent;
}
export declare class Order {
    /**
     * Order's identification number.
     */
    id: number | undefined;
    /**
     * Order status.
     */
    status: string | undefined;
    /**
     * Instrument type.
     */
    instrumentType: string | undefined;
    /**
     * Kind of order.
     */
    kind: string | undefined;
    /**
     * Order position ID.
     */
    positionId: string | undefined;
    /**
     * User ID.
     */
    userId: number | undefined;
    /**
     * User's balance ID.
     */
    userBalanceId: number | undefined;
    /**
     * Instance of WebSocket API client.
     * @private
     */
    private wsApiClient;
    constructor(wsApiClient: WsApiClient);
    /**
     * Synchronises order from DTO.
     * @param msg - Order data transfer object.
     * @private
     */
    syncFromResponse(msg: PortfolioOrdersV2Order): void;
    /**
     * Synchronises order from DTO.
     * @param msg - Order data transfer object.
     * @private
     */
    syncFromEvent(msg: PortfolioOrderChangedV2): void;
    cancel(): Promise<void>;
}
/**
 * Callback for handle position's update.
 */
export type CallbackForOrderUpdate = (order: Order) => void;
declare class PositionsHistory {
    /**
     * Positions history.
     * @private
     */
    private readonly positions;
    /**
     * User ID.
     * @private
     */
    private readonly userId;
    /**
     * Instance of WebSocket API client.
     * @private
     */
    private readonly wsApiClient;
    /**
     * Start time for positions history.
     * @private
     */
    private startTime;
    /**
     * Limit of positions per page.
     * @private
     */
    private readonly limit;
    /**
     * Offset for positions history.
     * @private
     */
    private offset;
    /**
     * Flag for previous page.
     * @private
     */
    private prevPage;
    constructor(wsApiClient: WsApiClient, userId: number, positions: Position[]);
    /**
     * Fetches previous page of positions history.
     */
    fetchPrevPage(): Promise<void>;
    getPositionHistory(externalId: number): Promise<Position | undefined>;
    /**
     * Checks if previous page exists.
     */
    hasPrevPage(): boolean;
    /**
     * Returns list of loaded pages of positions history.
     *
     * Note: call after {@link fetchPrevPage} method.
     */
    getPositions(): Position[];
}
/**
 * Callback for handle position's update.
 */
export type CallbackForPositionUpdate = (position: Position) => void;
/**
 * Position refreshable class.
 */
export declare class Position {
    /**
     * Position's identification number ( position external ID ).
     */
    externalId: number | undefined;
    /**
     * Position's internal ID. ( Positions across different instrument types can have the same internal_id )
     */
    internalId: string | undefined;
    /**
     * Position's active ID.
     */
    activeId: number | undefined;
    /**
     * Position's balance ID.
     */
    balanceId: number | undefined;
    /**
     * Amount of profit by the position.
     */
    closeProfit: number | undefined;
    /**
     * Quote price at which the position was closed.
     */
    closeQuote: number | undefined;
    /**
     * Position's close reason.
     */
    closeReason: string | undefined;
    /**
     * Current quote price.
     */
    currentQuote: number | undefined;
    /**
     * The time at which the position was closed.
     */
    closeTime: Date | undefined;
    /**
     * Expected profit for the position.
     */
    expectedProfit: number | undefined;
    /**
     * Type of trading instrument.
     */
    instrumentType: string | undefined;
    /**
     * The amount of the initial investment.
     */
    invest: number | undefined;
    /**
     * Quote price at which the position was opened.
     */
    openQuote: number | undefined;
    /**
     * The time at which the position was opened.
     */
    openTime: Date | undefined;
    /**
     * Expected PnL for the position.
     */
    pnl: number | undefined;
    /**
     * Expected PnL Net for the position.
     */
    pnlNet: number | undefined;
    /**
     * PnL with which the position was closed.
     */
    pnlRealized: number | undefined;
    /**
     * Quote time at which the position was opened.
     */
    quoteTimestamp: Date | undefined;
    /**
     * Current quote time.
     */
    currentQuoteTimestamp: Date | undefined;
    /**
     * Position's status.
     */
    status: string | undefined;
    /**
     * Position's user ID.
     */
    userId: number | undefined;
    /**
     * Realized profit from selling the position at this moment.
     */
    sellProfit: number | undefined;
    /**
     * List of order IDs.
     */
    orderIds: number[];
    /**
     * Active information.
     */
    active: Active | undefined;
    /**
     * Expiration time for the position.
     */
    expirationTime: Date | undefined;
    /**
     * Direction of the position.
     */
    direction: string | undefined;
    /**
     * Version of position. Used for filter old versions of position's state.
     * @private
     */
    private version;
    /**
     * Instance of WebSocket API client.
     * @private
     */
    private wsApiClient;
    constructor(wsApiClient: WsApiClient);
    /**
     * Synchronises position from DTO.
     * @param msg - Position data transfer object.
     * @private
     */
    syncFromResponse(msg: PortfolioPositionsV4Position): void;
    /**
     * Synchronises position from DTO.
     * @param msg - Position data transfer object.
     * @private
     */
    syncFromHistoryResponse(msg: PortfolioPositionsHistoryV2Position): void;
    /**
     * Synchronises position from DTO.
     * @param msg - Position data transfer object.
     * @private
     */
    syncFromEvent(msg: PortfolioPositionChangedV3): void;
    /**
     * Synchronises position from DTO.
     * @param msg - Position state data transfer object.
     * @private
     */
    syncFromStateEvent(msg: PortfolioPositionsStateV1Position): void;
    sell(): Promise<void>;
}
/**
 * Don't use this class directly from your code. Use {@link ClientSdk.blitzOptions} static method instead.
 *
 * Blitz options facade class.
 */
export declare class BlitzOptions {
    /**
     * Actives current state.
     * @private
     */
    private actives;
    /**
     * Instance of WebSocket API client.
     * @private
     */
    private readonly wsApiClient;
    /**
     * Timer for periodical actives list update.
     * @private
     */
    private intervalId;
    /**
     * Creates instance from DTO.
     * @param activesMsg - actives data transfer object.
     * @param wsApiClient - Instance of WebSocket API client.
     * @internal
     * @private
     */
    private constructor();
    /**
     * Requests information about blitz options actives, runs timer for periodical actives list update, puts the information to instance of class BlitzOptions and returns it.
     * @param wsApiClient - Instance of WebSocket API client.
     */
    static create(wsApiClient: WsApiClient): Promise<BlitzOptions>;
    /**
     * Returns list of blitz options actives.
     */
    getActives(): BlitzOptionsActive[];
    /**
     * Returns refreshable instance of class BlitzOptionsActive by specified active ID. If active doesn't exist then error will be thrown.
     * @param activeId - Active identification number.
     */
    getActive(activeId: number): BlitzOptionsActive;
    /**
     * Makes request for buy blitz option.
     * @param active - The asset for which the option is purchased.
     * @param direction - Direction of price change.
     * @param expirationSize - How many seconds after buying an option should the option expire. A list of available expiration sizes can be found {@link BlitzOptionsActive.expirationTimes}.
     * @param price - The amount of the initial investment.
     * @param balance - The balance from which the initial investment will be written off and upon successful closing of the position, profit will be credited to this balance.
     */
    buy(active: BlitzOptionsActive, direction: BlitzOptionsDirection, expirationSize: number, price: number, balance: Balance): Promise<BlitzOptionsOption>;
    /**
     * Update instance from DTO.
     * @param activesMsg - Actives data transfer object.
     * @private
     */
    private updateActives;
    /**
     * Closes the instance.
     */
    close(): void;
}
/**
 * Instrument types.
 */
export declare enum InstrumentType {
    BinaryOption = "binary-option",
    DigitalOption = "digital-option",
    TurboOption = "turbo-option",
    BlitzOption = "blitz-option",
    MarginForex = "marginal-forex",
    MarginCfd = "marginal-cfd",
    MarginCrypto = "marginal-crypto"
}
/**
 * Margin Trading TPSL types.
 */
export declare enum MarginTradingTPSLType {
    Price = "price",
    Pips = "pips",
    Delta = "delta",
    Pnl = "pnl"
}
/**
 * Margin Trading TPSL class.
 */
export declare class MarginTradingTPSL {
    readonly type: string;
    readonly value: number;
    constructor(type: string, value: number);
}
/**
 * Blitz options direction of price change.
 */
export declare enum BlitzOptionsDirection {
    /**
     * The decision is that the price will go up.
     */
    Call = "call",
    /**
     * The decision is that the price will go down.
     */
    Put = "put"
}
/**
 * Blitz options active refreshable class.
 */
export declare class BlitzOptionsActive {
    /**
     * Active's identification number.
     */
    id: number;
    /**
     * Active's localization key
     */
    localizationKey: string;
    /**
     * Active's ticker (symbol).
     */
    ticker: string;
    /**
     * Is trading suspended on the active.
     */
    isSuspended: boolean;
    /**
     * Expiration times (sizes) available for the active.
     */
    expirationTimes: number[];
    /**
     * The commission is taken from 100% of the profit. Therefore, income percent can be calculated using the following formula: `profitIncomePercent=100-profitCommissionPercent`.
     */
    profitCommissionPercent: number;
    /**
     * Active's trading schedule.
     */
    schedule: BlitzOptionsActiveTradingSession[];
    /**
     * Creates class instance from DTO.
     * @param msg - Actives' data transfer object.
     * @internal
     * @private
     */
    constructor(msg: InitializationDataV3BlitzActive);
    /**
     * Checks whether an option on an active can be purchased at a specified time.
     * @param at - Time for which the check is performed.
     */
    canBeBoughtAt(at: Date): boolean;
    /**
     * Returns profit percent for the active.
     */
    profitPercent(): number;
    /**
     * Updates the instance from DTO.
     * @param msg - Active's data transfer object.
     * @private
     */
    update(msg: InitializationDataV3BlitzActive): void;
}
/**
 * Blitz options active trading session class.
 */
export declare class BlitzOptionsActiveTradingSession {
    /**
     * Start time of trading session.
     */
    from: Date;
    /**
     * End time of trading session.
     */
    to: Date;
    /**
     * Initialises class instance from DTO.
     * @param fromTs - Unix time of session start.
     * @param toTs - Unix time of session end.
     */
    constructor(fromTs: number, toTs: number);
}
/**
 * Blitz options option order class.
 */
export declare class BlitzOptionsOption {
    /**
     * Option's ID.
     */
    id: number;
    /**
     * Option's active ID.
     */
    activeId: number;
    /**
     * Option's price direction.
     */
    direction: BlitzOptionsDirection;
    /**
     * Option's expiration time.
     */
    expiredAt: Date;
    /**
     * Option's amount of the initial investment.
     */
    price: number;
    /**
     * Option's profit income percent.
     */
    profitIncomePercent: number;
    /**
     * The time when the option was purchased.
     */
    openedAt: Date;
    /**
     * The {@link CurrentQuote.value value} of the quote at which the option was purchased.
     */
    openQuoteValue: number;
    /**
     * Creates class instance from DTO.
     * @param msg - Option's data transfer object.
     * @internal
     * @private
     */
    constructor(msg: BinaryOptionsOptionV1);
}
/**
 * Don't use this class directly from your code. Use {@link ClientSdk.turboOptions} static method instead.
 *
 * Turbo options facade class.
 */
export declare class TurboOptions {
    /**
     * Actives current state.
     * @private
     */
    private actives;
    /**
     * Instance of WebSocket API client.
     * @private
     */
    private readonly wsApiClient;
    /**
     * Timer for periodical actives list update.
     * @private
     */
    private intervalId;
    /**
     * Creates class instance.
     * @param activesMsg - Actives data transfer object.
     * @param wsApiClient - Instance of WebSocket API client.
     * @internal
     * @private
     */
    private constructor();
    /**
     * Requests information about turbo options actives, runs timer for periodical actives list update, puts the information to instance of class TurboOptions and returns it.
     * @param wsApiClient - Instance of WebSocket API client.
     */
    static create(wsApiClient: WsApiClient): Promise<TurboOptions>;
    /**
     * Returns list of turbo options actives.
     */
    getActives(): TurboOptionsActive[];
    /**
     * Returns refreshable instance of class TurboOptionsActive by specified active ID. If active doesn't exist then error will be thrown.
     * @param activeId - Active identification number.
     */
    getActive(activeId: number): TurboOptionsActive;
    /**
     * Makes request for buy turbo option.
     * @param instrument - The instrument for which the option is purchased.
     * @param direction - Direction of price change.
     * @param price - The amount of the initial investment.
     * @param balance - The balance from which the initial investment will be written off and upon successful closing of the position, profit will be credited to this balance.
     */
    buy(instrument: TurboOptionsActiveInstrument, direction: TurboOptionsDirection, price: number, balance: Balance): Promise<TurboOptionsOption>;
    /**
     * Updates instance from DTO.
     * @param activesMsg - Actives data transfer object.
     * @private
     */
    private updateActives;
    /**
     * Closes the instance.
     */
    close(): void;
}
/**
 * Turbo options direction of price change.
 */
export declare enum TurboOptionsDirection {
    /**
     * The decision is that the price will go up.
     */
    Call = "call",
    /**
     * The decision is that the price will go down.
     */
    Put = "put"
}
/**
 * Turbo options active refreshable class.
 */
export declare class TurboOptionsActive {
    /**
     * Active's identification number.
     */
    id: number;
    /**
     * Active's localization key
     */
    localizationKey: string;
    /**
     * How many seconds before expiration time the ability to buyback options for this active will not be allowed.
     */
    buybackDeadtime: number;
    /**
     * How many seconds before expiration time the ability to purchase options for this active will not be allowed.
     */
    deadtime: number;
    /**
     * Active's ticker (symbol).
     */
    ticker: string;
    /**
     * Is buyback available in the active.
     */
    isBuyback: boolean;
    /**
     * Is trading suspended on the active.
     */
    isSuspended: boolean;
    /**
     * Count of nearest options available for the active.
     */
    optionCount: number;
    /**
     * Expiration times (sizes) available for the active.
     */
    expirationTimes: number[];
    /**
     * The commission is taken from 100% of the profit. Therefore, income percent can be calculated using the following formula: `profitIncomePercent=100-profitCommissionPercent`.
     */
    profitCommissionPercent: number;
    /**
     * Active's trading schedule.
     */
    schedule: TurboOptionsActiveTradingSession[];
    /**
     * An object with the current time obtained from WebSocket API.
     * @private
     */
    private readonly currentTime;
    /**
     * Instruments facade class instance.
     * @private
     */
    private instrumentsFacade;
    /**
     * Creates instance from DTO.
     * @param msg - Active's data transfer object.
     * @param currentTime - An object with the current time obtained from WebSocket API.
     * @internal
     * @private
     */
    constructor(msg: InitializationDataV3TurboActive, currentTime: WsApiClientCurrentTime);
    /**
     * Returns turbo options active's instruments facade.
     */
    instruments(): Promise<TurboOptionsActiveInstruments>;
    /**
     * Updates the instance from DTO.
     * @param msg - Active's data transfer object.
     * @private
     */
    update(msg: InitializationDataV3TurboActive): void;
    /**
     * Checks whether an option on an active can be purchased at a specified time.
     * @param at - Time for which the check is performed.
     */
    canBeBoughtAt(at: Date): boolean;
    /**
     * Closes the instance.
     */
    close(): void;
}
/**
 * Turbo options active trading session class.
 */
export declare class TurboOptionsActiveTradingSession {
    /**
     * Start time of trading session.
     */
    from: Date;
    /**
     * End time of trading session.
     */
    to: Date;
    /**
     * Initialises class instance from DTO.
     * @param fromTs - Unix time of session start.
     * @param toTs - Unix time of session end.
     */
    constructor(fromTs: number, toTs: number);
}
/**
 * Turbo options active's instruments facade class. Periodically generates active's instruments based on active's settings.
 */
export declare class TurboOptionsActiveInstruments {
    private active;
    private readonly currentTime;
    /**
     * Instruments current state.
     * @private
     */
    private instruments;
    /**
     * Timer for periodical actives list update.
     * @private
     */
    private intervalId;
    /**
     * Creates class instance.
     * @param active - Active.
     * @param currentTime - An object with the current time obtained from WebSocket API.
     * @internal
     * @private
     */
    private constructor();
    /**
     * Runs timer for periodical active's instruments list generation, creates instance of this class and returns it.
     * @param active - The active for which instruments are generated.
     * @param currentTime - An object with the current time obtained from WebSocket API.
     */
    static create(active: TurboOptionsActive, currentTime: WsApiClientCurrentTime): Promise<TurboOptionsActiveInstruments>;
    /**
     * Returns list of instruments available for buy at specified time.
     * @param at - Time for which the check is performed.
     */
    getAvailableForBuyAt(at: Date): TurboOptionsActiveInstrument[];
    /**
     * Generates instruments.
     * @private
     */
    private generateInstruments;
    /**
     * Closes the instance.
     */
    close(): void;
}
/**
 * Turbo options active's instrument refreshable class.
 */
export declare class TurboOptionsActiveInstrument {
    readonly activeId: number;
    readonly expirationSize: number;
    readonly expiredAt: Date;
    deadtime: number;
    profitCommissionPercent: number;
    /**
     * Creates instance of the class.
     * @param activeId - Instrument's active ID.
     * @param expirationSize - Instrument's expiration size.
     * @param expiredAt - The time when the instrument will be expired.
     * @param deadtime - How many seconds before expiration time the ability to purchase options for this instrument will not be allowed.
     * @param profitCommissionPercent - The commission is taken from 100% of the profit. Therefore, income percent can be calculated using the following formula: `profitIncomePercent=100-profitCommissionPercent`.
     * @internal
     * @private
     */
    constructor(activeId: number, expirationSize: number, expiredAt: Date, deadtime: number, profitCommissionPercent: number);
    /**
     * Checks availability for buy option at specified time.
     * @param at - Time for which the check is performed.
     */
    isAvailableForBuyAt(at: Date): boolean;
    /**
     * Returns the time until which it is possible to open trades that will fall into the current expiration.
     * @returns {Date}
     */
    purchaseEndTime(): Date;
    /**
     * Returns the remaining duration in milliseconds for which it is possible to purchase options.
     * @param {Date} currentTime - The current time.
     * @returns {number} - The remaining duration in milliseconds.
     */
    durationRemainingForPurchase(currentTime: Date): number;
    /**
     * Returns profit percent.
     */
    profitPercent(): number;
    /**
     * Updates the instance from DTO.
     * @param deadtime - How many seconds before expiration time the ability to purchase options for this instrument will not be allowed.
     * @private
     */
    update(deadtime: number): void;
}
/**
 * Turbo options option order class.
 */
export declare class TurboOptionsOption {
    /**
     * Option's ID.
     */
    id: number;
    /**
     * Option's active ID.
     */
    activeId: number;
    /**
     * Option's price direction.
     */
    direction: TurboOptionsDirection;
    /**
     * Option's expiration time.
     */
    expiredAt: Date;
    /**
     * Option's amount of the initial investment.
     */
    price: number;
    /**
     * Option's profit income percent.
     */
    profitIncomePercent: number;
    /**
     * The time when the option was purchased.
     */
    openedAt: Date;
    /**
     * The {@link CurrentQuote.value value} of the quote at which the option was purchased.
     */
    openQuoteValue: number;
    /**
     * Create instance from DTO.
     * @param msg - Option's data transfer object.
     * @internal
     * @private
     */
    constructor(msg: BinaryOptionsOptionV1);
}
/**
 * Don't use this class directly from your code. Use {@link ClientSdk.binaryOptions} static method instead.
 *
 * Binary options facade class.
 */
export declare class BinaryOptions {
    /**
     * Actives current state.
     * @private
     */
    private actives;
    /**
     * Instance of WebSocket API client.
     * @private
     */
    private readonly wsApiClient;
    /**
     * Timer for periodical actives list update.
     * @private
     */
    private intervalId;
    /**
     * Creates instance from DTO.
     * @param activesMsg - actives data transfer object.
     * @param wsApiClient - Instance of WebSocket API client.
     * @internal
     * @private
     */
    private constructor();
    /**
     * Requests information about binary options actives, runs timer for periodical actives list update, puts the information to instance of class BinaryOptions and returns it.
     * @param wsApiClient - Instance of WebSocket API client.
     */
    static create(wsApiClient: WsApiClient): Promise<BinaryOptions>;
    /**
     * Returns list of binary options actives.
     */
    getActives(): BinaryOptionsActive[];
    /**
     * Returns refreshable instance of class BinaryOptionsActive by specified active ID. If active doesn't exist then error will be thrown.
     * @param activeId - Active identification number.
     */
    getActive(activeId: number): BinaryOptionsActive;
    /**
     * Makes request for buy binary option.
     * @param instrument - The instrument for which the option is purchased.
     * @param direction - Direction of price change.
     * @param price - The amount of the initial investment.
     * @param balance - The balance from which the initial investment will be written off and upon successful closing of the position, profit will be credited to this balance.
     */
    buy(instrument: BinaryOptionsActiveInstrument, direction: BinaryOptionsDirection, price: number, balance: Balance): Promise<BinaryOptionsOption>;
    /**
     * Updates actives from DTO.
     * @param activesMsg - Actives data transfer object.
     * @private
     */
    private updateActives;
    /**
     * Closes the instance.
     */
    close(): void;
}
/**
 * Binary options direction of price change.
 */
export declare enum BinaryOptionsDirection {
    /**
     * The decision is that the price will go up.
     */
    Call = "call",
    /**
     * The decision is that the price will go down.
     */
    Put = "put"
}
/**
 * Binary options active refreshable class.
 */
export declare class BinaryOptionsActive {
    /**
     * Active's identification number.
     */
    id: number;
    /**
     * Active's localization key
     */
    localizationKey: string;
    /**
     * How many seconds before expiration time the ability to buyback options for this active will not be allowed.
     */
    buybackDeadtime: number;
    /**
     * How many seconds before expiration time the ability to purchase options for this active will not be allowed.
     */
    deadtime: number;
    /**
     * Active's ticker (symbol).
     */
    ticker: string;
    /**
     * Is buyback available in the active.
     */
    isBuyback: boolean;
    /**
     * Is trading suspended on the active.
     */
    isSuspended: boolean;
    /**
     * Count of nearest options available for the active.
     */
    optionCount: number;
    /**
     * List of special instruments available for the active.
     */
    optionSpecial: BinaryOptionsActiveSpecialInstrument[];
    /**
     * Expiration times (sizes) available for the active.
     */
    expirationTimes: number[];
    /**
     * The commission is taken from 100% of the profit. Therefore, income percent can be calculated using the following formula: `profitIncomePercent=100-profitCommissionPercent`.
     */
    profitCommissionPercent: number;
    /**
     * Active's trading schedule.
     */
    schedule: BinaryOptionsActiveTradingSession[];
    /**
     * An object with the current time obtained from WebSocket API.
     * @private
     */
    private readonly currentTime;
    /**
     * Instruments facade class instance.
     * @private
     */
    private instrumentsFacade;
    /**
     * Creates instance from DTO.
     * @param msg - Active's data transfer object.
     * @param currentTime - An object with the current time obtained from WebSocket API.
     * @internal
     * @private
     */
    constructor(msg: InitializationDataV3BinaryActive, currentTime: WsApiClientCurrentTime);
    /**
     * Returns binary options active's instruments facade.
     */
    instruments(): Promise<BinaryOptionsActiveInstruments>;
    /**
     * Updates the instance from DTO.
     * @param msg - Active's data transfer object.
     * @private
     */
    update(msg: InitializationDataV3BinaryActive): void;
    /**
     * Checks whether an option on an active can be purchased at a specified time.
     * @param at - Time for which the check is performed.
     */
    canBeBoughtAt(at: Date): boolean;
    /**
     * Closes the instance.
     */
    close(): void;
}
/**
 * Binary options active trading session class.
 */
export declare class BinaryOptionsActiveTradingSession {
    /**
     * Start time of trading session.
     */
    from: Date;
    /**
     * End time of trading session.
     */
    to: Date;
    /**
     * Initialises class instance from DTO.
     * @param fromTs - Unix time of session start.
     * @param toTs - Unix time of session end.
     */
    constructor(fromTs: number, toTs: number);
}
/**
 * Binary options active's instruments facade class. Periodically generates active's instruments based on active's settings.
 */
export declare class BinaryOptionsActiveInstruments {
    private active;
    private readonly currentTime;
    /**
     * Instruments current state.
     * @private
     */
    private instruments;
    /**
     * Timer for periodical actives list update.
     * @private
     */
    private intervalId;
    /**
     * Creates class instance.
     * @param active - Active.
     * @param currentTime - An object with the current time obtained from WebSocket API.
     * @internal
     * @private
     */
    private constructor();
    /**
     * Runs timer for periodical active's instruments list generation, creates instance of this class and returns it.
     * @param active - The active for which instruments are generated.
     * @param currentTime - An object with the current time obtained from WebSocket API.
     */
    static create(active: BinaryOptionsActive, currentTime: WsApiClientCurrentTime): Promise<BinaryOptionsActiveInstruments>;
    /**
     * Returns list of instruments available for buy at specified time.
     * @param at - Time for which the check is performed.
     */
    getAvailableForBuyAt(at: Date): BinaryOptionsActiveInstrument[];
    private scheduleNextGeneration;
    /**
     * Generates instruments.
     * @private
     */
    private generateInstruments;
    /**
     * Closes the instance.
     */
    close(): void;
}
/**
 * Binary options active's instrument refreshable class.
 */
export declare class BinaryOptionsActiveInstrument {
    readonly activeId: number;
    readonly expirationSize: number | string;
    readonly expiredAt: Date;
    deadtime: number;
    profitCommissionPercent: number;
    /**
     * Creates instance of the class.
     * @param activeId - Instrument's active ID.
     * @param expirationSize - Instrument's expiration size.
     * @param expiredAt - The time when the instrument will be expired.
     * @param deadtime - How many seconds before expiration time the ability to purchase options for this instrument will not be allowed.
     * @param profitCommissionPercent - The commission is taken from 100% of the profit. Therefore, income percent can be calculated using the following formula: `profitIncomePercent=100-profitCommissionPercent`.
     * @internal
     * @private
     */
    constructor(activeId: number, expirationSize: number | string, expiredAt: Date, deadtime: number, profitCommissionPercent: number);
    /**
     * Checks availability for buy option at specified time.
     * @param at - Time for which the check is performed.
     */
    isAvailableForBuyAt(at: Date): boolean;
    /**
     * Returns the time until which it is possible to open trades that will fall into the current expiration.
     * @returns {Date}
     */
    purchaseEndTime(): Date;
    /**
     * Returns the remaining duration in milliseconds for which it is possible to purchase options.
     * @param {Date} currentTime - The current time.
     * @returns {number} - The remaining duration in milliseconds.
     */
    durationRemainingForPurchase(currentTime: Date): number;
    /**
     * Returns profit percent.
     */
    profitPercent(): number;
    /**
     * Updates the instance from DTO.
     * @param deadtime - How many seconds before expiration time the ability to purchase options for this instrument will not be allowed.
     * @private
     */
    update(deadtime: number): void;
}
/**
 * Binary options active's special instrument class.
 */
export declare class BinaryOptionsActiveSpecialInstrument {
    /**
     * Instrument's title.
     */
    title: string;
    /**
     * Is instrument allowed to trade.
     */
    isEnabled: boolean;
    /**
     * Instrument's expiration time.
     */
    expiredAt: Date;
    /**
     * Creates instance from DTO.
     * @param msg - Instrument's data transfer object.
     * @internal
     * @private
     */
    constructor(msg: InitializationDataV3BinaryActiveSpecialInstrument);
}
/**
 * Binary options option order class.
 */
export declare class BinaryOptionsOption {
    /**
     * Option's ID.
     */
    id: number;
    /**
     * Option's active ID.
     */
    activeId: number;
    /**
     * Option's price direction.
     */
    direction: BinaryOptionsDirection;
    /**
     * Option's expiration time.
     */
    expiredAt: Date;
    /**
     * Option's amount of the initial investment.
     */
    price: number;
    /**
     * Option's profit income percent.
     */
    profitIncomePercent: number;
    /**
     * The time when the option was purchased.
     */
    openedAt: Date;
    /**
     * The {@link CurrentQuote.value value} of the quote at which the option was purchased.
     */
    openQuoteValue: number;
    /**
     * Create instance from DTO.
     * @param msg - Option's data transfer object.
     * @internal
     * @private
     */
    constructor(msg: BinaryOptionsOptionV1);
}
/**
 * Don't use this class directly from your code. Use {@link ClientSdk.digitalOptions} static method instead.
 *
 * Digital options facade class.
 */
export declare class DigitalOptions {
    /**
     * Instance of WebSocket API client.
     * @private
     */
    private readonly wsApiClient;
    /**
     * Underlyings current state.
     * @private
     */
    private underlyings;
    /**
     * Creates instance from DTO.
     * @param underlyingList - Underlyings data transfer object.
     * @param wsApiClient - Instance of WebSocket API client.
     * @internal
     * @private
     */
    private constructor();
    /**
     * Subscribes on underlyings updates, requests current state of underlyings, puts the state into this class instance and returns it.
     * @param wsApiClient - Instance of WebSocket API client.
     */
    static create(wsApiClient: WsApiClient): Promise<DigitalOptions>;
    /**
     * Returns list of underlyings available for buy at specified time.
     * @param at - Time for which the check is performed.
     */
    getUnderlyingsAvailableForTradingAt(at: Date): DigitalOptionsUnderlying[];
    /**
     * Makes request for buy digital option.
     * @param instrument - The instrument for which the option is purchased.
     * @param strikePrice - The strike price by which the option is purchased. Can be digit number or string 'SPT'. SPT is a spot strike that is always equal to the {@link CurrentQuote.value value} of the current underlying quote.
     * @param direction - Direction of price change.
     * @param amount - The amount of the initial investment.
     * @param balance - The balance from which the initial investment will be written off and upon successful closing of the position, profit will be credited to this balance.
     */
    buy(instrument: DigitalOptionsUnderlyingInstrument, strikePrice: string, direction: DigitalOptionsDirection, amount: number, balance: Balance): Promise<DigitalOptionsOrder>;
    /**
     * Shortcut for buy option on spot strike.
     * @param instrument - The instrument for which the option is purchased.
     * @param direction - Direction of price change.
     * @param amount - The amount of the initial investment.
     * @param balance - The balance from which the initial investment will be written off and upon successful closing of the position, profit will be credited to this balance.     */
    buySpotStrike(instrument: DigitalOptionsUnderlyingInstrument, direction: DigitalOptionsDirection, amount: number, balance: Balance): Promise<DigitalOptionsOrder>;
    /**
     * Updates instance from DTO.
     * @param msg - Underlyings data transfer object.
     * @private
     */
    private updateUnderlyings;
    /**
     * Closes the instance.
     */
    close(): void;
}
/**
 * Digital options direction of price change.
 */
export declare enum DigitalOptionsDirection {
    /**
     * The decision is that the price will go up.
     */
    Call = "call",
    /**
     * The decision is that the price will go down.
     */
    Put = "put"
}
/**
 * Margin direction.
 */
export declare enum MarginDirection {
    Buy = "buy",
    Sell = "sell"
}
/**
 * Digital options underlying refreshable class.
 */
export declare class DigitalOptionsUnderlying {
    /**
     * Underlying active ID.
     */
    activeId: number;
    /**
     * Is trading suspended on the underlying.
     */
    isSuspended: boolean;
    /**
     * Underlying name (ticker/symbol).
     */
    name: string;
    /**
     * Underlying trading schedule.
     */
    schedule: DigitalOptionsUnderlyingTradingSession[];
    /**
     * Instruments facade class instance.
     * @private
     */
    private instrumentsFacade;
    /**
     * Instance of WebSocket API client.
     * @private
     */
    private readonly wsApiClient;
    /**
     * Creates instance from DTO.
     * @param msg - Underlying data transfer object.
     * @param wsApiClient - Instance of WebSocket API client.
     * @internal
     * @private
     */
    constructor(msg: DigitalOptionInstrumentsUnderlyingListV3Underlying, wsApiClient: WsApiClient);
    /**
     * Checks availability for trading at specified time.
     * @param at - Time for which the check is performed.
     */
    isAvailableForTradingAt(at: Date): boolean;
    /**
     * Returns digital options active's instruments facade.
     */
    instruments(): Promise<DigitalOptionsUnderlyingInstruments>;
    /**
     * Updates the instance from DTO.
     * @param msg - Underlying data transfer object.
     * @private
     */
    update(msg: DigitalOptionInstrumentsUnderlyingListChangedV3Underlying): void;
    /**
     * Closes the instance.
     */
    close(): void;
}
/**
 * Digital options active trading session class.
 */
export declare class DigitalOptionsUnderlyingTradingSession {
    /**
     * Start time of trading session.
     */
    open: Date;
    /**
     * End time of trading session.
     */
    close: Date;
    /**
     * Initialises class instance from DTO.
     * @param openTs - Unix time of session start.
     * @param closeTs - Unix time of session end.
     * @internal
     * @private
     */
    constructor(openTs: number, closeTs: number);
}
/**
 * Digital options underlying instruments facade class.
 */
export declare class DigitalOptionsUnderlyingInstruments {
    /**
     * Instruments current state.
     * @private
     */
    private instruments;
    /**
     * Instance of WebSocket API client.
     * @private
     */
    private wsApiClient;
    /**
     * Just private constructor. Use {@link DigitalOptionsUnderlyingInstruments.create create} instead.
     * @internal
     * @private
     */
    private constructor();
    /**
     * Subscribes on underlying instruments updates, requests current state of underlying instruments, puts the state into this class instance and returns it.
     * @param assetId
     * @param wsApiClient
     */
    static create(assetId: number, wsApiClient: WsApiClient): Promise<DigitalOptionsUnderlyingInstruments>;
    /**
     * Returns list of instruments available for buy at specified time.
     * @param at - Time for which the check is performed.
     */
    getAvailableForBuyAt(at: Date): DigitalOptionsUnderlyingInstrument[];
    /**
     * Updates the instance from DTO.
     * @param msg - Instrument data transfer object.
     * @private
     */
    private syncInstrumentFromEvent;
    /**
     * Updates the instance from DTO.
     * @param msg - Instruments data transfer object.
     * @private
     */
    private syncInstrumentsFromResponse;
    /**
     * Updates the instance from DTO.
     * @param msg - Instrument data transfer object.
     * @private
     */
    private syncInstrumentFromResponse;
    /**
     * Closes the instance.
     */
    close(): void;
}
/**
 * Digital options underlying instrument refreshable class.
 */
export declare class DigitalOptionsUnderlyingInstrument {
    /**
     * Instrument's active ID.
     */
    assetId: number;
    /**
     * Instrument's deadtime. How many seconds before expiration time the ability to purchase options for this instrument will not be allowed.
     */
    deadtime: number;
    /**
     * Instrument's expiration time.
     */
    expiration: Date;
    /**
     * Instrument's ID.
     */
    index: number;
    /**
     * Instrument's type.
     */
    instrumentType: string;
    /**
     * Instrument's period (expiration size).
     */
    period: number;
    /**
     * Instrument's strikes.
     */
    strikes: Map<string, DigitalOptionsUnderlyingInstrumentStrike>;
    /**
     * Instance of WebSocket API client.
     * @private
     */
    private readonly wsApiClient;
    /**
     * Timer for periodical actives list update.
     * @private
     */
    private intervalId;
    /**
     * Creates instance from DTO.
     * @param msg - Instrument data transfer object.
     * @param wsApiClient
     * @internal
     * @private
     */
    constructor(msg: {
        /**
         * Instrument's asset (active) ID.
         */
        assetId: number;
        /**
         * Instrument's deadtime.
         */
        deadtime: number;
        /**
         * Instrument's expiration UNIX time.
         */
        expiration: number;
        /**
         * Instrument's ID.
         */
        index: number;
        /**
         * Instrument's type.
         */
        instrumentType: string;
        /**
         * Instrument's period (expiration size).
         */
        period: number;
        /**
         * Instrument's strikes.
         */
        data: {
            /**
             * Strike's direction of price change.
             */
            direction: string;
            /**
             * Strike's price.
             */
            strike: string;
            /**
             * Strike's symbol.
             */
            symbol: string;
        }[];
    }, wsApiClient: WsApiClient);
    /**
     * Checks availability for buy option at specified time.
     * @param at - Time for which the check is performed.
     */
    isAvailableForBuyAt(at: Date): boolean;
    /**
     * Gets strike with specified price and direction.
     * @param price - Desired strike price.
     * @param direction - Desired strike direction of price change.
     */
    getStrikeByPriceAndDirection(price: string, direction: DigitalOptionsDirection): DigitalOptionsUnderlyingInstrumentStrike;
    /**
     * Calculates profit percent for specified amount and strike price.
     *
     * @param amount
     * @param price
     */
    profitPercent(amount: number, price?: string): number;
    /**
     * Returns the time until which it is possible to open trades that will fall into the current expiration.
     * @returns {Date}
     */
    purchaseEndTime(): Date;
    /**
     * Subscribes on strikes ask/bid prices updates.
     */
    subscribeOnStrikesAskBidPrices(): Promise<void>;
    /**
     * Returns the remaining duration in milliseconds for which it is possible to purchase options.
     * @param {Date} currentTime - The current time.
     * @returns {number} - The remaining duration in milliseconds.
     */
    durationRemainingForPurchase(currentTime: Date): number;
    /**
     * Updates the instance from DTO.
     * @param msg - Instrument data transfer object.
     */
    sync(msg: DigitalOptionInstrumentsInstrumentGeneratedV3): void;
    private syncAskBidPricesFromEvent;
    /**
     * Closes the instance.
     */
    close(): void;
}
/**
 * Digital options underlying instrument strike class.
 */
export declare class DigitalOptionsUnderlyingInstrumentStrike {
    /**
     * Direction of price change.
     */
    direction: DigitalOptionsDirection;
    /**
     * Strike's price. Can be digit number or string 'SPT'. SPT is a spot strike that is always equal to the {@link CurrentQuote.value value} of the current underlying quote.
     */
    price: string;
    /**
     * Strike's symbol.
     */
    symbol: string;
    /**
     * Ask price.
     */
    ask?: number;
    /**
     * Bid price.
     */
    bid?: number;
    /**
     * Creates instance from DTO.
     * @param msg - Strike data transfer object.
     * @internal
     * @private
     */
    constructor(msg: {
        /**
         * Direction of price change.
         */
        direction: string;
        /**
         * Strike price.
         */
        strike: string;
        /**
         * Strike symbol.
         */
        symbol: string;
    });
}
/**
 * Digital options order (option) class.
 */
export declare class DigitalOptionsOrder {
    /**
     * Order's ID.
     */
    id: number;
    /**
     * Creates instance from DTO.
     * @param msg - Order data transfer object.
     * @internal
     * @private
     */
    constructor(msg: DigitalOptionPlacedV3);
}
/**
 * Margin order class.
 */
export declare class MarginOrder {
    /**
     * Order's ID.
     */
    id: number;
    /**
     * Creates instance from DTO.
     * @param msg - Order data transfer object.
     * @internal
     * @private
     */
    constructor(msg: MarginOrderPlacedV1);
}
export declare class MarginForex {
    /**
     * Instance of WebSocket API client.
     * @private
     */
    private readonly wsApiClient;
    /**
     * Underlyings current state.
     * @private
     */
    private underlyings;
    /**
     * Creates instance from DTO.
     * @param underlyingList - Underlyings data transfer object.
     * @param wsApiClient - Instance of WebSocket API client.
     * @internal
     * @private
     */
    private constructor();
    /**
     * Subscribes on underlyings updates, requests current state of underlyings, puts the state into this class instance and returns it.
     * @param wsApiClient - Instance of WebSocket API client.
     */
    static create(wsApiClient: WsApiClient): Promise<MarginForex>;
    /**
     * Makes request for buy margin active.
     * @param instrument - The instrument for which the option is purchased.
     * @param direction - Direction of price change.
     * @param count
     * @param balance - The balance from which the initial investment will be written off and upon successful closing of the position, profit will be credited to this balance.
     * @param stopLoss
     * @param takeProfit
     */
    buy(instrument: MarginUnderlyingInstrument, direction: MarginDirection, count: number, balance: Balance, stopLoss?: MarginTradingTPSL | null, takeProfit?: MarginTradingTPSL | null): Promise<MarginOrder>;
    /**
     * Makes stop order request for buy margin active.
     * If the stop order price is on the opposite side of the current market price, it will be converted to a limit order.
     * @param instrument
     * @param direction
     * @param count
     * @param balance
     * @param stopPrice
     * @param takeProfit
     * @param stopLoss
     */
    buyStop(instrument: MarginUnderlyingInstrument, direction: MarginDirection, count: number, balance: Balance, stopPrice: number, stopLoss?: MarginTradingTPSL | null, takeProfit?: MarginTradingTPSL | null): Promise<MarginOrder>;
    /**
     * Makes limit order request for buy margin active.
     * If the limit order price is on the opposite side of the current market price, it will be converted to a stop order.
     * @param instrument
     * @param direction
     * @param count
     * @param balance
     * @param limitPrice
     * @param stopLoss
     * @param takeProfit
     */
    buyLimit(instrument: MarginUnderlyingInstrument, direction: MarginDirection, count: number, balance: Balance, limitPrice: number, stopLoss?: MarginTradingTPSL | null, takeProfit?: MarginTradingTPSL | null): Promise<MarginOrder>;
    /**
     * Returns list of underlyings available for buy at specified time.
     * @param at - Time for which the check is performed.
     */
    getUnderlyingsAvailableForTradingAt(at: Date): MarginUnderlying[];
    /**
     * Updates instance from DTO.
     * @param msg - Underlyings data transfer object.
     * @private
     */
    private updateUnderlyings;
}
export declare class MarginCfd {
    /**
     * Instance of WebSocket API client.
     * @private
     */
    private readonly wsApiClient;
    /**
     * Underlyings current state.
     * @private
     */
    private underlyings;
    /**
     * Creates instance from DTO.
     * @param underlyingList - Underlyings data transfer object.
     * @param wsApiClient - Instance of WebSocket API client.
     * @internal
     * @private
     */
    private constructor();
    /**
     * Subscribes on underlyings updates, requests current state of underlyings, puts the state into this class instance and returns it.
     * @param wsApiClient - Instance of WebSocket API client.
     */
    static create(wsApiClient: WsApiClient): Promise<MarginCfd>;
    /**
     * Makes request for buy margin active.
     * @param instrument - The instrument for which the option is purchased.
     * @param direction - Direction of price change.
     * @param count
     * @param balance - The balance from which the initial investment will be written off and upon successful closing of the position, profit will be credited to this balance.
     * @param takeProfit
     * @param stopLoss
     */
    buy(instrument: MarginUnderlyingInstrument, direction: MarginDirection, count: number, balance: Balance, stopLoss?: MarginTradingTPSL | null, takeProfit?: MarginTradingTPSL | null): Promise<MarginOrder>;
    /**
     * Makes stop order request for buy margin active.
     * If the stop order price is on the opposite side of the current market price, it will be converted to a limit order.
     * @param instrument
     * @param direction
     * @param count
     * @param balance
     * @param stopPrice
     * @param takeProfit
     * @param stopLoss
     */
    buyStop(instrument: MarginUnderlyingInstrument, direction: MarginDirection, count: number, balance: Balance, stopPrice: number, stopLoss?: MarginTradingTPSL | null, takeProfit?: MarginTradingTPSL | null): Promise<MarginOrder>;
    /**
     * Makes limit order request for buy margin active.
     * If the limit order price is on the opposite side of the current market price, it will be converted to a stop order.
     * @param instrument
     * @param direction
     * @param count
     * @param balance
     * @param limitPrice
     * @param stopLoss
     * @param takeProfit
     */
    buyLimit(instrument: MarginUnderlyingInstrument, direction: MarginDirection, count: number, balance: Balance, limitPrice: number, stopLoss?: MarginTradingTPSL | null, takeProfit?: MarginTradingTPSL | null): Promise<MarginOrder>;
    /**
     * Returns list of underlyings available for buy at specified time.
     * @param at - Time for which the check is performed.
     */
    getUnderlyingsAvailableForTradingAt(at: Date): MarginUnderlying[];
    /**
     * Updates instance from DTO.
     * @param msg - Underlyings data transfer object.
     * @private
     */
    private updateUnderlyings;
}
export declare class MarginCrypto {
    /**
     * Instance of WebSocket API client.
     * @private
     */
    private readonly wsApiClient;
    /**
     * Underlyings current state.
     * @private
     */
    private underlyings;
    /**
     * Creates instance from DTO.
     * @param underlyingList - Underlyings data transfer object.
     * @param wsApiClient - Instance of WebSocket API client.
     * @internal
     * @private
     */
    private constructor();
    /**
     * Subscribes on underlyings updates, requests current state of underlyings, puts the state into this class instance and returns it.
     * @param wsApiClient - Instance of WebSocket API client.
     */
    static create(wsApiClient: WsApiClient): Promise<MarginCrypto>;
    /**
     * Makes request for buy margin active.
     * @param instrument - The instrument for which the option is purchased.
     * @param direction - Direction of price change.
     * @param count
     * @param balance - The balance from which the initial investment will be written off and upon successful closing of the position, profit will be credited to this balance.
     * @param stopLoss
     * @param takeProfit
     */
    buy(instrument: MarginUnderlyingInstrument, direction: MarginDirection, count: number, balance: Balance, stopLoss?: MarginTradingTPSL | null, takeProfit?: MarginTradingTPSL | null): Promise<MarginOrder>;
    /**
     * Makes stop order request for buy margin active.
     * If the stop order price is on the opposite side of the current market price, it will be converted to a limit order.
     * @param instrument
     * @param direction
     * @param count
     * @param balance
     * @param stopPrice
     * @param takeProfit
     * @param stopLoss
     */
    buyStop(instrument: MarginUnderlyingInstrument, direction: MarginDirection, count: number, balance: Balance, stopPrice: number, stopLoss?: MarginTradingTPSL | null, takeProfit?: MarginTradingTPSL | null): Promise<MarginOrder>;
    /**
     * Makes limit order request for buy margin active.
     * If the limit order price is on the opposite side of the current market price, it will be converted to a stop order.
     * @param instrument
     * @param direction
     * @param count
     * @param balance
     * @param limitPrice
     * @param stopLoss
     * @param takeProfit
     */
    buyLimit(instrument: MarginUnderlyingInstrument, direction: MarginDirection, count: number, balance: Balance, limitPrice: number, stopLoss?: MarginTradingTPSL | null, takeProfit?: MarginTradingTPSL | null): Promise<MarginOrder>;
    /**
     * Returns list of underlyings available for buy at specified time.
     * @param at - Time for which the check is performed.
     */
    getUnderlyingsAvailableForTradingAt(at: Date): MarginUnderlying[];
    /**
     * Updates instance from DTO.
     * @param msg - Underlyings data transfer object.
     * @private
     */
    private updateUnderlyings;
}
export declare class MarginUnderlying {
    /**
     * Underlying active ID.
     */
    activeId: number;
    /**
     * Margin instrument type (cfd/crypto/forex).
     * @private
     */
    private readonly marginInstrumentType;
    /**
     * Is trading suspended on the underlying.
     */
    isSuspended: boolean;
    /**
     * Underlying name (ticker/symbol).
     */
    name: string;
    /**
     * Underlying trading schedule.
     */
    schedule: MarginUnderlyingTradingSession[];
    /**
     * Instruments facade class instance.
     * @private
     */
    private instrumentsFacade;
    /**
     * Instance of WebSocket API client.
     * @private
     */
    private readonly wsApiClient;
    /**
     * Creates instance from DTO.
     * @param msg - Underlying data transfer object.
     * @param marginInstrumentType
     * @param wsApiClient - Instance of WebSocket API client.
     * @internal
     * @private
     */
    constructor(msg: MarginInstrumentsUnderlyingListV1Item, marginInstrumentType: string, wsApiClient: WsApiClient);
    /**
     * Checks availability for trading at specified time.
     * @param at - Time for which the check is performed.
     */
    isAvailableForTradingAt(at: Date): boolean;
    /**
     * Returns margin active's instruments facade.
     */
    instruments(): Promise<MarginUnderlyingInstruments>;
    /**
     * Updates the instance from DTO.
     * @param msg - Underlying data transfer object.
     * @private
     */
    update(msg: MarginInstrumentsUnderlyingListV1Item): void;
}
/**
 * Margin forex active trading session class.
 */
export declare class MarginUnderlyingTradingSession {
    /**
     * Start time of trading session.
     */
    open: Date;
    /**
     * End time of trading session.
     */
    close: Date;
    /**
     * Initialises class instance from DTO.
     * @param openTs - Unix time of session start.
     * @param closeTs - Unix time of session end.
     * @internal
     * @private
     */
    constructor(openTs: number, closeTs: number);
}
/**
 * Margin underlying instruments facade class.
 */
export declare class MarginUnderlyingInstruments {
    /**
     * Instruments current state.
     * @private
     */
    private instruments;
    /**
     * Just private constructor. Use {@link MarginUnderlyingInstruments.create create} instead.
     * @internal
     * @private
     */
    private constructor();
    /**
     * Subscribes on underlying instruments updates, requests current state of underlying instruments, puts the state into this class instance and returns it.
     * @param activeId
     * @param marginInstrumentType
     * @param wsApiClient
     */
    static create(activeId: number, marginInstrumentType: string, wsApiClient: WsApiClient): Promise<MarginUnderlyingInstruments>;
    /**
     * Returns list of instruments available for buy at specified time.
     * @param at - Time for which the check is performed.
     */
    getAvailableForBuyAt(at: Date): MarginUnderlyingInstrument[];
    /**
     * Updates the instance from DTO.
     * @param msg - Instruments data transfer object.
     * @private
     */
    private syncInstrumentsFromResponse;
    /**
     * Updates the instance from DTO.
     * @param msg - Instrument data transfer object.
     * @private
     */
    private syncInstrumentFromResponse;
}
/**
 * Margin underlying instruments facade class.
 */
export declare class MarginUnderlyingInstrument {
    /**
     * Instrument ID.
     */
    id: string;
    /**
     * Active ID of the instrument.
     */
    activeId: number;
    /**
     * Allow long positions.
     */
    allowLongPosition: boolean;
    /**
     * Allow short positions.
     */
    allowShortPosition: boolean;
    /**
     * Default leverage for the instrument.
     */
    defaultLeverage: number;
    /**
     * Leverage profile for the instrument.
     */
    leverageProfile: number;
    /**
     * Indicates if the instrument is suspended.
     */
    isSuspended: boolean;
    /**
     * The minimum amount when buying an asset.
     */
    minQty: number;
    /**
     * The step of the amount when buying an asset.
     */
    qtyStep: number;
    /**
     * Active trading schedule.
     */
    tradable: MarginUnderlyingInstrumentTradable;
    /**
     * Dynamic leverage profiles.
     */
    dynamicLeverageProfiles: MarginInstrumentsInstrumentsListV1DynamicLeverageProfile[];
    /**
     * Creates instance from DTO.
     * @param msg - Instrument data transfer object.
     * @internal
     * @private
     */
    constructor(msg: MarginInstrumentsInstrumentsListV1Item);
    /**
     * Checks availability for buy option at specified time.
     * @param at - Time for which the check is performed.
     */
    isAvailableForBuyAt(at: Date): boolean;
    /**
     * Returns the remaining duration in milliseconds for which it is possible to purchase options.
     * @param {Date} currentTime - The current time.
     * @returns {number} - The remaining duration in milliseconds.
     */
    durationRemainingForPurchase(currentTime: Date): number;
    sync(msg: MarginInstrumentsInstrumentsListV1Item): void;
    calculateLeverageProfile(balance: Balance): number;
}
declare class MarginUnderlyingInstrumentTradable {
    /**
     * Start time of trading session.
     */
    from: Date;
    /**
     * End time of trading session.
     */
    to: Date;
    /**
     * Initialises class instance from DTO.
     * @param fromTs - Unix time of session start.
     * @param toTs - Unix time of session end.
     */
    constructor(fromTs: number, toTs: number);
}
/**
 * WebSocket API client class.
 * @ignore
 * @internal
 */
declare class WsApiClient {
    readonly currentTime: WsApiClientCurrentTime;
    /**
     * API URL for WebSocket connection.
     */
    readonly apiUrl: string;
    private readonly onCurrentTimeChangedObserver;
    private readonly platformId;
    private readonly authMethod;
    private isBrowser;
    private readonly initialReconnectTimeout;
    private readonly reconnectMultiplier;
    private readonly maxReconnectTimeout;
    private reconnectTimeout;
    private disconnecting;
    private reconnecting;
    private connection;
    private lastRequestId;
    private pendingRequests;
    private subscriptions;
    onConnectionStateChanged: ((state: WsConnectionStateEnum) => void) | undefined;
    private timeSyncInterval;
    private lastTimeSyncReceived;
    private reconnectTimeoutHandle;
    private isClosing;
    private pendingDrainWaiters;
    constructor(apiUrl: string, platformId: number, authMethod: AuthMethod);
    private startTimeSyncMonitoring;
    private stopTimeSyncMonitoring;
    subscribeOnWsCurrentTime(callback: (currentTime: Date) => void): void;
    unsubscribeOnWsCurrentTime(callback: (currentTime: Date) => void): void;
    private updateCurrentTime;
    connect(): Promise<void>;
    private createRequestError;
    disconnectGracefully(timeoutMs?: number): Promise<void>;
    private notifyPendingDrainIfNeeded;
    private waitForPendingRequestsEmpty;
    disconnect(): void;
    clear(): void;
    private forceCloseConnection;
    reconnect(): void;
    getJitter(): number;
    private finalizeRequest;
    doRequest<T>(request: Request<T>): Promise<T>;
    private rejectAllPendingRequests;
    resubscribeAll(): Promise<Result[]>;
    subscribe<T>(request: SubscribeRequest<T>, callback: (event: T) => void): Promise<unknown>;
    unsubscribe<T>(request: SubscribeRequest<T>): Promise<unknown>;
}
declare class WsApiClientCurrentTime {
    unixMilliTime: number;
    constructor(unixMilliTime: number);
}
interface Request<ResponseType> {
    messageName(): string;
    messageBody(): any;
    resultOnly(): boolean;
    createResponse(data: any): ResponseType;
    createError?(status: number, data: any): Error;
}
interface SubscribeRequest<EventType> {
    messageName(): string;
    messageBody(): any;
    eventMicroserviceName(): string;
    eventName(): string;
    createEvent(data: any): EventType;
}
declare class Result {
    success: boolean;
    reason: string;
    constructor(data: {
        success: boolean;
        reason: string;
    });
}
declare class BinaryOptionsOptionV1 {
    id: number;
    activeId: number;
    direction: string;
    expired: number;
    price: number;
    profitIncome: number;
    timeRate: number;
    type: string;
    value: number;
    constructor(data: {
        id: number;
        act: number;
        direction: string;
        exp: number;
        price: number;
        profit_income: number;
        time_rate: number;
        type: string;
        value: number;
    });
}
declare class DigitalOptionInstrumentsInstrumentGeneratedV3 {
    assetId: number;
    data: DigitalOptionInstrumentsInstrumentGeneratedV3DataItem[];
    deadtime: number;
    expiration: number;
    index: number;
    instrumentType: string;
    period: number;
    constructor(msg: any);
}
declare class DigitalOptionInstrumentsInstrumentGeneratedV3DataItem {
    direction: string;
    strike: string;
    symbol: string;
    constructor(msg: any);
}
declare class DigitalOptionInstrumentsUnderlyingListChangedV3Underlying {
    activeId: number;
    isSuspended: boolean;
    name: string;
    schedule: {
        open: number;
        close: number;
    }[];
    constructor(activeId: number, isSuspended: boolean, name: string, schedule: {
        open: number;
        close: number;
    }[]);
}
declare class DigitalOptionInstrumentsUnderlyingListV3Underlying {
    activeId: number;
    isSuspended: boolean;
    name: string;
    schedule: {
        open: number;
        close: number;
    }[];
    constructor(activeId: number, isSuspended: boolean, name: string, schedule: {
        open: number;
        close: number;
    }[]);
}
declare class DigitalOptionPlacedV3 {
    id: number;
    constructor(data: any);
}
declare class MarginOrderPlacedV1 {
    id: number;
    constructor(data: any);
}
declare class InitializationDataV3BlitzActive {
    id: number;
    name: string;
    ticker: string;
    isSuspended: boolean;
    expirationTimes: number[];
    profitCommission: number;
    schedule: number[][];
    constructor(data: {
        id: number;
        name: string;
        ticker: string;
        is_suspended: boolean;
        option: {
            expiration_times: number[];
            profit: {
                commission: number;
            };
        };
        schedule: number[][];
    });
}
declare class InitializationDataV3TurboActive {
    id: number;
    name: string;
    buybackDeadtime: number;
    deadtime: number;
    ticker: string;
    isBuyback: boolean;
    isSuspended: boolean;
    optionCount: number;
    expirationTimes: number[];
    profitCommission: number;
    schedule: number[][];
    constructor(data: {
        id: number;
        name: string;
        buyback_deadtime: number;
        deadtime: number;
        ticker: string;
        is_buyback: boolean;
        is_suspended: boolean;
        option: {
            count: number;
            expiration_times: number[];
            profit: {
                commission: number;
            };
        };
        schedule: number[][];
    });
}
declare class InitializationDataV3BinaryActive {
    id: number;
    name: string;
    buybackDeadtime: number;
    deadtime: number;
    ticker: string;
    isBuyback: boolean;
    isSuspended: boolean;
    optionCount: number;
    optionSpecial: InitializationDataV3BinaryActiveSpecialInstrument[];
    expirationTimes: number[];
    profitCommission: number;
    schedule: number[][];
    constructor(data: {
        id: number;
        name: string;
        buyback_deadtime: number;
        deadtime: number;
        ticker: string;
        is_buyback: boolean;
        is_suspended: boolean;
        option: {
            count: number;
            expiration_times: number[];
            profit: {
                commission: number;
            };
            special: any;
        };
        schedule: number[][];
    });
}
declare class InitializationDataV3BinaryActiveSpecialInstrument {
    title: string;
    enabled: boolean;
    expiredAt: number;
    constructor(expiredAt: number, msg: any);
}
declare class BalancesBalanceChangedV1 {
    id: number;
    type: number;
    amount: number;
    bonusAmount: number;
    currency: string;
    userId: number;
    constructor(data: {
        current_balance: {
            id: number;
            type: number;
            amount: number;
            bonus_amount: number;
            currency: string;
        };
        user_id: number;
    });
}
declare class BalancesAvailableBalancesV1Balance {
    id: number;
    type: number;
    amount: number;
    bonusAmount: number;
    currency: string;
    userId: number;
    isMargin: boolean;
    constructor(data: {
        id: number;
        type: number;
        amount: number;
        bonus_amount: number;
        currency: string;
        user_id: number;
        is_marginal: boolean;
    });
}
declare class PortfolioPositionChangedV3 {
    activeId: number;
    closeProfit: number | undefined;
    closeQuote: number | undefined;
    closeReason: string | undefined;
    closeTime: number | undefined;
    expectedProfit: number;
    externalId: number;
    internalId: string;
    instrumentType: string;
    invest: number;
    openQuote: number;
    openTime: number;
    pnl: number;
    pnlRealized: number;
    quoteTimestamp: number | undefined;
    status: string;
    userId: number;
    userBalanceId: number;
    version: number;
    direction: string | undefined;
    expirationTime: number | undefined;
    orderIds: number[];
    constructor(data: {
        active_id: number;
        close_profit: number | undefined;
        close_quote: number | undefined;
        close_reason: string | undefined;
        close_time: number | undefined;
        expected_profit: number;
        instrument_type: string;
        source: string;
        external_id: number;
        id: string;
        invest: number;
        open_quote: number;
        open_time: number;
        pnl: number;
        pnl_realized: number;
        quote_timestamp: number | undefined;
        status: string;
        user_id: number;
        user_balance_id: number;
        version: number;
        raw_event: PositionsRawEvent | undefined;
    });
}
declare class PortfolioPositionsHistoryV2Position {
    externalId: number;
    internalId: string;
    userId: number;
    userBalanceId: number;
    activeId: number;
    instrumentType: string;
    status: string;
    openQuote: number;
    openTime: number;
    invest: number;
    closeProfit: number | undefined;
    closeQuote: number | undefined;
    closeReason: string | undefined;
    closeTime: number | undefined;
    pnl: number;
    pnlRealized: number;
    pnlNet: number;
    orderIds: number[];
    direction: string | undefined;
    constructor(data: {
        active_id: number;
        close_profit: number | undefined;
        close_quote: number | undefined;
        close_reason: string | undefined;
        close_time: number | undefined;
        expected_profit: number;
        instrument_type: string;
        source: string;
        external_id: number;
        id: string;
        invest: number;
        open_quote: number;
        open_time: number;
        pnl: number;
        pnl_realized: number;
        pnl_net: number;
        quote_timestamp: number | undefined;
        status: string;
        user_id: number;
        user_balance_id: number;
        version: number;
        raw_event: PositionsRawEvent | undefined;
    });
}
declare class PortfolioPositionsStateV1Position {
    internalId: string;
    instrumentType: string;
    sellProfit: number;
    margin: number;
    currentPrice: number;
    quoteTimestamp: number | undefined;
    pnl: number;
    pnlNet: number;
    openPrice: number;
    expectedProfit: number;
    currencyConversion: number;
    constructor(data: {
        id: string;
        instrument_type: string;
        sell_profit: number;
        margin: number;
        current_price: number;
        quote_timestamp: number | undefined;
        pnl: number;
        pnl_net: number;
        open_price: number;
        expected_profit: number;
        currency_conversion: number;
    });
}
declare class PortfolioPositionsV4Position {
    activeId: number;
    expectedProfit: number;
    externalId: number;
    internalId: string;
    instrumentType: string;
    invest: number;
    openQuote: number;
    openTime: number;
    pnl: number;
    quoteTimestamp: number | undefined;
    status: string;
    userId: number;
    userBalanceId: number;
    orderIds: number[];
    expirationTime: number | undefined;
    direction: string | undefined;
    constructor(data: {
        active_id: number;
        expected_profit: number;
        external_id: number;
        id: string;
        instrument_type: string;
        source: string;
        invest: number;
        open_quote: number;
        open_time: number;
        pnl: number;
        quote_timestamp: number | undefined;
        status: string;
        user_id: number;
        user_balance_id: number;
        raw_event: PositionsRawEvent | undefined;
    });
}
declare class PositionsRawEvent {
    binary_options_option_changed1: BinaryOptionsRawEventItem | undefined;
    digital_options_position_changed1: PositionsRawEventItem | undefined;
    marginal_forex_position_changed1: PositionsRawEventItem | undefined;
    marginal_cfd_position_changed1: PositionsRawEventItem | undefined;
    marginal_crypto_position_changed1: PositionsRawEventItem | undefined;
}
declare class BinaryOptionsRawEventItem {
    order_ids: number[] | undefined;
    direction: string | undefined;
    expiration_time: number | undefined;
}
declare class PositionsRawEventItem {
    order_ids: number[] | undefined;
    instrument_dir: string | undefined;
    instrument_expiration: number | undefined;
}
declare class PortfolioOrdersV2Order {
    id: number | undefined;
    instrumentType: string;
    kind: string;
    positionId: string;
    status: string;
    userId: number;
    userBalanceId: number;
    constructor(data: {
        id: string;
        instrument_type: string;
        kind: string;
        position_id: string;
        status: string;
        user_id: number;
        user_balance_id: number;
        raw_event: OrdersRawEvent | undefined;
    });
}
declare class PortfolioOrderChangedV2 {
    id: number | undefined;
    instrumentType: string;
    kind: string;
    positionId: string;
    status: string;
    userId: number;
    userBalanceId: number;
    constructor(data: {
        id: string;
        instrument_type: string;
        kind: string;
        position_id: string;
        status: string;
        user_id: number;
        user_balance_id: number;
        raw_event: OrdersRawEvent | undefined;
    });
}
declare class OrdersRawEvent {
    digital_options_order_changed1: OrdersRawEventItem | undefined;
    marginal_forex_order_changed1: OrdersRawEventItem | undefined;
    marginal_cfd_order_changed1: OrdersRawEventItem | undefined;
    marginal_crypto_order_changed1: OrdersRawEventItem | undefined;
}
declare class OrdersRawEventItem {
    id: number;
    constructor(data: {
        id: number;
    });
}
declare class CurrencyV5 {
    id: number;
    name: string;
    description: string;
    symbol: string;
    isVisible: boolean;
    mask: string;
    isTradable: boolean;
    code: string;
    unit: number;
    rate: number;
    rateUsd: number;
    minDealAmount: number;
    maxDealAmount: number;
    minorUnits: number;
    image: string;
    isCrypto: boolean;
    isInout: boolean;
    interestRate: number;
    constructor(data: any);
}
declare class ActiveV5 {
    id: number;
    name: string;
    description: string;
    image: string;
    isOtc: boolean;
    timeFrom: string;
    timeTo: string;
    precision: number;
    pipScale: number;
    spreadPlus: number;
    spreadMinus: number;
    expirationDays: number[];
    currencyLeftSide: string;
    currencyRightSide: string;
    type: string;
    minQty: number;
    qtyStep: number;
    typeQty: string;
    constructor(data: any);
}
declare class MarginPortfolioBalanceV1 {
    id: number;
    type: number;
    cash: number;
    bonus: number;
    currency: string;
    userId: number;
    pnl: number;
    pnlNet: number;
    equity: number;
    equityUsd: number;
    swap: number;
    dividends: number;
    margin: number;
    available: number;
    marginLevel: number;
    stopOutLevel: number;
    constructor(data: {
        id: number;
        type: number;
        cash: string;
        bonus: string;
        currency: string;
        user_id: number;
        pnl: string;
        pnl_net: string;
        equity: string;
        equity_usd: string;
        swap: string;
        dividends: string;
        margin: string;
        available: string;
        margin_level: string;
        stop_out_level: string;
    });
}
declare class MarginInstrumentsUnderlyingListV1Item {
    activeId: number;
    isSuspended: boolean;
    name: string;
    schedule: {
        open: number;
        close: number;
    }[];
    constructor(activeId: number, isSuspended: boolean, name: string, schedule: {
        open: number;
        close: number;
    }[]);
}
declare class MarginInstrumentsInstrumentsListV1DynamicLeverageProfile {
    equity: number;
    leverage: number;
    constructor(data: any);
}
declare class MarginInstrumentsInstrumentsListV1Item {
    id: string;
    activeId: number;
    allowLongPosition: boolean;
    allowShortPosition: boolean;
    defaultLeverage: number;
    leverageProfile: number;
    dynamicLeverageProfile: MarginInstrumentsInstrumentsListV1DynamicLeverageProfile[];
    isSuspended: boolean;
    minQty: string;
    qtyStep: string;
    tradable: MarginInstrumentsInstrumentsListV1Tradable;
    constructor(msg: any, dynamicLeverageProfile?: MarginInstrumentsInstrumentsListV1DynamicLeverageProfile[]);
}
declare class MarginInstrumentsInstrumentsListV1Tradable {
    from: number;
    to: number;
    constructor(from: number, to: number);
}
export {};
