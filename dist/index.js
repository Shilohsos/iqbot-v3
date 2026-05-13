import WebSocket from "isomorphic-ws";
/**
 * This is the entry point of this SDK for your application. Use it to implement the business logic of your application.
 */
export class ClientSdk {
    /**
     * Refreshable user profile class instance.
     */
    userProfile;
    /**
     * Instance of WebSocket API client.
     * @private
     */
    wsApiClient;
    /**
     * Host extracted from WebSocket URL.
     * @private
     */
    host;
    /**
     * WebSocket connection state facade.
     * @private
     */
    wsConnectionStateFacade;
    wsConnectionStatePromise;
    /**
     * Balances facade cache.
     * @private
     */
    balancesFacade;
    balancesPromise;
    /**
     * Positions facade cache.
     * @private
     */
    positionsFacade;
    positionsPromise;
    /**
     * Orders facade cache.
     * @private
     */
    ordersFacade;
    ordersPromise;
    /**
     * Quotes facade cache.
     * @private
     */
    quotesFacade;
    quotesPromise;
    /**
     *  Actives facade cache.
     *  @private
     */
    activesFacade;
    activesPromise;
    /**
     * Currencies facade cache.
     * @private
     */
    currenciesFacade;
    currenciesPromise;
    /**
     * Blitz options facade cache.
     * @private
     */
    blitzOptionsFacade;
    blitzOptionsPromise;
    /**
     * Turbo options facade cache.
     * @private
     */
    turboOptionsFacade;
    turboOptionsPromise;
    /**
     * Binary options facade cache.
     * @private
     */
    binaryOptionsFacade;
    binaryOptionsPromise;
    /**
     * Digital options facade cache.
     * @private
     */
    digitalOptionsFacade;
    digitalOptionsPromise;
    /**
     * Margin forex facade cache.
     * @private
     */
    marginForexFacade;
    marginForexPromise;
    /**
     * Margin cfd facade cache
     * @private
     */
    marginCfdFacade;
    marginCfdPromise;
    /**
     * Margin crypto facade cache
     * @private
     */
    marginCryptoFacade;
    marginCryptoPromise;
    /**
     * Candles facade cache
     * @private
     */
    candlesFacade;
    candlesPromise;
    /**
     * Chats facade cache.
     * @private
     */
    chatsFacade;
    chatsPromise;
    /**
     * Host for static resources.
     * @private
     */
    staticHost = 'https://static.cdnroute.io/files';
    /**
     * Instruments availability cache.
     * @private
     */
    instrumentsIsAvailable = new Map();
    /**
     * Translations facade cache.
     * @private
     */
    translationsFacade;
    translationsPromise;
    /**
     * Real-time chart data layer facade cache.
     * @private
     */
    realTimeChartDataLayerFacade;
    /**
     * Consistency manager instance.
     * @private
     */
    candlesConsistencyManagerFacade;
    candlesConsistencyManagerPromise;
    /**
     * Creates instance of class.
     * @param userProfile - Information about the user on whose behalf your application is working.
     * @param wsApiClient - Instance of WebSocket API client.
     * @param options
     * @internal
     * @private
     */
    constructor(userProfile, wsApiClient, options) {
        this.userProfile = userProfile;
        this.wsApiClient = wsApiClient;
        this.host = options?.host ? this.normalizeHost(options.host) : this.extractHostFromWsUrl(wsApiClient.apiUrl);
        this.staticHost = options?.staticHost || 'https://static.cdnroute.io/files';
    }
    /**
     * Extracts host from WebSocket URL.
     * @param wsUrl - WebSocket URL (e.g. wss://trade.broker.com/echo/websocket)
     * @returns Host without protocol and path (e.g. https://trade.broker.com)
     * @private
     */
    extractHostFromWsUrl(wsUrl) {
        const url = new URL(wsUrl);
        const host = url.host.replace(/^ws\./, '');
        return `https://${host}`;
    }
    normalizeHost(host) {
        if (host.startsWith('http://') || host.startsWith('https://')) {
            return host;
        }
        return `https://${host}`;
    }
    /**
     * Creates instance of SDK entry point class.
     * This method establishes and authenticates connection to system API.
     * @param apiUrl - URL to system API. Usually it has the following format: `wss://ws.trade.{brand_domain}/echo/websocket`.
     * @param platformId - Identification number of your application.
     * @param authMethod - Authentication method used for connection authentication.
     * @param options
     */
    static async create(apiUrl, platformId, authMethod, options) {
        const wsApiClient = new WsApiClient(apiUrl, platformId, authMethod);
        let connected = false;
        while (!connected) {
            try {
                await wsApiClient.connect();
                connected = true;
            }
            catch (err) {
                if (!(err instanceof AuthMethodRequestedReconnectException)) {
                    throw err;
                }
            }
        }
        const userProfile = await UserProfile.create(wsApiClient);
        return new ClientSdk(userProfile, wsApiClient, options);
    }
    /**
     * Shuts down instance of SDK entry point class.
     */
    async shutdown() {
        await this.wsApiClient.disconnectGracefully();
        if (this.blitzOptionsFacade) {
            this.blitzOptionsFacade.close();
        }
        if (this.turboOptionsFacade) {
            this.turboOptionsFacade.close();
        }
        if (this.binaryOptionsFacade) {
            this.binaryOptionsFacade.close();
        }
        if (this.digitalOptionsFacade) {
            this.digitalOptionsFacade.close();
        }
        if (this.positionsFacade) {
            this.positionsFacade.close();
        }
        if (this.translationsFacade) {
            this.translationsFacade.close();
        }
        if (this.chatsFacade) {
            this.chatsFacade.close();
        }
    }
    /**
     * Returns balances facade class.
     */
    async balances() {
        if (this.balancesFacade)
            return this.balancesFacade;
        if (!this.balancesPromise) {
            this.balancesPromise = (async () => {
                const inst = await Balances.create(this.wsApiClient);
                this.balancesFacade = inst;
                this.balancesPromise = undefined;
                return inst;
            })();
        }
        return this.balancesPromise;
    }
    /**
     * Returns positions facade class.
     */
    async positions() {
        if (this.positionsFacade)
            return this.positionsFacade;
        if (!this.positionsPromise) {
            this.positionsPromise = (async () => {
                const actives = await this.actives();
                const state = await this.wsConnectionState();
                const inst = await Positions.create(this.wsApiClient, this.userProfile.userId, actives, state);
                this.positionsFacade = inst;
                this.positionsPromise = undefined;
                return inst;
            })();
        }
        return this.positionsPromise;
    }
    /**
     * Returns actives facade class.
     */
    async actives() {
        if (this.activesFacade)
            return this.activesFacade;
        if (!this.activesPromise) {
            this.activesPromise = (async () => {
                const translations = await this.translations();
                const inst = new Actives(this.wsApiClient, this.staticHost, translations);
                this.activesFacade = inst;
                this.activesPromise = undefined;
                return inst;
            })();
        }
        return this.activesPromise;
    }
    async currencies() {
        if (this.currenciesFacade)
            return this.currenciesFacade;
        if (!this.currenciesPromise) {
            this.currenciesPromise = (async () => {
                const inst = new Currencies(this.wsApiClient, this.staticHost);
                this.currenciesFacade = inst;
                this.currenciesPromise = undefined;
                return inst;
            })();
        }
        return this.currenciesPromise;
    }
    /**
     * Returns quotes facade class.
     */
    async quotes() {
        if (this.quotesFacade)
            return this.quotesFacade;
        if (!this.quotesPromise) {
            this.quotesPromise = (async () => {
                const inst = new Quotes(this.wsApiClient);
                this.quotesFacade = inst;
                this.quotesPromise = undefined;
                return inst;
            })();
        }
        return this.quotesPromise;
    }
    /**
     * Returns blitz options facade class.
     */
    async blitzOptions() {
        if (this.blitzOptionsFacade)
            return this.blitzOptionsFacade;
        if (!this.blitzOptionsPromise) {
            this.blitzOptionsPromise = (async () => {
                if (!await this.blitzOptionsIsAvailable()) {
                    throw new Error('Blitz options are not available');
                }
                const inst = await BlitzOptions.create(this.wsApiClient);
                this.blitzOptionsFacade = inst;
                this.blitzOptionsPromise = undefined;
                return inst;
            })();
        }
        return this.blitzOptionsPromise;
    }
    /**
     * Blitz options availability check.
     */
    async blitzOptionsIsAvailable() {
        return this.instrumentIsAvailable('blitz-instrument');
    }
    /**
     * Returns turbo options facade class.
     */
    async turboOptions() {
        if (this.turboOptionsFacade)
            return this.turboOptionsFacade;
        if (!this.turboOptionsPromise) {
            this.turboOptionsPromise = (async () => {
                if (!await this.turboOptionsIsAvailable()) {
                    throw new Error('Turbo options are not available');
                }
                const inst = await TurboOptions.create(this.wsApiClient);
                this.turboOptionsFacade = inst;
                this.turboOptionsPromise = undefined;
                return inst;
            })();
        }
        return this.turboOptionsPromise;
    }
    /**
     * Turbo options availability check.
     */
    async turboOptionsIsAvailable() {
        return this.instrumentIsAvailable('turbo-instrument');
    }
    /**
     * Returns binary options facade class.
     */
    async binaryOptions() {
        if (this.binaryOptionsFacade)
            return this.binaryOptionsFacade;
        if (!this.binaryOptionsPromise) {
            this.binaryOptionsPromise = (async () => {
                if (!await this.binaryOptionsIsAvailable()) {
                    throw new Error('Binary options are not available');
                }
                const inst = await BinaryOptions.create(this.wsApiClient);
                this.binaryOptionsFacade = inst;
                this.binaryOptionsPromise = undefined;
                return inst;
            })();
        }
        return this.binaryOptionsPromise;
    }
    /**
     * Binary options availability check.
     */
    async binaryOptionsIsAvailable() {
        return this.instrumentIsAvailable('binary-instrument');
    }
    /**
     * Returns digital options facade class.
     */
    async digitalOptions() {
        if (this.digitalOptionsFacade)
            return this.digitalOptionsFacade;
        if (!this.digitalOptionsPromise) {
            this.digitalOptionsPromise = (async () => {
                if (!await this.digitalOptionsIsAvailable()) {
                    throw new Error('Digital options are not available');
                }
                const inst = await DigitalOptions.create(this.wsApiClient);
                this.digitalOptionsFacade = inst;
                this.digitalOptionsPromise = undefined;
                return inst;
            })();
        }
        return this.digitalOptionsPromise;
    }
    /**
     * Digital options availability check.
     */
    async digitalOptionsIsAvailable() {
        return this.instrumentIsAvailable('digital-instrument');
    }
    /**
     * Returns margin forex facade class.
     */
    async marginForex() {
        if (this.marginForexFacade)
            return this.marginForexFacade;
        if (!this.marginForexPromise) {
            this.marginForexPromise = (async () => {
                if (!await this.marginForexIsAvailable()) {
                    throw new Error('Margin forex is not available');
                }
                const inst = await MarginForex.create(this.wsApiClient);
                this.marginForexFacade = inst;
                this.marginForexPromise = undefined;
                return inst;
            })();
        }
        return this.marginForexPromise;
    }
    /**
     * Margin forex availability check.
     */
    async marginForexIsAvailable() {
        return this.instrumentIsAvailable('margin-forex-instrument');
    }
    /**
     * Returns margin cfd facade class.
     */
    async marginCfd() {
        if (this.marginCfdFacade)
            return this.marginCfdFacade;
        if (!this.marginCfdPromise) {
            this.marginCfdPromise = (async () => {
                if (!await this.marginCfdIsAvailable()) {
                    throw new Error('Margin CFD is not available');
                }
                const inst = await MarginCfd.create(this.wsApiClient);
                this.marginCfdFacade = inst;
                this.marginCfdPromise = undefined;
                return inst;
            })();
        }
        return this.marginCfdPromise;
    }
    /**
     * Margin cfd availability check.
     */
    async marginCfdIsAvailable() {
        return this.instrumentIsAvailable('margin-cfd-instrument');
    }
    /**
     * Returns margin crypto facade class.
     */
    async marginCrypto() {
        if (this.marginCryptoFacade)
            return this.marginCryptoFacade;
        if (!this.marginCryptoPromise) {
            this.marginCryptoPromise = (async () => {
                if (!await this.marginCryptoIsAvailable()) {
                    throw new Error('Margin crypto is not available');
                }
                const inst = await MarginCrypto.create(this.wsApiClient);
                this.marginCryptoFacade = inst;
                this.marginCryptoPromise = undefined;
                return inst;
            })();
        }
        return this.marginCryptoPromise;
    }
    /**
     * Margin crypto availability check.
     */
    async marginCryptoIsAvailable() {
        return this.instrumentIsAvailable('margin-crypto-instrument');
    }
    async instrumentIsAvailable(instrumentFeature) {
        if (this.instrumentsIsAvailable.has(instrumentFeature)) {
            return this.instrumentsIsAvailable.get(instrumentFeature);
        }
        const response = await this.wsApiClient.doRequest(new CallGetFeaturesV2());
        for (const feature of response.features) {
            if (feature.name === instrumentFeature && feature.status === 'disabled') {
                this.instrumentsIsAvailable.set(instrumentFeature, false);
                return false;
            }
        }
        this.instrumentsIsAvailable.set(instrumentFeature, true);
        return true;
    }
    /**
     * Returns orders facade class.
     */
    async orders() {
        if (this.ordersFacade)
            return this.ordersFacade;
        if (!this.ordersPromise) {
            this.ordersPromise = (async () => {
                const balances = await this.balances();
                const balanceIds = balances.getBalances().map(b => b.id);
                const inst = await Orders.create(this.wsApiClient, this.userProfile.userId, balanceIds);
                this.ordersFacade = inst;
                this.ordersPromise = undefined;
                return inst;
            })();
        }
        return this.ordersPromise;
    }
    async candles() {
        if (this.candlesFacade)
            return this.candlesFacade;
        if (!this.candlesPromise) {
            this.candlesPromise = (async () => {
                const inst = new Candles(this.wsApiClient);
                this.candlesFacade = inst;
                this.candlesPromise = undefined;
                return inst;
            })();
        }
        return this.candlesPromise;
    }
    /**
     * Returns chats facade class.
     */
    async chats() {
        if (this.chatsFacade)
            return this.chatsFacade;
        if (!this.chatsPromise) {
            this.chatsPromise = (async () => {
                const inst = await Chats.create(this.wsApiClient);
                this.chatsFacade = inst;
                this.chatsPromise = undefined;
                return inst;
            })();
        }
        return this.chatsPromise;
    }
    async realTimeChartDataLayer(activeId, size) {
        if (!this.realTimeChartDataLayerFacade) {
            this.realTimeChartDataLayerFacade = {};
        }
        if (!this.realTimeChartDataLayerFacade[activeId]) {
            this.realTimeChartDataLayerFacade[activeId] = {};
        }
        if (!this.realTimeChartDataLayerFacade[activeId][size]) {
            this.realTimeChartDataLayerFacade[activeId][size] = (async () => {
                const candles = await this.candles();
                const wsConnectionState = await this.wsConnectionState();
                const consistencyManager = await this.candlesConsistencyManager();
                return RealTimeChartDataLayer.create(this.wsApiClient, wsConnectionState, consistencyManager, candles, activeId, size);
            })();
        }
        return this.realTimeChartDataLayerFacade[activeId][size];
    }
    /**
     * Returns ws current time.
     */
    currentTime() {
        return new Date(this.wsApiClient.currentTime.unixMilliTime);
    }
    /**
     * Subscribe to WebSocket current time updates.
     * @param callback - Callback function that will be called when current time updates.
     */
    subscribeOnWsCurrentTime(callback) {
        this.wsApiClient.subscribeOnWsCurrentTime((time) => callback(new Date(time)));
    }
    /**
     * Unsubscribe from WebSocket current time updates.
     * @param callback - Callback function to unsubscribe.
     */
    unsubscribeOnWsCurrentTime(callback) {
        this.wsApiClient.unsubscribeOnWsCurrentTime((time) => callback(new Date(time)));
    }
    /**
     * Get WebSocket connection state facade.
     */
    async wsConnectionState() {
        if (this.wsConnectionStateFacade)
            return this.wsConnectionStateFacade;
        if (!this.wsConnectionStatePromise) {
            this.wsConnectionStatePromise = (async () => {
                const inst = await WsConnectionState.create(this.wsApiClient);
                this.wsConnectionStateFacade = inst;
                this.wsConnectionStatePromise = undefined;
                return inst;
            })();
        }
        return this.wsConnectionStatePromise;
    }
    /**
     * Returns translations facade class.
     */
    async translations() {
        if (this.translationsFacade)
            return this.translationsFacade;
        if (!this.translationsPromise) {
            this.translationsPromise = (async () => {
                const inst = await Translations.create(this.host);
                this.translationsFacade = inst;
                this.translationsPromise = undefined;
                return inst;
            })();
        }
        return this.translationsPromise;
    }
    async candlesConsistencyManager() {
        if (this.candlesConsistencyManagerFacade)
            return this.candlesConsistencyManagerFacade;
        if (!this.candlesConsistencyManagerPromise) {
            this.candlesConsistencyManagerPromise = (async () => {
                const candles = await this.candles();
                const wsConnectionState = await this.wsConnectionState();
                const inst = new CandlesConsistencyManager(wsConnectionState, candles);
                this.candlesConsistencyManagerFacade = inst;
                this.candlesConsistencyManagerPromise = undefined;
                return inst;
            })();
        }
        return this.candlesConsistencyManagerPromise;
    }
}
/**
 * Dummy implementation of OAuth tokens storage.
 */
class DummyOAuthTokensStorage {
    tokens = { accessToken: '' };
    get() {
        return Promise.resolve(this.tokens);
    }
    set(tokens) {
        this.tokens = tokens;
        return Promise.resolve();
    }
}
/**
 * Implements SSID authentication flow.
 */
export class SsidAuthMethod {
    ssid;
    /**
     * Accepts SSID for authentication.
     *
     * @param ssid - User's session ID.
     */
    constructor(ssid) {
        this.ssid = ssid;
    }
    /**
     * Authenticates client in WebSocket API.
     * @param wsApiClient - Instance of WebSocket API client.
     */
    async authenticateWsApiClient(wsApiClient) {
        const authResponse = await wsApiClient.doRequest(new Authenticate(this.ssid));
        return authResponse.isSuccessful;
    }
}
/**
 * Implements OAuth2 authentication flow.
 */
export class OAuthMethod {
    apiBaseUrl;
    clientId;
    redirectUri;
    scope;
    clientSecret;
    accessToken;
    refreshToken;
    affId;
    afftrack;
    affModel;
    tokensStorage;
    isBrowser = typeof window !== 'undefined';
    attempts = 0;
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
    constructor(apiBaseUrl, clientId, redirectUri, scope, clientSecret, accessToken, refreshToken, affId, afftrack, affModel, tokensStorage) {
        this.apiBaseUrl = apiBaseUrl;
        this.clientId = clientId;
        this.redirectUri = redirectUri;
        this.scope = scope;
        this.clientSecret = clientSecret;
        this.accessToken = accessToken;
        this.refreshToken = refreshToken;
        this.affId = affId;
        this.afftrack = afftrack;
        this.affModel = affModel;
        this.tokensStorage = tokensStorage;
        if (!this.tokensStorage) {
            this.tokensStorage = new DummyOAuthTokensStorage();
            this.tokensStorage.set({
                accessToken: this.accessToken || '',
                refreshToken: this.refreshToken,
            }).then();
        }
        if (this.isBrowser && this.clientSecret) {
            throw new Error('Client secret should not be used in browser applications');
        }
    }
    /**
     * Authenticates client in WebSocket API.
     * @param wsApiClient
     */
    async authenticateWsApiClient(wsApiClient) {
        const maxAttempts = 4;
        this.attempts += 1;
        const result = await this.authenticateWsApiClientWithoutAttempts(wsApiClient);
        if (result.ok) {
            if (result.refreshed) {
                throw new AuthMethodRequestedReconnectException();
            }
            this.attempts = 0;
            return true;
        }
        if (this.attempts === maxAttempts - 1) {
            return false;
        }
        const backoffMs = Math.min(500 * 2 ** this.attempts, 5000);
        await this.sleep(backoffMs);
        throw new AuthMethodRequestedReconnectException();
    }
    async authenticateWsApiClientWithoutAttempts(wsApiClient) {
        const tokens = await this.tokensStorage.get();
        if (!tokens.accessToken) {
            return { ok: false };
        }
        const authResponse = await wsApiClient.doRequest(new Authenticate(tokens.accessToken));
        if (authResponse.isSuccessful) {
            return { ok: true, refreshed: false };
        }
        if (!tokens.refreshToken || !this.clientSecret) {
            return { ok: false };
        }
        try {
            await this.refreshAccessToken();
            return { ok: true, refreshed: true };
        }
        catch {
            return { ok: false };
        }
    }
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    /**
     * Creates authorization URL and code verifier for PKCE flow.
     */
    async createAuthorizationUrl() {
        const codeVerifier = this.generateCodeVerifier(96);
        const codeChallenge = await this.generateCodeChallenge(codeVerifier);
        const state = this.randomUrlSafe(16);
        const request = new HttpOAuthRequest(this.redirectUri, this.clientId, this.scope, codeChallenge, "S256", state, this.affId, this.afftrack, this.affModel);
        let url = this.apiBaseUrl;
        if (!this.apiBaseUrl.startsWith('http://') && !this.apiBaseUrl.startsWith('https://')) {
            url = `https://${this.apiBaseUrl}`;
        }
        return { url: request.buildUrl(url), codeVerifier };
    }
    /**
     * Exchanges authorization code for access token and refresh token.
     * @param code
     * @param codeVerifier
     */
    async issueAccessTokenWithAuthCode(code, codeVerifier) {
        const httpApiClient = this.httpApiClient();
        const response = await httpApiClient.doRequest(new HttpAccessTokenRequest(code, this.clientId, codeVerifier, this.redirectUri));
        if (response.status === 200 && response.data.accessToken) {
            await this.tokensStorage.set({
                accessToken: response.data.accessToken,
                refreshToken: response.data.refreshToken
            });
            return {
                accessToken: response.data.accessToken,
                expiresIn: response.data.expiresIn,
                refreshToken: response.data.refreshToken
            };
        }
        else {
            throw new Error(`Failed to issue access token: ${response.status}`);
        }
    }
    generateCodeVerifier(length = 64) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
        let result = '';
        const array = new Uint8Array(length);
        crypto.getRandomValues(array);
        for (let i = 0; i < length; i++) {
            result += chars[array[i] % chars.length];
        }
        return result;
    }
    async generateCodeChallenge(codeVerifier) {
        const data = new TextEncoder().encode(codeVerifier);
        const digest = await crypto.subtle.digest('SHA-256', data);
        return this.base64url(new Uint8Array(digest));
    }
    randomUrlSafe(bytes = 16) {
        const a = new Uint8Array(bytes);
        crypto.getRandomValues(a);
        return this.base64url(a);
    }
    base64url(input) {
        let str = '';
        for (let i = 0; i < input.length; i++)
            str += String.fromCharCode(input[i]);
        return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    }
    async refreshAccessToken() {
        const tokens = await this.tokensStorage.get();
        if (!tokens.refreshToken || !this.clientSecret) {
            return Promise.reject('Refresh token or client secret is not set');
        }
        const httpApiClient = this.httpApiClient();
        const response = await httpApiClient.doRequest(new HttpRefreshAccessTokenRequest(tokens.refreshToken, this.clientId, this.clientSecret));
        if (response.status === 200 && 'accessToken' in response.data) {
            await this.tokensStorage.set({
                accessToken: response.data.accessToken,
                refreshToken: response.data.refreshToken
            });
            return {
                accessToken: response.data.accessToken,
                expiresIn: response.data.expiresIn,
                refreshToken: response.data.refreshToken
            };
        }
        if ('code' in response.data) {
            return Promise.reject(`Failed to refresh access token: ${response.data.code} ${response.data.message}`);
        }
        return Promise.reject(`Failed to refresh access token: ${response.status}`);
    }
    httpApiClient() {
        if (!this.apiBaseUrl.startsWith('http://') && !this.apiBaseUrl.startsWith('https://')) {
            return new HttpApiClient(`https://${this.apiBaseUrl}`);
        }
        return new HttpApiClient(this.apiBaseUrl);
    }
}
/**
 * @deprecated Use {@link OAuthMethod} instead.
 * Implements login/password authentication flow.
 */
export class LoginPasswordAuthMethod {
    httpApiUrl;
    login;
    password;
    httpApiClient;
    /**
     * Accepts login and password for authentication.
     *
     * @param httpApiUrl Base URL for HTTP API.
     * @param login User login.
     * @param password User password.
     */
    constructor(httpApiUrl, login, password) {
        this.httpApiUrl = httpApiUrl;
        this.login = login;
        this.password = password;
        this.httpApiClient = new HttpApiClient(this.httpApiUrl);
    }
    /**
     * Authenticates client in WebSocket API.
     * @param wsApiClient WebSocket API client instance.
     */
    async authenticateWsApiClient(wsApiClient) {
        const response = await this.httpApiClient.doRequest(new HttpLoginRequest(this.login, this.password));
        if (response.status === 200 && response.data.code === 'success') {
            const authResponse = await wsApiClient.doRequest(new Authenticate(response.data.ssid));
            return authResponse.isSuccessful;
        }
        return false;
    }
}
export class AuthMethodRequestedReconnectException extends Error {
    constructor(message = "Auth method requested reconnect", options) {
        super(message);
        this.name = "AuthMethodRequestedReconnectException";
        if (options?.cause) {
            this.cause = options.cause;
        }
        Object.setPrototypeOf(this, new.target.prototype);
    }
}
/**
 * Don't use this class directly from your code. Use {@link ClientSdk.userProfile} field instead.
 *
 * User profile facade class. Stores information about the user on whose behalf your application is working.
 */
export class UserProfile {
    userId;
    firstName;
    lastName;
    /**
     * Creates instance of class {@link UserProfile}.
     * @internal
     * @private
     * @param profile
     */
    constructor(profile) {
        this.userId = profile.userId;
        this.firstName = profile.firstName;
        this.lastName = profile.lastName;
    }
    /**
     * Requests information about current user, puts the information to instance of class UserProfile and returns it.
     * @param wsApiClient - Instance of WebSocket API client.
     */
    static async create(wsApiClient) {
        const userProfile = await wsApiClient.doRequest(new CallCoreGetProfileV1());
        return new UserProfile(userProfile);
    }
}
/**
 * Don't use this class directly from your code. Use {@link ClientSdk.balances} static method instead.
 *
 * Balances facade class. Stores information about user's balances. Keeps balances' information up to date.
 */
export class Balances {
    types;
    /**
     * Balances current state.
     * @private
     */
    balances = new Map();
    /**
     * Create instance from DTO.
     * @param types - List of supported balance type ids.
     * @param balancesMsg - Balances data transfer object.
     * @param wsApiClient - Instance of WebSocket API client.
     * @internal
     * @private
     */
    constructor(types, balancesMsg, wsApiClient) {
        this.types = types;
        for (const index in balancesMsg.items) {
            const balance = new Balance(balancesMsg.items[index], wsApiClient);
            this.balances.set(balance.id, balance);
        }
    }
    /**
     * Requests information about user's balances, subscribes on user's balances updates, puts the information to instance of class Balances and returns it.
     * @param wsApiClient - Instance of WebSocket API client.
     */
    static async create(wsApiClient) {
        const types = [1, 4];
        const balancesMsg = await wsApiClient.doRequest(new CallBalancesGetAvailableBalancesV1(types));
        const balances = new Balances(types, balancesMsg, wsApiClient);
        let hasMargin = false;
        for (const [index] of balances.balances) {
            const balance = balances.balances.get(index);
            await wsApiClient.doRequest(new CallSubscribeMarginPortfolioBalanceChangedV1(balance.id));
            if (balance.isMargin) {
                const marginBalance = await wsApiClient.doRequest(new CallMarginGetMarginBalanceV1(balance.id));
                balance.updateMargin(marginBalance);
                hasMargin = true;
            }
        }
        if (hasMargin) {
            await wsApiClient.subscribe(new SubscribeMarginPortfolioBalanceChangedV1(), (event) => {
                balances.updateMarginBalance(event);
            });
        }
        await wsApiClient.subscribe(new SubscribeBalancesBalanceChangedV1(), (event) => {
            balances.updateBalance(event);
        });
        return balances;
    }
    /**
     * Returns list of user's balances. Every item of the list is reference to refreshable object.
     */
    getBalances() {
        const list = [];
        for (const [index] of this.balances) {
            list.push(this.balances.get(index));
        }
        return list;
    }
    /**
     * Returns user's balance with specified ID. If balance does not exist then error will be thrown.
     * @param balanceId - Balance identification number.
     */
    getBalanceById(balanceId) {
        if (!this.balances.has(balanceId)) {
            throw new Error(`balance with id '${balanceId}' is not found`);
        }
        return this.balances.get(balanceId);
    }
    /**
     * Adds specified callback to balance update subscribers' list.
     *
     * @param balanceId
     * @param callback
     */
    subscribeOnUpdateBalance(balanceId, callback) {
        if (!this.balances.has(balanceId)) {
            throw new Error(`balance with id '${balanceId}' is not found`);
        }
        this.balances.get(balanceId).subscribeOnUpdate(callback);
    }
    /**
     * Removes specified callback from balance update subscribers' list.
     *
     * @param balanceId
     * @param callback
     */
    unsubscribeOnUpdateBalance(balanceId, callback) {
        if (!this.balances.has(balanceId)) {
            throw new Error(`balance with id '${balanceId}' is not found`);
        }
        this.balances.get(balanceId).unsubscribeOnUpdate(callback);
    }
    /**
     * Updates instance from DTO.
     * @param balanceChangedMsg - Balances data transfer object.
     * @private
     */
    updateBalance(balanceChangedMsg) {
        if (!this.types.includes(balanceChangedMsg.type)) {
            return;
        }
        if (!this.balances.has(balanceChangedMsg.id)) {
            return;
        }
        this.balances.get(balanceChangedMsg.id).update(balanceChangedMsg);
    }
    /**
     * Updates instance from DTO.
     * @param balanceChangedMsg - Margin balances data transfer object.
     * @private
     */
    updateMarginBalance(balanceChangedMsg) {
        if (!this.types.includes(balanceChangedMsg.type)) {
            return;
        }
        if (!this.balances.has(balanceChangedMsg.id)) {
            return;
        }
        this.balances.get(balanceChangedMsg.id).updateMargin(balanceChangedMsg);
    }
}
/**
 * User's balance refreshable class.
 */
export class Balance {
    /**
     * User's balance identification number.
     */
    id;
    /**
     * User's balance type.
     */
    type;
    /**
     * Current amount of money on user's balance.
     */
    amount;
    /**
     * Current amount of bonuses.
     */
    bonusAmount;
    /**
     * User's balance currency code (ISO 4217).
     */
    currency;
    /**
     * User's identification number.
     */
    userId;
    /**
     * Is margin balance.
     */
    isMargin = false;
    /**
     * Gross Profit and Loss (PnL).
     */
    pnl;
    /**
     * Net Profit and Loss (PnL) after deductions.
     */
    pnlNet;
    /**
     * Total equity in the account.
     */
    equity;
    /**
     * Total equity in USD.
     */
    equityUsd;
    /**
     * Swap charges for holding positions overnight.
     */
    swap;
    /**
     * Dividends received or paid.
     */
    dividends;
    /**
     * Margin used by the account.
     */
    margin;
    /**
     * Available margin for new positions.
     */
    available;
    /**
     * Current amount of money on margin user's balance.
     */
    cash;
    /**
     * Margin level as a percentage.
     */
    marginLevel;
    /**
     * Stop out level where positions are closed to prevent losses.
     */
    stopOutLevel;
    /**
     * Balance updates observer.
     * @private
     */
    onUpdateObserver = new Observable();
    /**
     * Instance of WebSocket API client.
     * @private
     */
    wsApiClient;
    /**
     * Initialises the class instance from DTO.
     * @param msg - Balance data transfer object.
     * @param wsApiClient
     * @internal
     * @private
     */
    constructor(msg, wsApiClient) {
        this.id = msg.id;
        this.type = this.convertBalanceType(msg.type);
        this.amount = msg.amount;
        this.bonusAmount = msg.bonusAmount;
        this.currency = msg.currency;
        this.userId = msg.userId;
        this.isMargin = msg.isMargin;
        this.wsApiClient = wsApiClient;
    }
    /**
     * Adds specified callback to balance update subscribers' list.
     * @param callback - Callback will be called for every change of balance.
     */
    subscribeOnUpdate(callback) {
        this.onUpdateObserver.subscribe(callback);
    }
    /**
     * Removes specified callback from balance update subscribers' list.
     * @param callback - Callback for remove.
     */
    unsubscribeOnUpdate(callback) {
        this.onUpdateObserver.unsubscribe(callback);
    }
    /**
     * Resets demo balance to 10000.
     */
    async resetDemoBalance() {
        if (this.type !== BalanceType.Demo) {
            throw new Error('Only demo balance can be reset');
        }
        await this.wsApiClient.doRequest(new CallInternalBillingResetTrainingBalanceV4(this.id, 10000));
    }
    /**
     * Returns available amount for margin trading.
     */
    availableForMarginAmount() {
        if (this.isMargin) {
            return this.available || 0;
        }
        return this.amount;
    }
    /**
     * Returns available amount for options trading.
     */
    availableForOptionsAmount() {
        if (this.isMargin) {
            if (this.available && this.cash) {
                if (this.available < this.cash) {
                    return this.available + this.bonusAmount;
                }
                else {
                    return this.cash + this.bonusAmount;
                }
            }
        }
        return this.amount + this.bonusAmount;
    }
    /**
     * Updates the class instance from DTO.
     * @param msg - Balance data transfer object.
     * @private
     */
    update(msg) {
        this.type = this.convertBalanceType(msg.type);
        this.amount = msg.amount;
        this.bonusAmount = msg.bonusAmount;
        this.currency = msg.currency;
        this.userId = msg.userId;
        this.onUpdateObserver.notify(this);
    }
    updateMargin(msg) {
        this.pnl = msg.pnl;
        this.pnlNet = msg.pnlNet;
        this.equity = msg.equity;
        this.equityUsd = msg.equityUsd;
        this.swap = msg.swap;
        this.dividends = msg.dividends;
        this.margin = msg.margin;
        this.available = msg.available;
        this.cash = msg.cash;
        this.marginLevel = msg.marginLevel;
        this.stopOutLevel = msg.stopOutLevel;
        this.bonusAmount = msg.bonus;
        this.onUpdateObserver.notify(this);
    }
    /**
     * Converts balance type id to text representation.
     * @param typeId - Balance type ID.
     * @private
     */
    convertBalanceType(typeId) {
        switch (typeId) {
            case 1:
                return BalanceType.Real;
            case 4:
                return BalanceType.Demo;
        }
        return undefined;
    }
}
/**
 * WebSocket connection state enum.
 */
export var WsConnectionStateEnum;
(function (WsConnectionStateEnum) {
    /**
     * WebSocket is connected and ready to use
     */
    WsConnectionStateEnum["Connected"] = "connected";
    /**
     * WebSocket is disconnected
     */
    WsConnectionStateEnum["Disconnected"] = "disconnected";
})(WsConnectionStateEnum || (WsConnectionStateEnum = {}));
/**
 * Do not use this class directly from your code. Use {@link ClientSdk.wsConnectionState} static method instead.
 *
 * WebSocket connection state facade.
 */
export class WsConnectionState {
    wsApiClient;
    onStateChangedObserver = new Observable();
    constructor(wsApiClient) {
        this.wsApiClient = wsApiClient;
        this.wsApiClient.onConnectionStateChanged = (state) => {
            this.onStateChangedObserver.notify(state);
        };
    }
    static async create(wsApiClient) {
        return new WsConnectionState(wsApiClient);
    }
    /**
     * Subscribe to WebSocket connection state changes.
     * @param callback - Callback function that will be called when the state changes.
     */
    subscribeOnStateChanged(callback) {
        this.onStateChangedObserver.subscribe(callback);
    }
    /**
     * Unsubscribe from WebSocket connection state changes.
     * @param callback - Callback function to unsubscribe.
     */
    unsubscribeOnStateChanged(callback) {
        this.onStateChangedObserver.unsubscribe(callback);
    }
}
/**
 * Don't use this class directly from your code. Use {@link ClientSdk.candles} static method instead.
 *
 * Candles facade class.
 */
export class Candles {
    /**
     * Instance of WebSocket API client.
     * @private
     */
    wsApiClient;
    /**
     * Creates class instance.
     * @param wsApiClient - Instance of WebSocket API client.
     * @internal
     * @private
     */
    constructor(wsApiClient) {
        this.wsApiClient = wsApiClient;
    }
    /**
     * Get candles for specified active.
     * @param activeId
     * @param size
     * @param options
     */
    async getCandles(activeId, size, options = undefined) {
        const response = await this.wsApiClient.doRequest(new CallQuotesHistoryGetCandlesV2({
            activeId,
            size,
            options
        }));
        return response.candles;
    }
}
/**
 * Candle data transfer object.
 */
export class Candle {
    id;
    from;
    to;
    open;
    close;
    min;
    max;
    volume;
    at;
    constructor(data) {
        this.id = data.id;
        this.from = data.from;
        this.to = data.to;
        this.open = data.open;
        this.close = data.close;
        this.min = data.min;
        this.max = data.max;
        this.volume = data.volume;
        this.at = data.at;
    }
}
/**
 * Available translation groups.
 */
export var TranslationGroup;
(function (TranslationGroup) {
    TranslationGroup["Front"] = "front";
    TranslationGroup["Assets"] = "assets";
    TranslationGroup["Desktop"] = "desktop";
})(TranslationGroup || (TranslationGroup = {}));
/**
 * Don't use this class directly from your code. Use {@link ClientSdk.translations} static method instead.
 *
 * Translations facade class.
 */
export class Translations {
    translations = {};
    reloadInterval;
    reloadIntervalMs = 10 * 60 * 1000; // 10 minutes
    httpApiClient;
    loadedLanguages = new Set();
    loadedGroups = new Set();
    inFlight = new Map();
    retryAttempts = 3;
    retryBaseDelayMs = 300;
    retryMaxDelayMs = 2000;
    constructor(host) {
        this.httpApiClient = new HttpApiClient(host);
    }
    static async create(host) {
        const instance = new Translations(host);
        await instance.fetchTranslations('en', [TranslationGroup.Front]);
        instance.startAutoReload();
        return instance;
    }
    startAutoReload() {
        this.reloadInterval = setInterval(async () => {
            for (const lang of this.loadedLanguages) {
                const groups = Array.from(this.loadedGroups);
                if (groups.length > 0) {
                    await this.fetchTranslations(lang, groups);
                }
            }
        }, this.reloadIntervalMs);
    }
    /**
     * Fetches translations from the server.
     * @param lang - Language code (e.g. 'en', 'ru')
     * @param groups - Array of translation groups to fetch
     */
    async fetchTranslations(lang, groups) {
        const key = this.makeFetchKey(lang, groups);
        const existing = this.inFlight.get(key);
        if (existing)
            return existing;
        const promise = this.fetchTranslationsWithRetry(lang, groups).catch((err) => {
            console.warn(`[Translations] Failed to fetch translations: lang=${lang} groups=${groups.join(',')}`, err);
        }).finally(() => {
            this.inFlight.delete(key);
        });
        this.inFlight.set(key, promise);
        return promise;
    }
    async fetchTranslationsWithRetry(lang, groups) {
        for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
            const res = await this.tryFetchTranslationsOnce(lang, groups, attempt);
            if (res.ok) {
                return;
            }
            if (attempt === this.retryAttempts) {
                console.warn(`[Translations] Could not fetch translations after ${this.retryAttempts} attempts: lang=${lang} groups=${groups.join(',')}`, res.error);
                return;
            }
            await this.sleep(this.calcRetryDelay(attempt));
        }
    }
    async tryFetchTranslationsOnce(lang, groups, attempt) {
        try {
            const response = await this.httpApiClient.doRequest(new HttpGetTranslationsRequest(lang, groups));
            if (!response.isSuccessful || !response.data) {
                return { ok: false, error: new Error(`Unsuccessful response (attempt ${attempt})`) };
            }
            const next = response.data.result?.[lang];
            if (!next || Object.keys(next).length === 0) {
                return {
                    ok: false,
                    error: new Error(`Empty translations payload for lang=${lang} (attempt ${attempt})`)
                };
            }
            this.translations[lang] = { ...(this.translations[lang] ?? {}), ...next };
            this.loadedLanguages.add(lang);
            groups.forEach(group => this.loadedGroups.add(group));
            return { ok: true };
        }
        catch (err) {
            return { ok: false, error: err };
        }
    }
    makeFetchKey(lang, groups) {
        const sorted = [...groups].sort().join(',');
        return `${lang}:${sorted}`;
    }
    calcRetryDelay(attempt) {
        const exp = Math.min(this.retryMaxDelayMs, this.retryBaseDelayMs * Math.pow(2, attempt - 1));
        const jitter = Math.floor(Math.random() * 100);
        return exp + jitter;
    }
    sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
    /**
     * Gets translation for a specific key in the specified language.
     * @param key - Translation key (e.g. 'front.W')
     * @param lang - Language code (defaults to 'en')
     */
    getTranslation(key, lang = 'en') {
        return this.translations[lang]?.[key] || key;
    }
    /**
     * Stops automatic reloading of translations and cleans up resources.
     */
    close() {
        if (this.reloadInterval) {
            clearInterval(this.reloadInterval);
            this.reloadInterval = undefined;
        }
        this.inFlight.clear();
    }
}
/**
 * Balance type enum.
 */
export var BalanceType;
(function (BalanceType) {
    /**
     * Real balance type. This type is used for trading on real funds.
     */
    BalanceType["Real"] = "real";
    /**
     * Demo balance type. This type is used for practice/testing on non-real funds. Funds on demo balance can't be withdrawal.
     */
    BalanceType["Demo"] = "demo";
})(BalanceType || (BalanceType = {}));
/**
 * Don't use this class directly from your code. Use {@link ClientSdk.actives} static method instead.
 *
 * Actives facade class. Stores information about actives. Keeps actives' information up to date.
 */
export class Actives {
    wsApiClient;
    translations;
    activeCache = new Map();
    activeData = new Map();
    staticHost;
    constructor(wsApiClient, staticHost, translations) {
        this.wsApiClient = wsApiClient;
        this.staticHost = staticHost;
        this.translations = translations;
    }
    /**
     * Returns active data with caching.
     * @param activeId - Active ID.
     */
    async getActive(activeId) {
        if (this.activeData.has(activeId)) {
            return this.activeData.get(activeId);
        }
        if (this.activeCache.has(activeId)) {
            return this.activeCache.get(activeId);
        }
        const activePromise = this.wsApiClient.doRequest(new CallGetActiveV5(activeId))
            .then((response) => {
            const active = new Active(response, this.staticHost, this.translations);
            this.activeData.set(activeId, active);
            this.activeCache.delete(activeId);
            return active;
        })
            .catch((error) => {
            this.activeCache.delete(activeId);
            throw error;
        });
        this.activeCache.set(activeId, activePromise);
        return activePromise;
    }
}
/**
 * Active data transfer object.
 */
export class Active {
    /**
     * Active ID.
     */
    id;
    /**
     * Active name.
     */
    name;
    /**
     * Active description.
     */
    description;
    /**
     * Active localization key.
     */
    localizationKey;
    /**
     * Active image URL.
     */
    imageUrl;
    /**
     * Is active OTC.
     */
    isOtc;
    /**
     * Trading time from.
     */
    timeFrom;
    /**
     * Trading time to.
     */
    timeTo;
    /**
     * Active precision.
     */
    precision;
    /**
     * Active pip scale.
     */
    pipScale;
    /**
     * Active spread plus.
     */
    spreadPlus;
    /**
     * Active spread minus.
     */
    spreadMinus;
    /**
     * Active expiration days.
     */
    expirationDays;
    /**
     * Active currency left side.
     */
    currencyLeftSide;
    /**
     * Active currency right side.
     */
    currencyRightSide;
    /**
     * Active type.
     */
    type;
    /**
     * Active min quantity.
     */
    minQty;
    /**
     * Active quantity step.
     */
    qtyStep;
    /**
     * Active quantity type.
     */
    typeQty;
    constructor(response, staticHost, translations) {
        this.id = response.id;
        this.localizationKey = `${TranslationGroup.Front}.${response.name}`;
        this.name = translations.getTranslation(this.localizationKey);
        this.description = translations.getTranslation(`${TranslationGroup.Front}.${response.description}`);
        this.imageUrl = `${staticHost}${response.image}`;
        this.isOtc = response.isOtc;
        this.timeFrom = response.timeFrom;
        this.timeTo = response.timeTo;
        this.precision = response.precision;
        this.pipScale = response.pipScale;
        this.spreadPlus = response.spreadPlus;
        this.spreadMinus = response.spreadMinus;
        this.expirationDays = response.expirationDays;
        this.currencyLeftSide = response.currencyLeftSide;
        this.currencyRightSide = response.currencyRightSide;
        this.type = response.type;
        this.minQty = response.minQty;
        this.qtyStep = response.qtyStep;
        this.typeQty = response.typeQty;
    }
}
/**
 * Don't use this class directly from your code. Use {@link ClientSdk.currencies} static method instead.
 *
 * Currencies facade class. Stores information about currencies. Keeps currencies information up to date.
 */
export class Currencies {
    wsApiClient;
    currencyCache = new Map();
    currencyData = new Map();
    staticHost;
    constructor(wsApiClient, staticHost) {
        this.wsApiClient = wsApiClient;
        this.staticHost = staticHost;
    }
    /**
     * Returns currency data with caching.
     * @param currencyCode - Currency code (example: USD).
     */
    async getCurrency(currencyCode) {
        if (this.currencyData.has(currencyCode)) {
            return this.currencyData.get(currencyCode);
        }
        if (this.currencyCache.has(currencyCode)) {
            return this.currencyCache.get(currencyCode);
        }
        const currencyPromise = this.wsApiClient.doRequest(new CallGetCurrencyV5(currencyCode))
            .then((response) => {
            const currency = new Currency(response, this.staticHost);
            this.currencyData.set(currencyCode, currency);
            this.currencyCache.delete(currencyCode);
            return currency;
        })
            .catch((error) => {
            this.currencyCache.delete(currencyCode);
            throw error;
        });
        this.currencyCache.set(currencyCode, currencyPromise);
        return currencyPromise;
    }
}
/**
 * Currency data transfer object.
 */
export class Currency {
    /**
     * Currency ID.
     */
    id;
    /**
     * Currency name.
     */
    name;
    /**
     * Currency description.
     */
    description;
    /**
     * Currency symbol ($).
     */
    symbol;
    /**
     * Currency mask ($%s).
     */
    mask;
    /**
     * Currency is tradable.
     */
    isTradable;
    /**
     * Currency code
     */
    code;
    /**
     * Currency unit.
     */
    unit;
    /**
     * Currency rate.
     */
    rate;
    /**
     * Currency rate in USD.
     */
    rateUsd;
    /**
     * Currency min deal amount.
     */
    minDealAmount;
    /**
     * Currency max deal amount.
     */
    maxDealAmount;
    /**
     * Currency minor units.
     */
    minorUnits;
    /**
     * Currency image URL.
     */
    imageUrl;
    /**
     * Currency is crypto.
     */
    isCrypto;
    /**
     * Currency is inout.
     */
    isInout;
    /**
     * Currency interest rate.
     */
    interestRate;
    constructor(response, staticHost) {
        this.id = response.id;
        this.name = response.name;
        this.description = response.description;
        this.symbol = response.symbol;
        this.mask = response.mask;
        this.isTradable = response.isTradable;
        this.code = response.code;
        this.unit = response.unit;
        this.rate = response.rate;
        this.rateUsd = response.rateUsd;
        this.minDealAmount = response.minDealAmount;
        this.maxDealAmount = response.maxDealAmount;
        this.minorUnits = response.minorUnits;
        this.imageUrl = `${staticHost}/${response.image}`;
        this.isCrypto = response.isCrypto;
        this.isInout = response.isInout;
        this.interestRate = response.interestRate;
    }
}
/**
 * RealTimeChartDataLayer provides real-time and historical candle data for a given activeId and candleSize.
 */
export class RealTimeChartDataLayer {
    wsApiClient;
    candlesFacade;
    candlesConsistencyManager;
    activeId;
    candleSize;
    candles = [];
    connected = true;
    subscribed = false;
    loadedFrom = null;
    loadedTo = null;
    firstCandleFrom = null;
    currentReject = null;
    wsUnsubscribe = null;
    onUpdateObserver = new Observable();
    onConsistencyUpdateObserver = new Observable();
    candleQueue = [];
    isProcessingQueue = false;
    isRecoveringMissedCandles = false;
    candlesMutationsLock = Promise.resolve();
    static MAX_CANDLES_PER_REQUEST = 1000;
    constructor(wsApiClient, wsConnectionState, consistencyManager, candles, activeId, candleSize, firstCandleFrom) {
        this.wsApiClient = wsApiClient;
        this.candlesFacade = candles;
        this.candlesConsistencyManager = consistencyManager;
        this.activeId = activeId;
        this.candleSize = candleSize;
        this.firstCandleFrom = firstCandleFrom;
        wsConnectionState.subscribeOnStateChanged((state) => {
            switch (state) {
                case WsConnectionStateEnum.Connected:
                    this.connected = true;
                    this.isRecoveringMissedCandles = true;
                    this.loadMissedCandlesOnReconnect().finally(() => {
                        this.isRecoveringMissedCandles = false;
                        this.processQueue().then(() => {
                        });
                    });
                    break;
                case WsConnectionStateEnum.Disconnected:
                    this.connected = false;
                    this.isProcessingQueue = false;
                    for (const { reject } of this.candleQueue) {
                        reject(new Error('WebSocket disconnected'));
                    }
                    if (this.currentReject) {
                        this.currentReject(new Error('WebSocket disconnected'));
                        this.currentReject = null;
                    }
                    this.candleQueue = [];
                    break;
            }
        });
    }
    static async create(wsApiClient, wsConnectionState, consistencyManager, candles, activeId, candleSize) {
        let firstCandleFrom = null;
        try {
            const response = await wsApiClient.doRequest(new CallQuotesGetFirstCandlesV1(activeId));
            const candle = response.candlesBySize?.[candleSize];
            if (candle)
                firstCandleFrom = candle.from;
        }
        catch (e) {
            console.warn('Failed to fetch first candle:', e);
        }
        return new RealTimeChartDataLayer(wsApiClient, wsConnectionState, consistencyManager, candles, activeId, candleSize, firstCandleFrom);
    }
    /**
     * Returns the last candle for the activeId and candleSize.
     */
    getAllCandles() {
        return this.candles;
    }
    /**
     * Returns the first candle timestamp for the activeId and candleSize.
     */
    getFirstCandleFrom() {
        return this.firstCandleFrom;
    }
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
    async fetchAllCandles(from) {
        if (this.firstCandleFrom !== null && from < this.firstCandleFrom) {
            from = this.firstCandleFrom;
        }
        return new Promise((resolve, reject) => {
            this.candleQueue.push({ from, resolve, reject });
            this.processQueue();
        });
    }
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
    async fetchCandles(to, countBack) {
        return new Promise((resolve, reject) => {
            this.candleQueue.push({ countBack, to, resolve, reject });
            this.processQueue();
        });
    }
    async processQueue() {
        if (this.isProcessingQueue || this.isRecoveringMissedCandles || this.candleQueue.length === 0 || !this.connected) {
            return;
        }
        this.isProcessingQueue = true;
        const { from, to, countBack, resolve, reject } = this.candleQueue.shift();
        this.currentReject = reject;
        let onlyRange = false;
        if (to) {
            onlyRange = true;
        }
        try {
            if (from && this.loadedFrom !== null && from >= this.loadedFrom) {
                resolve(this.candles);
            }
            else {
                let toCurrent = to;
                if (!toCurrent) {
                    if (this.loadedFrom) {
                        toCurrent = this.loadedFrom - 1;
                    }
                    else if (this.candles.length > 0) {
                        toCurrent = this.candles[0].from - 1;
                    }
                    else {
                        toCurrent = undefined;
                    }
                }
                const newCandles = await this.candlesFacade.getCandles(this.activeId, this.candleSize, {
                    from,
                    to: toCurrent,
                    count: countBack
                });
                let hasGaps = newCandles.some((c, i, arr) => i > 0 && c.id - arr[i - 1].id !== 1);
                const missingIntervals = [];
                if (newCandles.length > 0 && this.candles.length > 0 && this.loadedFrom !== null) {
                    const currentFirstCandle = this.candles[0];
                    const newLastCandle = newCandles[newCandles.length - 1];
                    const delta = currentFirstCandle.id - newLastCandle.id;
                    const maxDelta = 1000;
                    if (delta > 1) {
                        hasGaps = true;
                        if (delta > maxDelta) {
                            const fromIdMissing = currentFirstCandle.id - maxDelta;
                            const toIdMissing = currentFirstCandle.id;
                            missingIntervals.push({ fromId: fromIdMissing, toId: toIdMissing });
                        }
                        else {
                            missingIntervals.push({ fromId: newLastCandle.id, toId: currentFirstCandle.id });
                        }
                    }
                }
                if (hasGaps) {
                    for (let i = 1; i < newCandles.length; i++) {
                        const prev = newCandles[i - 1];
                        const curr = newCandles[i];
                        const delta = curr.id - prev.id;
                        if (delta > 1) {
                            const fromMissing = prev.id;
                            const toMissing = curr.id;
                            missingIntervals.push({ fromId: fromMissing, toId: toMissing });
                        }
                    }
                    this.recoverGapsAsync(missingIntervals).then();
                    this.candles = [...newCandles, ...this.candles];
                    if (!from) {
                        this.loadedFrom = this.candles[0].from;
                    }
                    else {
                        this.loadedFrom = this.loadedFrom !== null ? Math.min(this.loadedFrom, from) : from;
                    }
                    if (onlyRange) {
                        resolve(newCandles);
                    }
                    else {
                        resolve(this.candles);
                    }
                }
                else {
                    this.candles = [...newCandles, ...this.candles];
                    if (!from) {
                        this.loadedFrom = this.candles[0].from;
                    }
                    else {
                        this.loadedFrom = this.loadedFrom !== null ? Math.min(this.loadedFrom, from) : from;
                    }
                    if (onlyRange) {
                        resolve(newCandles);
                    }
                    else {
                        resolve(this.candles);
                    }
                }
            }
        }
        catch (error) {
            reject(error);
        }
        finally {
            this.isProcessingQueue = false;
            this.currentReject = null;
            this.processQueue().then();
        }
    }
    /**
     * Subscribes to real-time updates for the last candle.
     * @param handler
     */
    subscribeOnLastCandleChanged(handler) {
        if (!this.subscribed) {
            this.subscribed = true;
            const subscribeCandleGeneratedV1 = new SubscribeCandleGeneratedV1(this.activeId, this.candleSize);
            this.wsApiClient.subscribe(subscribeCandleGeneratedV1, (event) => {
                if (event.activeId !== this.activeId || event.size !== this.candleSize) {
                    return;
                }
                if (this.connected) {
                    this.handleRealtimeUpdate(event).then();
                }
            }).then(() => {
                this.wsUnsubscribe = () => {
                    this.wsApiClient.unsubscribe(subscribeCandleGeneratedV1).then();
                };
                if (this.onUpdateObserver.observers.length === 0) {
                    this.wsUnsubscribe();
                    this.wsUnsubscribe = null;
                    this.subscribed = false;
                }
            });
        }
        this.onUpdateObserver.subscribe(handler);
    }
    /**
     * Unsubscribes from real-time updates for the last candle.
     * @param handler
     */
    unsubscribeOnLastCandleChanged(handler) {
        this.onUpdateObserver.unsubscribe(handler);
        if (this.onUpdateObserver.observers.length === 0 && this.wsUnsubscribe !== null) {
            this.wsUnsubscribe();
            this.wsUnsubscribe = null;
            this.subscribed = false;
        }
    }
    /**
     * Subscribes to consistency updates for the candles.
     * @param handler
     */
    subscribeOnConsistencyRecovered(handler) {
        this.onConsistencyUpdateObserver.subscribe(handler);
    }
    /**
     * Unsubscribes from consistency updates for the candles.
     * @param handler
     */
    unsubscribeOnConsistencyRecovered(handler) {
        this.onConsistencyUpdateObserver.unsubscribe(handler);
    }
    async recoverGapsAsync(missingIntervals) {
        const gapPromises = missingIntervals.map(async ({ fromId, toId }) => {
            try {
                const gapCandles = await this.candlesConsistencyManager
                    .fetchCandles(fromId, toId, this.activeId, this.candleSize);
                return ({ fromId, toId, gapCandles });
            }
            catch (err) {
                console.warn(`Failed to fetch gap from ${fromId} to ${toId}:`, err);
                return null;
            }
        });
        function findInsertIndex(candles, targetTo) {
            let low = 0, high = candles.length;
            while (low < high) {
                const mid = Math.floor((low + high) / 2);
                if (candles[mid].id < targetTo) {
                    low = mid + 1;
                }
                else {
                    high = mid;
                }
            }
            return low;
        }
        const results = await Promise.all(gapPromises);
        const mutations = results
            .filter((r) => !!r)
            .map((result) => {
            const { toId, gapCandles } = result;
            return () => {
                let insertIndex = findInsertIndex(this.candles, toId);
                const from = gapCandles[0].from;
                const to = gapCandles[gapCandles.length - 1].to;
                if (insertIndex === 0) {
                    this.candles.splice(insertIndex, 1);
                }
                else if (insertIndex === this.candles.length) {
                    this.candles.splice(insertIndex - 1, 1);
                    insertIndex -= 1;
                }
                else {
                    this.candles.splice(insertIndex - 1, 2);
                    insertIndex -= 1;
                }
                this.candles.splice(insertIndex, 0, ...gapCandles);
                this.onConsistencyUpdateObserver.notify({ from, to });
            };
        });
        for (const mutate of mutations) {
            this.candlesMutationsLock = this.candlesMutationsLock.then(() => {
                mutate();
            });
            await this.candlesMutationsLock;
        }
    }
    async handleRealtimeUpdate(newCandle) {
        const candle = new Candle(newCandle);
        const mutate = async () => {
            const last = this.candles[this.candles.length - 1];
            if (!last) {
                this.candles.push(candle);
            }
            else if (newCandle.from === last.from) {
                this.candles[this.candles.length - 1] = candle;
            }
            else if (newCandle.from > last.from) {
                this.candles.push(candle);
                if (this.loadedTo === null || candle.to > this.loadedTo) {
                    this.loadedTo = candle.to;
                }
                const delta = candle.id - last.id;
                if (delta > 1 || (last.at && last.to !== last.at / 1_000_000_000)) {
                    this.recoverGapsAsync([{ fromId: last.id, toId: candle.id }]).then();
                }
            }
            else {
                return;
            }
            this.onUpdateObserver.notify(candle);
        };
        this.candlesMutationsLock = this.candlesMutationsLock.then(() => mutate());
        await this.candlesMutationsLock;
    }
    buildMissedCandlesRequest() {
        if (this.loadedTo === null)
            return null;
        const now = Math.floor(this.wsApiClient.currentTime.unixMilliTime / 1000);
        const last = this.candles[this.candles.length - 1];
        const baseFrom = last && this.isOpenCandle(last) ? last.from : this.loadedTo;
        const maxRangeSeconds = RealTimeChartDataLayer.MAX_CANDLES_PER_REQUEST * this.candleSize;
        let from = Math.min(baseFrom, now);
        if (now - from > maxRangeSeconds) {
            from = now - maxRangeSeconds;
        }
        if (this.firstCandleFrom !== null && from < this.firstCandleFrom) {
            from = this.firstCandleFrom;
        }
        if (from >= now) {
            return null;
        }
        return { from, to: now };
    }
    buildMissedCandlesFallbackRequest() {
        return {
            to: Math.floor(this.wsApiClient.currentTime.unixMilliTime / 1000),
            count: RealTimeChartDataLayer.MAX_CANDLES_PER_REQUEST,
        };
    }
    isOpenCandle(candle) {
        return candle.at !== undefined && candle.to > candle.at / 1_000_000_000;
    }
    isRequestErrorWithStatus(error, status) {
        return error instanceof Error && error.status === status;
    }
    errorDetails(error) {
        return error instanceof Error ? error.details : undefined;
    }
    logMissedCandlesRecoveryError(error, recoveryRequest, fallbackRequest) {
        console.error('Failed to load missed candles after reconnect:', {
            activeId: this.activeId,
            candleSize: this.candleSize,
            recoveryRequest,
            fallbackRequest,
            error,
            details: this.errorDetails(error),
        });
    }
    async loadMissedCandlesOnReconnect() {
        const recoveryRequest = this.buildMissedCandlesRequest();
        if (!recoveryRequest)
            return;
        try {
            let newCandles;
            try {
                newCandles = await this.candlesFacade.getCandles(this.activeId, this.candleSize, recoveryRequest);
            }
            catch (error) {
                if (!this.isRequestErrorWithStatus(error, 4220)) {
                    this.logMissedCandlesRecoveryError(error, recoveryRequest);
                    return;
                }
                const fallbackRequest = this.buildMissedCandlesFallbackRequest();
                try {
                    newCandles = await this.candlesFacade.getCandles(this.activeId, this.candleSize, fallbackRequest);
                }
                catch (fallbackError) {
                    this.logMissedCandlesRecoveryError(fallbackError, recoveryRequest, fallbackRequest);
                    return;
                }
            }
            if (!this.connected) {
                return;
            }
            const hasGaps = newCandles.some((c, i, arr) => i > 0 && c.id - arr[i - 1].id !== 1);
            if (hasGaps) {
                const missingIntervals = [];
                for (let i = 1; i < newCandles.length; i++) {
                    const prev = newCandles[i - 1];
                    const curr = newCandles[i];
                    const delta = curr.id - prev.id;
                    if (delta > 1 && delta <= RealTimeChartDataLayer.MAX_CANDLES_PER_REQUEST) {
                        const fromIdMissing = prev.id;
                        const toIdMissing = curr.id;
                        missingIntervals.push({ fromId: fromIdMissing, toId: toIdMissing });
                    }
                }
                this.recoverGapsAsync(missingIntervals).then();
            }
            this.candlesMutationsLock = this.candlesMutationsLock.then(() => {
                for (const candle of newCandles) {
                    const existingIndex = this.candles.findIndex(c => c.from === candle.from);
                    if (existingIndex !== -1) {
                        this.candles[existingIndex] = candle;
                    }
                    else {
                        this.candles.push(candle);
                    }
                    if (this.loadedTo === null || candle.to > this.loadedTo) {
                        this.loadedTo = candle.to;
                    }
                    this.onUpdateObserver.notify(candle);
                }
            });
            await this.candlesMutationsLock;
        }
        catch (error) {
            this.logMissedCandlesRecoveryError(error, recoveryRequest);
        }
    }
}
class CandlesConsistencyManager {
    candlesFacade;
    isProcessingQueue = false;
    connected = true;
    maxRetries = 10;
    candleQueue = [];
    currentQueueElement = null;
    constructor(wsConnectionState, candles) {
        this.candlesFacade = candles;
        wsConnectionState.subscribeOnStateChanged((state) => {
            switch (state) {
                case WsConnectionStateEnum.Connected:
                    this.connected = true;
                    this.processQueue().then();
                    break;
                case WsConnectionStateEnum.Disconnected:
                    this.connected = false;
                    this.isProcessingQueue = false;
                    break;
            }
        });
    }
    fetchCandles(fromId, toId, activeId, candleSize) {
        return new Promise((resolve, reject) => {
            this.candleQueue.push({ fromId, toId, activeId, candleSize, retries: 0, resolve, reject });
            this.processQueue().then();
        });
    }
    async processQueue() {
        if (this.isProcessingQueue || this.candleQueue.length === 0 || !this.connected) {
            return;
        }
        this.isProcessingQueue = true;
        const element = this.candleQueue.shift();
        this.currentQueueElement = element;
        const { fromId, toId, activeId, candleSize, retries, resolve, reject } = element;
        const delay = Math.min(100 * 2 ** retries, 10000);
        const jitter = Math.random() * 100;
        try {
            const candles = await this.candlesFacade.getCandles(activeId, candleSize, { fromId, toId });
            let hasGaps = candles.some((c, i, arr) => i > 0 && c.id - arr[i - 1].id !== 1);
            const firstCandle = candles[0];
            const lastCandle = candles[candles.length - 1];
            if (!hasGaps && firstCandle.id !== fromId || lastCandle.id !== toId) {
                hasGaps = true;
            }
            if (hasGaps || candles.length === 0) {
                if (retries < this.maxRetries) {
                    setTimeout(() => {
                        this.candleQueue.unshift({ ...element, retries: retries + 1 });
                        this.processQueue().then();
                    }, delay + jitter);
                }
                else {
                    reject(new Error(`Candles have gaps. Max retries reached (${this.maxRetries})`));
                }
            }
            else {
                resolve(candles);
            }
        }
        catch (error) {
            if (retries < this.maxRetries) {
                setTimeout(() => {
                    this.candleQueue.unshift({ ...element, retries: retries + 1 });
                    this.processQueue().then();
                }, delay + jitter);
            }
            else {
                reject(new Error(`Failed to fetch candles after ${this.maxRetries} retries: ${error}`));
            }
        }
        finally {
            this.isProcessingQueue = false;
            this.currentQueueElement = null;
            setTimeout(() => this.processQueue(), 0);
        }
    }
}
/**
 * Don't use this class directly from your code. Use {@link ClientSdk.quotes} static method instead.
 *
 * Quotes facade class. Stores information about quotes (market data). Keeps quotes' information up to date.
 */
export class Quotes {
    /**
     * Instance of WebSocket API client.
     * @private
     */
    wsApiClient;
    /**
     * Quotes current state.
     * @private
     */
    currentQuotes = new Map();
    /**
     * Creates class instance.
     * @param wsApiClient - Instance of WebSocket API client.
     * @internal
     * @private
     */
    constructor(wsApiClient) {
        this.wsApiClient = wsApiClient;
    }
    /**
     * Returns refreshable current quote instance for specified active.
     * @param activeId - Active ID for which the current quote is requested.
     */
    async getCurrentQuoteForActive(activeId) {
        if (this.currentQuotes.has(activeId)) {
            return this.currentQuotes.get(activeId);
        }
        const currentQuote = new CurrentQuote();
        this.currentQuotes.set(activeId, currentQuote);
        await this.wsApiClient.subscribe(new SubscribeQuoteGeneratedV2(activeId), (event) => {
            if (event.activeId !== activeId) {
                return;
            }
            currentQuote.update(event);
        });
        return currentQuote;
    }
}
/**
 * Active's current quote refreshable class.
 */
export class CurrentQuote {
    /**
     * Current quote's active ID.
     */
    activeId;
    /**
     * Current quote's time.
     */
    time;
    /**
     * Current quote's ask (offer) price.
     */
    ask;
    /**
     * Current quote's bid price.
     */
    bid;
    /**
     * Current quote's middle price between ask and bid. `value=(ask+bid)/2`. This price is used for buy/expire option's orders.
     */
    value;
    /**
     * Current quote's phase.
     *
     * `T` - quote is inside regular trading session.
     *
     * `C` - quote is outside any trading session.
     */
    phase;
    /**
     * Position updates observer.
     * @private
     */
    onUpdateObserver = new Observable();
    /**
     * Adds specified callback to current quote update subscribers' list.
     * @param callback - Callback will be called for every change of current quote.
     */
    subscribeOnUpdate(callback) {
        this.onUpdateObserver.subscribe(callback);
    }
    /**
     * Removes specified callback from current quote update subscribers' list.
     * @param callback - Callback for remove.
     */
    unsubscribeOnUpdate(callback) {
        this.onUpdateObserver.unsubscribe(callback);
    }
    /**
     * Updates current quote from DTO.
     * @param msg - Current quote data transfer object.
     * @private
     */
    update(msg) {
        this.activeId = msg.activeId;
        this.time = new Date(msg.time);
        this.ask = msg.ask;
        this.bid = msg.bid;
        this.value = msg.value;
        this.phase = msg.phase;
        this.onUpdateObserver.notify(this);
    }
}
/**
 * Don't use this class directly from your code. Use the following methods instead:
 *
 * * {@link ClientSdk.chats}
 *
 * Chats facade class. Provides access to chat rooms and real-time chat messages.
 */
export class Chats {
    /**
     * Instance of WebSocket API client.
     * @private
     */
    wsApiClient;
    /**
     * Cached list of available chat rooms.
     * @private
     */
    chatRooms = [];
    /**
     * Active chat subscriptions keyed by room ID.
     * @private
     */
    activeSubscriptions = new Map();
    /**
     * Chat message observers keyed by room ID.
     * @private
     */
    messageObservers = new Map();
    /**
     * Creates class instance.
     * @param wsApiClient - Instance of WebSocket API client.
     * @internal
     * @private
     */
    constructor(wsApiClient) {
        this.wsApiClient = wsApiClient;
    }
    /**
     * Creates and initializes Chats facade. Fetches available chat rooms on creation.
     * @param wsApiClient - Instance of WebSocket API client.
     * @internal
     */
    static async create(wsApiClient) {
        const instance = new Chats(wsApiClient);
        await instance.fetchChatRooms();
        return instance;
    }
    /**
     * Fetches list of available chat rooms from the server.
     * @private
     */
    async fetchChatRooms() {
        const response = await this.wsApiClient.doRequest(new CallRequestChatRoom());
        this.chatRooms = response.rooms;
    }
    /**
     * Returns the cached list of available chat rooms.
     */
    getChatRooms() {
        return this.chatRooms;
    }
    /**
     * Subscribes to real-time messages for the specified chat room.
     * @param chatId - Chat room ID to subscribe to.
     * @param callback - Callback that will be called for each incoming message batch.
     */
    async subscribeChat(chatId, callback) {
        if (!this.messageObservers.has(chatId)) {
            this.messageObservers.set(chatId, new Observable());
            const subscribeRequest = new SubscribeChatMessagePublicGenerated(chatId);
            this.activeSubscriptions.set(chatId, subscribeRequest);
            await this.wsApiClient.subscribe(subscribeRequest, (event) => {
                const observer = this.messageObservers.get(chatId);
                if (observer) {
                    event.messages.forEach((message) => {
                        observer.notify(message);
                    });
                }
            });
        }
        this.messageObservers.get(chatId).subscribe(callback);
    }
    /**
     * Unsubscribes a specific callback from chat room messages.
     * If no callbacks remain, the WebSocket subscription is also removed.
     * @param chatId - Chat room ID to unsubscribe from.
     * @param callback - The callback to remove.
     */
    async unsubscribeChat(chatId, callback) {
        const observer = this.messageObservers.get(chatId);
        if (!observer) {
            return;
        }
        observer.unsubscribe(callback);
        if (observer.observers.length === 0) {
            const subscribeRequest = this.activeSubscriptions.get(chatId);
            if (subscribeRequest) {
                await this.wsApiClient.unsubscribe(subscribeRequest);
                this.activeSubscriptions.delete(chatId);
            }
            this.messageObservers.delete(chatId);
        }
    }
    /**
     * Cleans up all active chat subscriptions.
     */
    close() {
        for (const [, subscribeRequest] of this.activeSubscriptions) {
            this.wsApiClient.unsubscribe(subscribeRequest);
        }
        this.activeSubscriptions.clear();
        this.messageObservers.clear();
    }
}
/**
 * Chat room information.
 */
export class ChatRoom {
    /**
     * Chat room ID.
     */
    id;
    /**
     * Chat room type (e.g. "global", "notification", "support").
     */
    type;
    /**
     * Chat room locale (e.g. "en_US") or null.
     */
    locale;
    /**
     * Chat room subject.
     */
    subject;
    /**
     * Chat room internal name.
     */
    name;
    /**
     * Localized chat room name.
     */
    nameLoc;
    /**
     * Chat room icon URL.
     */
    icon;
    /**
     * Chat room icon 2x URL.
     */
    icon2x;
    /**
     * Whether the chat uses real names for senders.
     */
    useRealName;
    /**
     * Whether the chat is public.
     */
    isPublic;
    /**
     * Whether writing to the chat is allowed.
     */
    isWrite;
    /**
     * Whether the chat is regulated.
     */
    isRegulated;
    /**
     * Whether there are unread messages.
     */
    isUnreadMessages;
    /**
     * Last read message ID.
     */
    lastReadMessageId;
    /**
     * Number of online users in the chat.
     */
    onlineUsers;
    constructor(data) {
        this.id = data.id;
        this.type = data.type;
        this.locale = data.locale;
        this.subject = data.subject;
        this.name = data.name;
        this.nameLoc = data.name_loc;
        this.icon = data.icon;
        this.icon2x = data.icon_2x;
        this.useRealName = data.use_real_name;
        this.isPublic = data.is_public;
        this.isWrite = data.is_write;
        this.isRegulated = data.is_regulated;
        this.isUnreadMessages = data.is_unread_messages;
        this.lastReadMessageId = data.last_read_message_id;
        this.onlineUsers = data.online_users;
    }
}
/**
 * Incoming chat message event containing one or more messages.
 */
export class ChatMessageEvent {
    /**
     * Array of chat messages received in this event.
     */
    messages;
    constructor(data) {
        this.messages = [];
        if (data.data && Array.isArray(data.data)) {
            for (const item of data.data) {
                this.messages.push(new ChatMessage(item));
            }
        }
    }
}
/**
 * Individual chat message.
 */
export class ChatMessage {
    /**
     * Message ID.
     */
    id;
    /**
     * Room ID this message belongs to.
     */
    roomId;
    /**
     * Message type.
     */
    type;
    /**
     * Message text content.
     */
    text;
    /**
     * Sender display name.
     */
    sender;
    /**
     * Sender user ID.
     */
    senderId;
    /**
     * Sender country flag code.
     */
    senderFlag;
    /**
     * Sender avatar URL.
     */
    senderAvatarUrl;
    /**
     * Whether the sender is a VIP user.
     */
    isSenderVip;
    /**
     * Whether the sender is a professional.
     */
    isSenderProfessional;
    /**
     * Whether the sender is an admin.
     */
    isSenderAdmin;
    /**
     * Whether the sender is a system account.
     */
    isSenderSystem;
    /**
     * Message timestamp in milliseconds.
     */
    date;
    /**
     * Whether the message has been removed.
     */
    removed;
    /**
     * Whether the message is visible to author only.
     */
    authorOnly;
    /**
     * Message attachments.
     */
    attachments;
    /**
     * Previous message ID in the room.
     */
    previousId;
    constructor(data) {
        this.id = data.id;
        this.roomId = data.room_id;
        this.type = data.type;
        this.text = data.text;
        this.sender = data.sender;
        this.senderId = data.sender_id;
        this.senderFlag = data.sender_flag;
        this.senderAvatarUrl = data.sender_avatar_url;
        this.isSenderVip = data.is_sender_vip;
        this.isSenderProfessional = data.is_sender_professional;
        this.isSenderAdmin = data.is_sender_admin;
        this.isSenderSystem = data.is_sender_system;
        this.date = new Date(data.date);
        this.removed = data.removed;
        this.authorOnly = data.author_only;
        this.attachments = data.attachments || [];
        this.previousId = data.previous_id || null;
    }
}
// endregion
/**
 * Don't use this class directly from your code. Use the following methods instead:
 *
 * * {@link ClientSdk.positions}
 *
 * Positions facade class. Stores information about opened positions. Keeps positions' information up to date.
 */
export class Positions {
    /**
     * Positions current state.
     * @private
     */
    positions = new Map();
    /**
     * Positions history.
     * @private
     */
    positionsHistoryFacade;
    /**
     * Positions' history array.
     * @private
     */
    positionsHistory = [];
    /**
     * Positions' IDs cache.
     * @private
     */
    positionsIds = new Map();
    /**
     * Positions updates observer.
     * @private
     */
    onUpdatePositionObserver = new Observable();
    /**
     * Timer for periodical actives list update.
     * @private
     */
    intervalId;
    /**
     * Instance of WebSocket API client.
     * @private
     */
    wsApiClient;
    /**
     * Actives facade.
     * @private
     */
    actives;
    /**
     * Digital options facade.
     * @private
     */
    digitalOptions;
    /**
     * List of supported instrument types.
     * @private
     */
    instrumentTypes = ["digital-option", "binary-option", "turbo-option", "blitz-option", "marginal-cfd", "marginal-crypto", "marginal-forex"];
    /**
     * Just private constructor. Just private constructor. Use {@link Positions.create create} instead.
     * @internal
     * @private
     */
    constructor() {
    }
    /**
     * Subscribes on opened positions' updates, requests current state of opened positions, puts the current state to instance of class Positions and returns it.
     * @param wsApiClient - Instance of WebSocket API client.
     * @param userId - User's identification number.
     * @param actives - Actives facade.
     */
    static async create(wsApiClient, userId, actives, state) {
        const positionsFacade = new Positions();
        positionsFacade.actives = actives;
        positionsFacade.wsApiClient = wsApiClient;
        positionsFacade.positionsHistoryFacade = new PositionsHistory(wsApiClient, userId, positionsFacade.positionsHistory);
        await positionsFacade.syncOldActivePositions();
        await positionsFacade.subscribePositionChanged(userId);
        await positionsFacade.subscribePositionsState();
        await positionsFacade.subscribePositions();
        state.subscribeOnStateChanged(((state) => {
            if (state === WsConnectionStateEnum.Connected) {
                positionsFacade.syncOldActivePositions();
            }
        }));
        positionsFacade.intervalId = setInterval(async () => {
            await positionsFacade.subscribePositions();
        }, 60000);
        return positionsFacade;
    }
    /**
     * Subscribes on position's updates.
     *
     * @private
     */
    async subscribePositionChanged(userId) {
        await this.wsApiClient.subscribe(new SubscribePortfolioPositionChangedV3(userId), (event) => {
            this.syncPositionFromEvent(event);
        });
    }
    /**
     * Subscribes on positions states updates.
     * @private
     */
    async subscribePositionsState() {
        this.wsApiClient.subscribe(new SubscribePortfolioPositionsStateV1(), (event) => {
            this.syncPositionsStateFromEvent(event);
        }).then(() => {
        });
    }
    /**
     * Synchronizes old active positions.
     * @private
     */
    async syncOldActivePositions() {
        const previousIds = new Set(this.positions.keys());
        const receivedIds = new Set();
        let offset = 0;
        const limit = 30;
        for (;;) {
            const positionsPage = await this.wsApiClient.doRequest(new CallPortfolioGetPositionsV4(this.instrumentTypes, limit, offset));
            for (const raw of positionsPage.positions) {
                receivedIds.add(raw.externalId);
                this.syncPositionFromResponse(raw);
            }
            if (positionsPage.positions.length < positionsPage.limit) {
                break;
            }
            offset += limit;
        }
        const missingIds = [...previousIds].filter(id => !receivedIds.has(id));
        for (const id of missingIds) {
            try {
                const position = await this.positionsHistoryFacade?.getPositionHistory(id);
                if (!position) {
                    continue;
                }
                this.syncPosition(position);
            }
            catch (e) {
                // console.warn(`Position ${id} not found in history`, e)
            }
        }
    }
    /**
     * @deprecated. Use {@link Positions.getOpenedPositions} instead.
     * Returns list of all positions.
     */
    getAllPositions() {
        const list = [];
        for (const [index] of this.positions) {
            list.push(this.positions.get(index));
        }
        return list;
    }
    /**
     * Returns list of opened positions.
     */
    getOpenedPositions() {
        const list = [];
        for (const [index] of this.positions) {
            list.push(this.positions.get(index));
        }
        return list;
    }
    /**
     * Returns positions history.
     */
    getPositionsHistory() {
        if (!this.positionsHistoryFacade) {
            throw new Error("Positions history facade is not available");
        }
        return this.positionsHistoryFacade;
    }
    /**
     * Checks if a given order ID matches any of the order IDs associated with a position.
     * @param orderId
     * @param position
     */
    isOrderMatchingPosition(orderId, position) {
        return position.orderIds.includes(orderId);
    }
    /**
     * Adds specified callback to position update subscribers' list.
     * @param callback - Callback will be called for every change of position.
     */
    subscribeOnUpdatePosition(callback) {
        this.onUpdatePositionObserver.subscribe(callback);
    }
    /**
     * Removes specified callback from position update subscribers' list.
     * @param callback - Callback for remove.
     */
    unsubscribeOnUpdatePosition(callback) {
        this.onUpdatePositionObserver.unsubscribe(callback);
    }
    /**
     * Updates instance from DTO.
     * @param msg - Positions state data transfer object.
     * @private
     */
    syncPositionsStateFromEvent(msg) {
        for (const index in msg.positions) {
            const key = `${msg.positions[index].instrumentType}-${msg.positions[index].internalId}`;
            const externalId = this.positionsIds.get(key);
            if (!externalId) {
                continue;
            }
            const position = this.positions.get(externalId);
            if (!position) {
                continue;
            }
            position.syncFromStateEvent(msg.positions[index]);
            this.onUpdatePositionObserver.notify(position);
        }
    }
    /**
     * Updates instance from DTO.
     * @param msg - Position data transfer object.
     * @private
     */
    syncPositionFromResponse(msg) {
        const isNewPosition = !this.positions.has(msg.externalId);
        if (isNewPosition) {
            const position = new Position(this.wsApiClient);
            position.externalId = msg.externalId;
            this.positions.set(msg.externalId, position);
            const key = `${msg.instrumentType}-${msg.internalId}`;
            this.positionsIds.set(key, msg.externalId);
        }
        const position = this.positions.get(msg.externalId);
        position.syncFromResponse(msg);
        this.onUpdatePositionObserver.notify(position);
        if (isNewPosition) {
            this.subscribePositions().then();
        }
        if (!position.active && position.activeId) {
            this.actives.getActive(position.activeId).then((active) => {
                position.active = active;
            });
        }
        if (position.status === "closed") {
            this.positions.delete(msg.externalId);
            this.positionsIds.delete(`${msg.instrumentType}-${msg.internalId}`);
            this.positionsHistory.unshift(position);
        }
    }
    /**
     * Updates instance from DTO.
     * @param position - Position object.
     * @private
     */
    syncPosition(position) {
        const isNewPosition = !this.positions.has(position.externalId);
        if (isNewPosition) {
            this.positions.set(position.externalId, position);
            const key = `${position.instrumentType}-${position.internalId}`;
            this.positionsIds.set(key, position.externalId);
        }
        this.onUpdatePositionObserver.notify(position);
        if (isNewPosition) {
            this.subscribePositions().then();
        }
        if (!position.active && position.activeId) {
            this.actives.getActive(position.activeId).then((active) => {
                position.active = active;
            });
        }
        if (position.status === "closed") {
            this.positions.delete(position.externalId);
            this.positionsIds.delete(`${position.instrumentType}-${position.internalId}`);
            this.positionsHistory.unshift(position);
        }
    }
    /**
     * Updates instance from DTO.
     * @param msg - Position data transfer object.
     * @private
     */
    syncPositionFromEvent(msg) {
        const isNewPosition = !this.positions.has(msg.externalId);
        if (isNewPosition) {
            const position = new Position(this.wsApiClient);
            position.externalId = msg.externalId;
            this.positions.set(msg.externalId, position);
            const key = `${msg.instrumentType}-${msg.internalId}`;
            this.positionsIds.set(key, msg.externalId);
        }
        const position = this.positions.get(msg.externalId);
        position.syncFromEvent(msg);
        this.onUpdatePositionObserver.notify(position);
        if (isNewPosition) {
            this.subscribePositions().then();
        }
        if (!position.active && position.activeId) {
            this.actives.getActive(position.activeId).then((active) => {
                position.active = active;
            });
        }
        if (position.status === "closed") {
            this.positions.delete(msg.externalId);
            this.positionsIds.delete(`${msg.instrumentType}-${msg.internalId}`);
            this.positionsHistory.unshift(position);
        }
    }
    async subscribePositions() {
        const internalIds = [];
        for (const position of this.positions.values()) {
            if (position.status === "open") {
                internalIds.push(position.internalId);
            }
        }
        if (internalIds.length === 0) {
            return;
        }
        await this.wsApiClient.doRequest(new CallPortfolioSubscribePositions("frequent", internalIds)).then(() => {
        });
    }
    /**
     * Closes the instance.
     */
    close() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
        }
    }
}
/**
 * Don't use this class directly from your code. Use the following methods instead:
 *
 * * {@link ClientSdk.orders}
 *
 * Orders facade class. Stores information about opened orders. Keeps order's information up to date.
 */
export class Orders {
    /**
     * Orders current state.
     * @private
     */
    orders = new Map();
    /**
     * Orders updates observer.
     * @private
     */
    onUpdateOrderObserver = new Observable();
    /**
     * Instance of WebSocket API client.
     * @private
     */
    wsApiClient;
    /**
     * List of supported instrument types.
     * @private
     */
    instrumentTypes = ["digital-option", "marginal-cfd", "marginal-crypto", "marginal-forex"];
    /**
     * Just private constructor. Just private constructor. Use {@link Orders.create create} instead.
     * @internal
     * @private
     */
    constructor() {
    }
    /**
     * Subscribes on opened order's updates, requests current state of opened order's, puts the current state to instance of class Orders and returns it.
     * @param wsApiClient - Instance of WebSocket API client.
     * @param userId
     * @param balanceIds
     */
    static async create(wsApiClient, userId, balanceIds) {
        const ordersFacade = new Orders();
        ordersFacade.wsApiClient = wsApiClient;
        for (const index in ordersFacade.instrumentTypes) {
            await ordersFacade.subscribeOrderChanged(userId, ordersFacade.instrumentTypes[index]);
        }
        for (const index in balanceIds) {
            await ordersFacade.syncOldActiveOrders(balanceIds[index]);
        }
        return ordersFacade;
    }
    /**
     * Subscribes on order's updates.
     *
     * @private
     */
    async subscribeOrderChanged(userId, instrumentType) {
        await this.wsApiClient.subscribe(new SubscribePortfolioOrderChangedV2(userId, instrumentType), (event) => {
            if (event.instrumentType === instrumentType) {
                this.syncOrderFromEvent(event);
            }
        });
    }
    /**
     * Synchronizes old active orders.
     * @private
     */
    async syncOldActiveOrders(userBalanceId) {
        const ordersPage = await this.wsApiClient.doRequest(new CallPortfolioGetOrdersV2(userBalanceId));
        for (const index in ordersPage.orders) {
            this.syncOrderFromResponse(ordersPage.orders[index]);
        }
    }
    /**
     * Returns list of all orders.
     */
    getAllOrders() {
        const list = [];
        for (const [index] of this.orders) {
            list.push(this.orders.get(index));
        }
        return list;
    }
    /**
     * Checks if a given position associated with an order.
     * @param position
     * @param order
     */
    isPositionMatchingOrder(position, order) {
        return order.positionId === position.internalId;
    }
    /**
     * Adds specified callback to order update subscribers' list.
     * @param callback - Callback will be called for every change of order.
     */
    subscribeOnUpdateOrder(callback) {
        this.onUpdateOrderObserver.subscribe(callback);
    }
    /**
     * Removes specified callback from order update subscribers' list.
     * @param callback - Callback for remove.
     */
    unsubscribeOnUpdateOrder(callback) {
        this.onUpdateOrderObserver.unsubscribe(callback);
    }
    /**
     * Updates instance from DTO.
     * @param msg - Order data transfer object.
     * @private
     */
    syncOrderFromResponse(msg) {
        if (msg.id === undefined) {
            return;
        }
        const isNewOrder = !this.orders.has(msg.id);
        if (isNewOrder) {
            const order = new Order(this.wsApiClient);
            this.orders.set(msg.id, order);
        }
        const order = this.orders.get(msg.id);
        order.syncFromResponse(msg);
        this.onUpdateOrderObserver.notify(order);
    }
    /**
     * Updates instance from DTO.
     * @param msg - Order data transfer object.
     * @private
     */
    syncOrderFromEvent(msg) {
        if (msg.id === undefined) {
            return;
        }
        const isNewOrder = !this.orders.has(msg.id);
        if (isNewOrder) {
            const order = new Order(this.wsApiClient);
            this.orders.set(msg.id, order);
        }
        const order = this.orders.get(msg.id);
        order.syncFromEvent(msg);
        this.onUpdateOrderObserver.notify(order);
        if (order.status === "filled" || order.status === "canceled" || order.status === "rejected") {
            this.orders.delete(msg.id);
        }
    }
}
export class Order {
    /**
     * Order's identification number.
     */
    id;
    /**
     * Order status.
     */
    status;
    /**
     * Instrument type.
     */
    instrumentType;
    /**
     * Kind of order.
     */
    kind;
    /**
     * Order position ID.
     */
    positionId;
    /**
     * User ID.
     */
    userId;
    /**
     * User's balance ID.
     */
    userBalanceId;
    /**
     * Instance of WebSocket API client.
     * @private
     */
    wsApiClient;
    constructor(wsApiClient) {
        this.wsApiClient = wsApiClient;
    }
    /**
     * Synchronises order from DTO.
     * @param msg - Order data transfer object.
     * @private
     */
    syncFromResponse(msg) {
        this.id = msg.id;
        this.status = msg.status;
        this.positionId = msg.positionId;
        this.instrumentType = msg.instrumentType;
        this.kind = msg.kind;
        this.userId = msg.userId;
        this.userBalanceId = msg.userBalanceId;
    }
    /**
     * Synchronises order from DTO.
     * @param msg - Order data transfer object.
     * @private
     */
    syncFromEvent(msg) {
        this.id = msg.id;
        this.status = msg.status;
        this.positionId = msg.positionId;
        this.instrumentType = msg.instrumentType;
        this.kind = msg.kind;
        this.userId = msg.userId;
        this.userBalanceId = msg.userBalanceId;
    }
    async cancel() {
        if (!this.id) {
            throw new Error('Order id is not set');
        }
        switch (this.instrumentType) {
            case "marginal-cfd":
                await this.wsApiClient.doRequest(new CallMarginCancelPendingOrderV1("cfd", this.id));
                break;
            case "marginal-crypto":
                await this.wsApiClient.doRequest(new CallMarginCancelPendingOrderV1("crypto", this.id));
                break;
            case "marginal-forex":
                await this.wsApiClient.doRequest(new CallMarginCancelPendingOrderV1("forex", this.id));
                break;
            default:
                throw new Error(`Unsupported instrument type '${this.instrumentType}'`);
        }
    }
}
class PositionsHistory {
    /**
     * Positions history.
     * @private
     */
    positions;
    /**
     * User ID.
     * @private
     */
    userId;
    /**
     * Instance of WebSocket API client.
     * @private
     */
    wsApiClient;
    /**
     * Start time for positions history.
     * @private
     */
    startTime;
    /**
     * Limit of positions per page.
     * @private
     */
    limit = 30;
    /**
     * Offset for positions history.
     * @private
     */
    offset = 0;
    /**
     * Flag for previous page.
     * @private
     */
    prevPage = true;
    constructor(wsApiClient, userId, positions) {
        this.wsApiClient = wsApiClient;
        this.userId = userId;
        this.positions = positions;
    }
    /**
     * Fetches previous page of positions history.
     */
    async fetchPrevPage() {
        if (!this.startTime) {
            this.startTime = Math.trunc(this.wsApiClient.currentTime.unixMilliTime / 1000);
        }
        const positionsPage = await this.wsApiClient.doRequest(new CallPortfolioGetHistoryPositionsV2({
            userId: this.userId,
            limit: this.limit,
            offset: this.offset,
            end: this.startTime,
            instrumentTypes: ["digital-option", "binary-option", "turbo-option", "blitz-option"],
        }));
        for (const index in positionsPage.positions) {
            const position = new Position(this.wsApiClient);
            position.syncFromHistoryResponse(positionsPage.positions[index]);
            this.positions.push(position);
        }
        if (positionsPage.positions.length < positionsPage.limit) {
            this.prevPage = false;
        }
        this.offset += this.limit;
    }
    async getPositionHistory(externalId) {
        const positionsPage = await this.wsApiClient.doRequest(new CallPortfolioGetHistoryPositionsV2({
            instrumentTypes: ["digital-option", "binary-option", "turbo-option", "blitz-option"],
            externalId: externalId,
        }));
        if (positionsPage.positions.length === 0) {
            return undefined;
        }
        const position = new Position(this.wsApiClient);
        position.syncFromHistoryResponse(positionsPage.positions[0]);
        this.positions.push(position);
        return position;
    }
    /**
     * Checks if previous page exists.
     */
    hasPrevPage() {
        return this.prevPage;
    }
    /**
     * Returns list of loaded pages of positions history.
     *
     * Note: call after {@link fetchPrevPage} method.
     */
    getPositions() {
        const positions = [];
        for (let i = 0; i < this.positions.length; i += 1) {
            positions[i] = this.positions[i];
        }
        return positions;
    }
}
/**
 * Position refreshable class.
 */
export class Position {
    /**
     * Position's identification number ( position external ID ).
     */
    externalId;
    /**
     * Position's internal ID. ( Positions across different instrument types can have the same internal_id )
     */
    internalId;
    /**
     * Position's active ID.
     */
    activeId;
    /**
     * Position's balance ID.
     */
    balanceId;
    /**
     * Amount of profit by the position.
     */
    closeProfit;
    /**
     * Quote price at which the position was closed.
     */
    closeQuote;
    /**
     * Position's close reason.
     */
    closeReason;
    /**
     * Current quote price.
     */
    currentQuote;
    /**
     * The time at which the position was closed.
     */
    closeTime;
    /**
     * Expected profit for the position.
     */
    expectedProfit;
    /**
     * Type of trading instrument.
     */
    instrumentType;
    /**
     * The amount of the initial investment.
     */
    invest;
    /**
     * Quote price at which the position was opened.
     */
    openQuote;
    /**
     * The time at which the position was opened.
     */
    openTime;
    /**
     * Expected PnL for the position.
     */
    pnl;
    /**
     * Expected PnL Net for the position.
     */
    pnlNet;
    /**
     * PnL with which the position was closed.
     */
    pnlRealized;
    /**
     * Quote time at which the position was opened.
     */
    quoteTimestamp;
    /**
     * Current quote time.
     */
    currentQuoteTimestamp;
    /**
     * Position's status.
     */
    status;
    /**
     * Position's user ID.
     */
    userId;
    /**
     * Realized profit from selling the position at this moment.
     */
    sellProfit;
    /**
     * List of order IDs.
     */
    orderIds = [];
    /**
     * Active information.
     */
    active;
    /**
     * Expiration time for the position.
     */
    expirationTime;
    /**
     * Direction of the position.
     */
    direction;
    /**
     * Version of position. Used for filter old versions of position's state.
     * @private
     */
    version;
    /**
     * Instance of WebSocket API client.
     * @private
     */
    wsApiClient;
    constructor(wsApiClient) {
        this.wsApiClient = wsApiClient;
    }
    /**
     * Synchronises position from DTO.
     * @param msg - Position data transfer object.
     * @private
     */
    syncFromResponse(msg) {
        this.externalId = msg.externalId;
        this.internalId = msg.internalId;
        this.activeId = msg.activeId;
        this.balanceId = msg.userBalanceId;
        this.expectedProfit = msg.expectedProfit;
        this.instrumentType = msg.instrumentType;
        this.invest = msg.invest;
        this.openQuote = msg.openQuote;
        this.openTime = new Date(msg.openTime);
        this.pnl = msg.pnl;
        this.quoteTimestamp = msg.quoteTimestamp !== undefined ? new Date(msg.quoteTimestamp) : undefined;
        this.status = msg.status;
        this.userId = msg.userId;
        this.orderIds = msg.orderIds;
        this.direction = msg.direction;
        this.expirationTime = msg.expirationTime !== undefined ? new Date(msg.expirationTime) : undefined;
    }
    /**
     * Synchronises position from DTO.
     * @param msg - Position data transfer object.
     * @private
     */
    syncFromHistoryResponse(msg) {
        this.externalId = msg.externalId;
        this.internalId = msg.internalId;
        this.activeId = msg.activeId;
        this.balanceId = msg.userBalanceId;
        this.instrumentType = msg.instrumentType;
        this.invest = msg.invest;
        this.openQuote = msg.openQuote;
        this.openTime = new Date(msg.openTime);
        this.closeProfit = msg.closeProfit;
        this.closeQuote = msg.closeQuote;
        this.closeReason = msg.closeReason;
        this.closeTime = msg.closeTime !== undefined ? new Date(msg.closeTime) : undefined;
        this.pnl = msg.pnl;
        this.pnlRealized = msg.pnlRealized;
        this.pnlNet = msg.pnlNet;
        this.status = msg.status;
        this.userId = msg.userId;
        this.orderIds = msg.orderIds;
        this.direction = msg.direction;
    }
    /**
     * Synchronises position from DTO.
     * @param msg - Position data transfer object.
     * @private
     */
    syncFromEvent(msg) {
        if (this.version !== undefined && msg.version !== undefined && this.version >= msg.version) {
            return;
        }
        this.internalId = msg.internalId;
        this.activeId = msg.activeId;
        this.balanceId = msg.userBalanceId;
        this.closeProfit = msg.closeProfit;
        this.closeQuote = msg.closeQuote;
        this.closeReason = msg.closeReason;
        this.closeTime = msg.closeTime !== undefined ? new Date(msg.closeTime) : undefined;
        this.expectedProfit = msg.expectedProfit;
        this.version = msg.version;
        this.instrumentType = msg.instrumentType;
        this.invest = msg.invest;
        this.openQuote = msg.openQuote;
        this.openTime = new Date(msg.openTime);
        this.pnl = msg.pnl;
        this.pnlRealized = msg.pnlRealized;
        this.quoteTimestamp = msg.quoteTimestamp !== undefined ? new Date(msg.quoteTimestamp) : undefined;
        this.status = msg.status;
        this.userId = msg.userId;
        this.orderIds = msg.orderIds;
        this.direction = msg.direction;
        this.expirationTime = msg.expirationTime !== undefined ? new Date(msg.expirationTime) : undefined;
    }
    /**
     * Synchronises position from DTO.
     * @param msg - Position state data transfer object.
     * @private
     */
    syncFromStateEvent(msg) {
        this.sellProfit = msg.sellProfit;
        this.currentQuote = msg.currentPrice;
        this.currentQuoteTimestamp = msg.quoteTimestamp !== undefined ? new Date(msg.quoteTimestamp) : undefined;
        this.pnl = msg.pnl;
        this.pnlNet = msg.pnlNet;
        this.expectedProfit = msg.expectedProfit;
    }
    async sell() {
        let promise;
        switch (this.instrumentType) {
            case InstrumentType.TurboOption:
            case InstrumentType.BinaryOption:
                promise = this.wsApiClient.doRequest(new CallBinaryOptionsSellOptionsV3([this.externalId]));
                break;
            case InstrumentType.DigitalOption:
                promise = this.wsApiClient.doRequest(new CallDigitalOptionsClosePositionV1(this.externalId));
                break;
            case InstrumentType.BlitzOption:
                throw new Error("Blitz options are not supported");
            case InstrumentType.MarginCfd:
                promise = this.wsApiClient.doRequest(new CallMarginClosePositionV1("cfd", this.externalId));
                break;
            case InstrumentType.MarginCrypto:
                promise = this.wsApiClient.doRequest(new CallMarginClosePositionV1("crypto", this.externalId));
                break;
            case InstrumentType.MarginForex:
                promise = this.wsApiClient.doRequest(new CallMarginClosePositionV1("forex", this.externalId));
                break;
            default:
                throw new Error(`Unknown instrument type ${this.instrumentType}`);
        }
        const result = await promise;
        if (!result.success) {
            throw new Error(result.reason);
        }
    }
}
/**
 * Don't use this class directly from your code. Use {@link ClientSdk.blitzOptions} static method instead.
 *
 * Blitz options facade class.
 */
export class BlitzOptions {
    /**
     * Actives current state.
     * @private
     */
    actives = new Map();
    /**
     * Instance of WebSocket API client.
     * @private
     */
    wsApiClient;
    /**
     * Timer for periodical actives list update.
     * @private
     */
    intervalId;
    /**
     * Creates instance from DTO.
     * @param activesMsg - actives data transfer object.
     * @param wsApiClient - Instance of WebSocket API client.
     * @internal
     * @private
     */
    constructor(activesMsg, wsApiClient) {
        this.wsApiClient = wsApiClient;
        this.updateActives(activesMsg);
    }
    /**
     * Requests information about blitz options actives, runs timer for periodical actives list update, puts the information to instance of class BlitzOptions and returns it.
     * @param wsApiClient - Instance of WebSocket API client.
     */
    static async create(wsApiClient) {
        const initializationData = await wsApiClient.doRequest(new CallBinaryOptionsGetInitializationDataV3());
        const blitzOptions = new BlitzOptions(initializationData.blitzActives, wsApiClient);
        blitzOptions.intervalId = setInterval(async () => {
            const response = await wsApiClient.doRequest(new CallBinaryOptionsGetInitializationDataV3());
            blitzOptions.updateActives(response.blitzActives);
        }, 600000);
        return blitzOptions;
    }
    /**
     * Returns list of blitz options actives.
     */
    getActives() {
        const list = [];
        for (const [index] of this.actives) {
            list.push(this.actives.get(index));
        }
        return list;
    }
    /**
     * Returns refreshable instance of class BlitzOptionsActive by specified active ID. If active doesn't exist then error will be thrown.
     * @param activeId - Active identification number.
     */
    getActive(activeId) {
        if (!this.actives.has(activeId)) {
            throw new Error(`active with id '${activeId}' is not found`);
        }
        return this.actives.get(activeId);
    }
    /**
     * Makes request for buy blitz option.
     * @param active - The asset for which the option is purchased.
     * @param direction - Direction of price change.
     * @param expirationSize - How many seconds after buying an option should the option expire. A list of available expiration sizes can be found {@link BlitzOptionsActive.expirationTimes}.
     * @param price - The amount of the initial investment.
     * @param balance - The balance from which the initial investment will be written off and upon successful closing of the position, profit will be credited to this balance.
     */
    async buy(active, direction, expirationSize, price, balance) {
        const request = new CallBinaryOptionsOpenBlitzOptionV2(active.id, direction, expirationSize, price, balance.id, active.profitPercent());
        const response = await this.wsApiClient.doRequest(request);
        return new BlitzOptionsOption(response);
    }
    /**
     * Update instance from DTO.
     * @param activesMsg - Actives data transfer object.
     * @private
     */
    updateActives(activesMsg) {
        for (const index in activesMsg) {
            if (this.actives.has(activesMsg[index].id)) {
                this.actives.get(activesMsg[index].id).update(activesMsg[index]);
            }
            else {
                this.actives.set(activesMsg[index].id, new BlitzOptionsActive(activesMsg[index]));
            }
            // @todo mark absent actives as deleted.
        }
    }
    /**
     * Closes the instance.
     */
    close() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
        }
    }
}
/**
 * Instrument types.
 */
export var InstrumentType;
(function (InstrumentType) {
    InstrumentType["BinaryOption"] = "binary-option";
    InstrumentType["DigitalOption"] = "digital-option";
    InstrumentType["TurboOption"] = "turbo-option";
    InstrumentType["BlitzOption"] = "blitz-option";
    InstrumentType["MarginForex"] = "marginal-forex";
    InstrumentType["MarginCfd"] = "marginal-cfd";
    InstrumentType["MarginCrypto"] = "marginal-crypto";
})(InstrumentType || (InstrumentType = {}));
/**
 * Margin Trading TPSL types.
 */
export var MarginTradingTPSLType;
(function (MarginTradingTPSLType) {
    MarginTradingTPSLType["Price"] = "price";
    MarginTradingTPSLType["Pips"] = "pips";
    MarginTradingTPSLType["Delta"] = "delta";
    MarginTradingTPSLType["Pnl"] = "pnl";
})(MarginTradingTPSLType || (MarginTradingTPSLType = {}));
/**
 * Margin Trading TPSL class.
 */
export class MarginTradingTPSL {
    type;
    value;
    constructor(type, value) {
        this.type = type;
        this.value = value;
    }
}
/**
 * Blitz options direction of price change.
 */
export var BlitzOptionsDirection;
(function (BlitzOptionsDirection) {
    /**
     * The decision is that the price will go up.
     */
    BlitzOptionsDirection["Call"] = "call";
    /**
     * The decision is that the price will go down.
     */
    BlitzOptionsDirection["Put"] = "put";
})(BlitzOptionsDirection || (BlitzOptionsDirection = {}));
/**
 * Blitz options active refreshable class.
 */
export class BlitzOptionsActive {
    /**
     * Active's identification number.
     */
    id;
    /**
     * Active's localization key
     */
    localizationKey;
    /**
     * Active's ticker (symbol).
     */
    ticker;
    /**
     * Is trading suspended on the active.
     */
    isSuspended;
    /**
     * Expiration times (sizes) available for the active.
     */
    expirationTimes;
    /**
     * The commission is taken from 100% of the profit. Therefore, income percent can be calculated using the following formula: `profitIncomePercent=100-profitCommissionPercent`.
     */
    profitCommissionPercent;
    /**
     * Active's trading schedule.
     */
    schedule = [];
    /**
     * Creates class instance from DTO.
     * @param msg - Actives' data transfer object.
     * @internal
     * @private
     */
    constructor(msg) {
        this.id = msg.id;
        this.localizationKey = msg.name;
        this.ticker = msg.ticker;
        this.isSuspended = msg.isSuspended;
        this.expirationTimes = msg.expirationTimes;
        this.profitCommissionPercent = msg.profitCommission;
        this.schedule = [];
        for (const index in msg.schedule) {
            this.schedule.push(new BlitzOptionsActiveTradingSession(msg.schedule[index][0], msg.schedule[index][1]));
        }
    }
    /**
     * Checks whether an option on an active can be purchased at a specified time.
     * @param at - Time for which the check is performed.
     */
    canBeBoughtAt(at) {
        if (this.isSuspended) {
            return false;
        }
        const atUnixTimeMilli = at.getTime();
        return this.schedule.findIndex((session) => {
            return session.from.getTime() <= atUnixTimeMilli && session.to.getTime() >= atUnixTimeMilli;
        }) >= 0;
    }
    /**
     * Returns profit percent for the active.
     */
    profitPercent() {
        return 100 - this.profitCommissionPercent;
    }
    /**
     * Updates the instance from DTO.
     * @param msg - Active's data transfer object.
     * @private
     */
    update(msg) {
        this.ticker = msg.ticker;
        this.expirationTimes = msg.expirationTimes;
        this.isSuspended = msg.isSuspended;
        this.profitCommissionPercent = msg.profitCommission;
        this.schedule = [];
        for (const index in msg.schedule) {
            this.schedule.push(new BlitzOptionsActiveTradingSession(msg.schedule[index][0], msg.schedule[index][1]));
        }
    }
}
/**
 * Blitz options active trading session class.
 */
export class BlitzOptionsActiveTradingSession {
    /**
     * Start time of trading session.
     */
    from;
    /**
     * End time of trading session.
     */
    to;
    /**
     * Initialises class instance from DTO.
     * @param fromTs - Unix time of session start.
     * @param toTs - Unix time of session end.
     */
    constructor(fromTs, toTs) {
        this.from = new Date(fromTs * 1000);
        this.to = new Date(toTs * 1000);
    }
}
/**
 * Blitz options option order class.
 */
export class BlitzOptionsOption {
    /**
     * Option's ID.
     */
    id;
    /**
     * Option's active ID.
     */
    activeId;
    /**
     * Option's price direction.
     */
    direction;
    /**
     * Option's expiration time.
     */
    expiredAt;
    /**
     * Option's amount of the initial investment.
     */
    price;
    /**
     * Option's profit income percent.
     */
    profitIncomePercent;
    /**
     * The time when the option was purchased.
     */
    openedAt;
    /**
     * The {@link CurrentQuote.value value} of the quote at which the option was purchased.
     */
    openQuoteValue;
    /**
     * Creates class instance from DTO.
     * @param msg - Option's data transfer object.
     * @internal
     * @private
     */
    constructor(msg) {
        this.id = msg.id;
        this.activeId = msg.activeId;
        this.direction = msg.direction;
        this.price = msg.price;
        this.expiredAt = new Date(msg.expired * 1000);
        this.profitIncomePercent = msg.profitIncome;
        this.openedAt = new Date(msg.timeRate * 1000);
        this.openQuoteValue = msg.value;
    }
}
/**
 * Don't use this class directly from your code. Use {@link ClientSdk.turboOptions} static method instead.
 *
 * Turbo options facade class.
 */
export class TurboOptions {
    /**
     * Actives current state.
     * @private
     */
    actives = new Map();
    /**
     * Instance of WebSocket API client.
     * @private
     */
    wsApiClient;
    /**
     * Timer for periodical actives list update.
     * @private
     */
    intervalId;
    /**
     * Creates class instance.
     * @param activesMsg - Actives data transfer object.
     * @param wsApiClient - Instance of WebSocket API client.
     * @internal
     * @private
     */
    constructor(activesMsg, wsApiClient) {
        this.wsApiClient = wsApiClient;
        this.updateActives(activesMsg);
    }
    /**
     * Requests information about turbo options actives, runs timer for periodical actives list update, puts the information to instance of class TurboOptions and returns it.
     * @param wsApiClient - Instance of WebSocket API client.
     */
    static async create(wsApiClient) {
        const initializationData = await wsApiClient.doRequest(new CallBinaryOptionsGetInitializationDataV3());
        const turboOptions = new TurboOptions(initializationData.turboActives, wsApiClient);
        turboOptions.intervalId = setInterval(async () => {
            const response = await wsApiClient.doRequest(new CallBinaryOptionsGetInitializationDataV3());
            turboOptions.updateActives(response.turboActives);
        }, 600000);
        return turboOptions;
    }
    /**
     * Returns list of turbo options actives.
     */
    getActives() {
        const list = [];
        for (const [index] of this.actives) {
            list.push(this.actives.get(index));
        }
        return list;
    }
    /**
     * Returns refreshable instance of class TurboOptionsActive by specified active ID. If active doesn't exist then error will be thrown.
     * @param activeId - Active identification number.
     */
    getActive(activeId) {
        if (!this.actives.has(activeId)) {
            throw new Error(`active with id '${activeId}' is not found`);
        }
        return this.actives.get(activeId);
    }
    /**
     * Makes request for buy turbo option.
     * @param instrument - The instrument for which the option is purchased.
     * @param direction - Direction of price change.
     * @param price - The amount of the initial investment.
     * @param balance - The balance from which the initial investment will be written off and upon successful closing of the position, profit will be credited to this balance.
     */
    async buy(instrument, direction, price, balance) {
        const request = new CallBinaryOptionsOpenTurboOptionV2(instrument.activeId, Math.trunc(instrument.expiredAt.getTime() / 1000), direction, price, balance.id, instrument.profitPercent());
        const response = await this.wsApiClient.doRequest(request);
        return new TurboOptionsOption(response);
    }
    /**
     * Updates instance from DTO.
     * @param activesMsg - Actives data transfer object.
     * @private
     */
    updateActives(activesMsg) {
        for (const index in activesMsg) {
            if (this.actives.has(activesMsg[index].id)) {
                this.actives.get(activesMsg[index].id).update(activesMsg[index]);
            }
            else {
                this.actives.set(activesMsg[index].id, new TurboOptionsActive(activesMsg[index], this.wsApiClient.currentTime));
            }
            // @todo mark absent actives as deleted.
        }
    }
    /**
     * Closes the instance.
     */
    close() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
        }
        this.actives.forEach((active) => {
            active.close();
        });
    }
}
/**
 * Turbo options direction of price change.
 */
export var TurboOptionsDirection;
(function (TurboOptionsDirection) {
    /**
     * The decision is that the price will go up.
     */
    TurboOptionsDirection["Call"] = "call";
    /**
     * The decision is that the price will go down.
     */
    TurboOptionsDirection["Put"] = "put";
})(TurboOptionsDirection || (TurboOptionsDirection = {}));
/**
 * Turbo options active refreshable class.
 */
export class TurboOptionsActive {
    /**
     * Active's identification number.
     */
    id;
    /**
     * Active's localization key
     */
    localizationKey;
    /**
     * How many seconds before expiration time the ability to buyback options for this active will not be allowed.
     */
    buybackDeadtime;
    /**
     * How many seconds before expiration time the ability to purchase options for this active will not be allowed.
     */
    deadtime;
    /**
     * Active's ticker (symbol).
     */
    ticker;
    /**
     * Is buyback available in the active.
     */
    isBuyback;
    /**
     * Is trading suspended on the active.
     */
    isSuspended;
    /**
     * Count of nearest options available for the active.
     */
    optionCount;
    /**
     * Expiration times (sizes) available for the active.
     */
    expirationTimes;
    /**
     * The commission is taken from 100% of the profit. Therefore, income percent can be calculated using the following formula: `profitIncomePercent=100-profitCommissionPercent`.
     */
    profitCommissionPercent;
    /**
     * Active's trading schedule.
     */
    schedule = [];
    /**
     * An object with the current time obtained from WebSocket API.
     * @private
     */
    currentTime;
    /**
     * Instruments facade class instance.
     * @private
     */
    instrumentsFacade;
    /**
     * Creates instance from DTO.
     * @param msg - Active's data transfer object.
     * @param currentTime - An object with the current time obtained from WebSocket API.
     * @internal
     * @private
     */
    constructor(msg, currentTime) {
        this.id = msg.id;
        this.localizationKey = msg.name;
        this.deadtime = msg.deadtime;
        this.buybackDeadtime = msg.buybackDeadtime;
        this.isBuyback = msg.isBuyback;
        this.ticker = msg.ticker;
        this.optionCount = msg.optionCount;
        this.isSuspended = msg.isSuspended;
        this.profitCommissionPercent = msg.profitCommission;
        this.expirationTimes = msg.expirationTimes;
        this.schedule = [];
        for (const index in msg.schedule) {
            this.schedule.push(new TurboOptionsActiveTradingSession(msg.schedule[index][0], msg.schedule[index][1]));
        }
        this.currentTime = currentTime;
    }
    /**
     * Returns turbo options active's instruments facade.
     */
    async instruments() {
        if (!this.instrumentsFacade) {
            this.instrumentsFacade = await TurboOptionsActiveInstruments.create(this, this.currentTime);
        }
        return this.instrumentsFacade;
    }
    /**
     * Updates the instance from DTO.
     * @param msg - Active's data transfer object.
     * @private
     */
    update(msg) {
        this.deadtime = msg.deadtime;
        this.buybackDeadtime = msg.buybackDeadtime;
        this.ticker = msg.ticker;
        this.isSuspended = msg.isSuspended;
        this.isBuyback = msg.isBuyback;
        this.profitCommissionPercent = msg.profitCommission;
        this.optionCount = msg.optionCount;
        this.expirationTimes = msg.expirationTimes;
        this.schedule = [];
        for (const index in msg.schedule) {
            this.schedule.push(new TurboOptionsActiveTradingSession(msg.schedule[index][0], msg.schedule[index][1]));
        }
    }
    /**
     * Checks whether an option on an active can be purchased at a specified time.
     * @param at - Time for which the check is performed.
     */
    canBeBoughtAt(at) {
        if (this.isSuspended) {
            return false;
        }
        const atUnixTimeMilli = at.getTime();
        return this.schedule.findIndex((session) => {
            return session.from.getTime() <= atUnixTimeMilli && session.to.getTime() >= atUnixTimeMilli;
        }) >= 0;
    }
    /**
     * Closes the instance.
     */
    close() {
        if (this.instrumentsFacade) {
            this.instrumentsFacade.close();
        }
    }
}
/**
 * Turbo options active trading session class.
 */
export class TurboOptionsActiveTradingSession {
    /**
     * Start time of trading session.
     */
    from;
    /**
     * End time of trading session.
     */
    to;
    /**
     * Initialises class instance from DTO.
     * @param fromTs - Unix time of session start.
     * @param toTs - Unix time of session end.
     */
    constructor(fromTs, toTs) {
        this.from = new Date(fromTs * 1000);
        this.to = new Date(toTs * 1000);
    }
}
/**
 * Turbo options active's instruments facade class. Periodically generates active's instruments based on active's settings.
 */
export class TurboOptionsActiveInstruments {
    active;
    currentTime;
    /**
     * Instruments current state.
     * @private
     */
    instruments = new Map();
    /**
     * Timer for periodical actives list update.
     * @private
     */
    intervalId;
    /**
     * Creates class instance.
     * @param active - Active.
     * @param currentTime - An object with the current time obtained from WebSocket API.
     * @internal
     * @private
     */
    constructor(active, currentTime) {
        this.active = active;
        this.currentTime = currentTime;
    }
    /**
     * Runs timer for periodical active's instruments list generation, creates instance of this class and returns it.
     * @param active - The active for which instruments are generated.
     * @param currentTime - An object with the current time obtained from WebSocket API.
     */
    static async create(active, currentTime) {
        const instrumentsFacade = new TurboOptionsActiveInstruments(active, currentTime);
        instrumentsFacade.generateInstruments();
        instrumentsFacade.intervalId = setInterval(() => {
            instrumentsFacade.generateInstruments();
        }, 30000);
        return instrumentsFacade;
    }
    /**
     * Returns list of instruments available for buy at specified time.
     * @param at - Time for which the check is performed.
     */
    getAvailableForBuyAt(at) {
        const list = [];
        for (const [index] of this.instruments) {
            if (this.instruments.get(index).isAvailableForBuyAt(at)) {
                list.push(this.instruments.get(index));
            }
        }
        return list;
    }
    /**
     * Generates instruments.
     * @private
     */
    generateInstruments() {
        if (!this.active.canBeBoughtAt(new Date(this.currentTime.unixMilliTime))) {
            return;
        }
        const generatedInstrumentsKeys = [];
        const nowUnixTime = Math.trunc(this.currentTime.unixMilliTime / 1000);
        for (const index in this.active.expirationTimes) {
            const expirationSize = this.active.expirationTimes[index];
            let instrumentExpirationUnixTime = nowUnixTime + expirationSize - nowUnixTime % expirationSize;
            for (let i = 0; i < this.active.optionCount; i++) {
                const key = `${this.active.id},${expirationSize},${instrumentExpirationUnixTime}`;
                generatedInstrumentsKeys.push(key);
                if (!this.instruments.has(key)) {
                    this.instruments.set(key, new TurboOptionsActiveInstrument(this.active.id, expirationSize, new Date(instrumentExpirationUnixTime * 1000), this.active.deadtime, this.active.profitCommissionPercent));
                }
                else {
                    this.instruments.get(key).update(this.active.deadtime);
                }
                instrumentExpirationUnixTime += expirationSize;
            }
        }
        for (const [index] of this.instruments) {
            if (!generatedInstrumentsKeys.includes(index)) {
                this.instruments.delete(index);
            }
        }
    }
    /**
     * Closes the instance.
     */
    close() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
        }
    }
}
/**
 * Turbo options active's instrument refreshable class.
 */
export class TurboOptionsActiveInstrument {
    activeId;
    expirationSize;
    expiredAt;
    deadtime;
    profitCommissionPercent;
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
    constructor(activeId, expirationSize, expiredAt, deadtime, profitCommissionPercent) {
        this.activeId = activeId;
        this.expirationSize = expirationSize;
        this.expiredAt = expiredAt;
        this.deadtime = deadtime;
        this.profitCommissionPercent = profitCommissionPercent;
    }
    /**
     * Checks availability for buy option at specified time.
     * @param at - Time for which the check is performed.
     */
    isAvailableForBuyAt(at) {
        return this.purchaseEndTime().getTime() > at.getTime();
    }
    /**
     * Returns the time until which it is possible to open trades that will fall into the current expiration.
     * @returns {Date}
     */
    purchaseEndTime() {
        return new Date(this.expiredAt.getTime() - this.deadtime * 1000);
    }
    /**
     * Returns the remaining duration in milliseconds for which it is possible to purchase options.
     * @param {Date} currentTime - The current time.
     * @returns {number} - The remaining duration in milliseconds.
     */
    durationRemainingForPurchase(currentTime) {
        return this.purchaseEndTime().getTime() - currentTime.getTime();
    }
    /**
     * Returns profit percent.
     */
    profitPercent() {
        return 100 - this.profitCommissionPercent;
    }
    /**
     * Updates the instance from DTO.
     * @param deadtime - How many seconds before expiration time the ability to purchase options for this instrument will not be allowed.
     * @private
     */
    update(deadtime) {
        this.deadtime = deadtime;
    }
}
/**
 * Turbo options option order class.
 */
export class TurboOptionsOption {
    /**
     * Option's ID.
     */
    id;
    /**
     * Option's active ID.
     */
    activeId;
    /**
     * Option's price direction.
     */
    direction;
    /**
     * Option's expiration time.
     */
    expiredAt;
    /**
     * Option's amount of the initial investment.
     */
    price;
    /**
     * Option's profit income percent.
     */
    profitIncomePercent;
    /**
     * The time when the option was purchased.
     */
    openedAt;
    /**
     * The {@link CurrentQuote.value value} of the quote at which the option was purchased.
     */
    openQuoteValue;
    /**
     * Create instance from DTO.
     * @param msg - Option's data transfer object.
     * @internal
     * @private
     */
    constructor(msg) {
        this.id = msg.id;
        this.activeId = msg.activeId;
        this.direction = msg.direction;
        this.price = msg.price;
        this.profitIncomePercent = msg.profitIncome;
        this.expiredAt = new Date(msg.expired * 1000);
        this.openedAt = new Date(msg.timeRate * 1000);
        this.openQuoteValue = msg.value;
    }
}
/**
 * Don't use this class directly from your code. Use {@link ClientSdk.binaryOptions} static method instead.
 *
 * Binary options facade class.
 */
export class BinaryOptions {
    /**
     * Actives current state.
     * @private
     */
    actives = new Map();
    /**
     * Instance of WebSocket API client.
     * @private
     */
    wsApiClient;
    /**
     * Timer for periodical actives list update.
     * @private
     */
    intervalId;
    /**
     * Creates instance from DTO.
     * @param activesMsg - actives data transfer object.
     * @param wsApiClient - Instance of WebSocket API client.
     * @internal
     * @private
     */
    constructor(activesMsg, wsApiClient) {
        this.wsApiClient = wsApiClient;
        this.updateActives(activesMsg);
    }
    /**
     * Requests information about binary options actives, runs timer for periodical actives list update, puts the information to instance of class BinaryOptions and returns it.
     * @param wsApiClient - Instance of WebSocket API client.
     */
    static async create(wsApiClient) {
        const initializationData = await wsApiClient.doRequest(new CallBinaryOptionsGetInitializationDataV3());
        const binaryOptions = new BinaryOptions(initializationData.binaryActives, wsApiClient);
        binaryOptions.intervalId = setInterval(async () => {
            const response = await wsApiClient.doRequest(new CallBinaryOptionsGetInitializationDataV3());
            binaryOptions.updateActives(response.binaryActives);
        }, 600000);
        return binaryOptions;
    }
    /**
     * Returns list of binary options actives.
     */
    getActives() {
        const list = [];
        for (const [index] of this.actives) {
            list.push(this.actives.get(index));
        }
        return list;
    }
    /**
     * Returns refreshable instance of class BinaryOptionsActive by specified active ID. If active doesn't exist then error will be thrown.
     * @param activeId - Active identification number.
     */
    getActive(activeId) {
        if (!this.actives.has(activeId)) {
            throw new Error(`active with id '${activeId}' is not found`);
        }
        return this.actives.get(activeId);
    }
    /**
     * Makes request for buy binary option.
     * @param instrument - The instrument for which the option is purchased.
     * @param direction - Direction of price change.
     * @param price - The amount of the initial investment.
     * @param balance - The balance from which the initial investment will be written off and upon successful closing of the position, profit will be credited to this balance.
     */
    async buy(instrument, direction, price, balance) {
        const request = new CallBinaryOptionsOpenBinaryOptionV2(instrument.activeId, Math.trunc(instrument.expiredAt.getTime() / 1000), direction, price, balance.id, instrument.profitPercent());
        const response = await this.wsApiClient.doRequest(request);
        return new BinaryOptionsOption(response);
    }
    /**
     * Updates actives from DTO.
     * @param activesMsg - Actives data transfer object.
     * @private
     */
    updateActives(activesMsg) {
        for (const index in activesMsg) {
            if (this.actives.has(activesMsg[index].id)) {
                this.actives.get(activesMsg[index].id).update(activesMsg[index]);
            }
            else {
                this.actives.set(activesMsg[index].id, new BinaryOptionsActive(activesMsg[index], this.wsApiClient.currentTime));
            }
            // @todo mark absent actives as deleted.
        }
    }
    /**
     * Closes the instance.
     */
    close() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
        }
        this.actives.forEach((active) => {
            active.close();
        });
    }
}
/**
 * Binary options direction of price change.
 */
export var BinaryOptionsDirection;
(function (BinaryOptionsDirection) {
    /**
     * The decision is that the price will go up.
     */
    BinaryOptionsDirection["Call"] = "call";
    /**
     * The decision is that the price will go down.
     */
    BinaryOptionsDirection["Put"] = "put";
})(BinaryOptionsDirection || (BinaryOptionsDirection = {}));
/**
 * Binary options active refreshable class.
 */
export class BinaryOptionsActive {
    /**
     * Active's identification number.
     */
    id;
    /**
     * Active's localization key
     */
    localizationKey;
    /**
     * How many seconds before expiration time the ability to buyback options for this active will not be allowed.
     */
    buybackDeadtime;
    /**
     * How many seconds before expiration time the ability to purchase options for this active will not be allowed.
     */
    deadtime;
    /**
     * Active's ticker (symbol).
     */
    ticker;
    /**
     * Is buyback available in the active.
     */
    isBuyback;
    /**
     * Is trading suspended on the active.
     */
    isSuspended;
    /**
     * Count of nearest options available for the active.
     */
    optionCount;
    /**
     * List of special instruments available for the active.
     */
    optionSpecial = [];
    /**
     * Expiration times (sizes) available for the active.
     */
    expirationTimes;
    /**
     * The commission is taken from 100% of the profit. Therefore, income percent can be calculated using the following formula: `profitIncomePercent=100-profitCommissionPercent`.
     */
    profitCommissionPercent;
    /**
     * Active's trading schedule.
     */
    schedule = [];
    /**
     * An object with the current time obtained from WebSocket API.
     * @private
     */
    currentTime;
    /**
     * Instruments facade class instance.
     * @private
     */
    instrumentsFacade;
    /**
     * Creates instance from DTO.
     * @param msg - Active's data transfer object.
     * @param currentTime - An object with the current time obtained from WebSocket API.
     * @internal
     * @private
     */
    constructor(msg, currentTime) {
        this.id = msg.id;
        this.localizationKey = msg.name;
        this.deadtime = msg.deadtime;
        this.ticker = msg.ticker;
        this.isBuyback = msg.isBuyback;
        this.isSuspended = msg.isSuspended;
        this.buybackDeadtime = msg.buybackDeadtime;
        this.optionCount = msg.optionCount;
        this.expirationTimes = msg.expirationTimes;
        this.profitCommissionPercent = msg.profitCommission;
        this.schedule = [];
        for (const index in msg.schedule) {
            this.schedule.push(new BinaryOptionsActiveTradingSession(msg.schedule[index][0], msg.schedule[index][1]));
        }
        for (const index in msg.optionSpecial) {
            this.optionSpecial.push(new BinaryOptionsActiveSpecialInstrument(msg.optionSpecial[index]));
        }
        this.currentTime = currentTime;
    }
    /**
     * Returns binary options active's instruments facade.
     */
    async instruments() {
        if (!this.instrumentsFacade) {
            this.instrumentsFacade = await BinaryOptionsActiveInstruments.create(this, this.currentTime);
        }
        return this.instrumentsFacade;
    }
    /**
     * Updates the instance from DTO.
     * @param msg - Active's data transfer object.
     * @private
     */
    update(msg) {
        this.buybackDeadtime = msg.buybackDeadtime;
        this.deadtime = msg.deadtime;
        this.ticker = msg.ticker;
        this.isBuyback = msg.isBuyback;
        this.isSuspended = msg.isSuspended;
        this.expirationTimes = msg.expirationTimes;
        this.optionCount = msg.optionCount;
        this.profitCommissionPercent = msg.profitCommission;
        this.schedule = [];
        for (const index in msg.schedule) {
            this.schedule.push(new BinaryOptionsActiveTradingSession(msg.schedule[index][0], msg.schedule[index][1]));
        }
        this.optionSpecial = [];
        for (const index in msg.optionSpecial) {
            this.optionSpecial.push(new BinaryOptionsActiveSpecialInstrument(msg.optionSpecial[index]));
        }
    }
    /**
     * Checks whether an option on an active can be purchased at a specified time.
     * @param at - Time for which the check is performed.
     */
    canBeBoughtAt(at) {
        if (this.isSuspended) {
            return false;
        }
        const atUnixTimeMilli = at.getTime();
        return this.schedule.findIndex((session) => {
            return session.from.getTime() <= atUnixTimeMilli && session.to.getTime() >= atUnixTimeMilli;
        }) >= 0;
    }
    /**
     * Closes the instance.
     */
    close() {
        if (this.instrumentsFacade) {
            this.instrumentsFacade.close();
        }
    }
}
/**
 * Binary options active trading session class.
 */
export class BinaryOptionsActiveTradingSession {
    /**
     * Start time of trading session.
     */
    from;
    /**
     * End time of trading session.
     */
    to;
    /**
     * Initialises class instance from DTO.
     * @param fromTs - Unix time of session start.
     * @param toTs - Unix time of session end.
     */
    constructor(fromTs, toTs) {
        this.from = new Date(fromTs * 1000);
        this.to = new Date(toTs * 1000);
    }
}
/**
 * Binary options active's instruments facade class. Periodically generates active's instruments based on active's settings.
 */
export class BinaryOptionsActiveInstruments {
    active;
    currentTime;
    /**
     * Instruments current state.
     * @private
     */
    instruments = new Map();
    /**
     * Timer for periodical actives list update.
     * @private
     */
    intervalId;
    /**
     * Creates class instance.
     * @param active - Active.
     * @param currentTime - An object with the current time obtained from WebSocket API.
     * @internal
     * @private
     */
    constructor(active, currentTime) {
        this.active = active;
        this.currentTime = currentTime;
    }
    /**
     * Runs timer for periodical active's instruments list generation, creates instance of this class and returns it.
     * @param active - The active for which instruments are generated.
     * @param currentTime - An object with the current time obtained from WebSocket API.
     */
    static async create(active, currentTime) {
        const instrumentsFacade = new BinaryOptionsActiveInstruments(active, currentTime);
        instrumentsFacade.generateInstruments();
        return instrumentsFacade;
    }
    /**
     * Returns list of instruments available for buy at specified time.
     * @param at - Time for which the check is performed.
     */
    getAvailableForBuyAt(at) {
        const list = [];
        for (const [index] of this.instruments) {
            if (this.instruments.get(index).isAvailableForBuyAt(at)) {
                list.push(this.instruments.get(index));
            }
        }
        return list;
    }
    scheduleNextGeneration() {
        let nextGenerationTime = null;
        const now = this.currentTime.unixMilliTime;
        for (const instrument of this.instruments.values()) {
            const triggerTime = instrument.expiredAt.getTime() - instrument.deadtime * 1000;
            if (triggerTime > now && (nextGenerationTime === null || triggerTime < nextGenerationTime)) {
                nextGenerationTime = triggerTime;
            }
        }
        if (nextGenerationTime !== null) {
            const delay = nextGenerationTime - now;
            this.intervalId = setTimeout(() => this.generateInstruments(), delay);
        }
        else {
            this.intervalId = setTimeout(() => this.generateInstruments(), 30000);
        }
    }
    /**
     * Generates instruments.
     * @private
     */
    generateInstruments() {
        if (!this.active.canBeBoughtAt(new Date(this.currentTime.unixMilliTime))) {
            this.intervalId = setTimeout(() => this.generateInstruments(), 30000);
            return;
        }
        const generatedInstrumentsKeys = [];
        const nowUnixTime = Math.trunc(this.currentTime.unixMilliTime / 1000);
        for (const index in this.active.expirationTimes) {
            const expirationSize = this.active.expirationTimes[index];
            let instrumentExpirationUnixTime = nowUnixTime + expirationSize - nowUnixTime % expirationSize;
            if (instrumentExpirationUnixTime - this.active.deadtime < nowUnixTime) {
                instrumentExpirationUnixTime += expirationSize;
            }
            for (let i = 0; i < this.active.optionCount; i++) {
                const key = `${this.active.id},${expirationSize},${instrumentExpirationUnixTime}`;
                generatedInstrumentsKeys.push(key);
                if (!this.instruments.has(key)) {
                    this.instruments.set(key, new BinaryOptionsActiveInstrument(this.active.id, expirationSize, new Date(instrumentExpirationUnixTime * 1000), this.active.deadtime, this.active.profitCommissionPercent));
                }
                this.instruments.get(key).update(this.active.deadtime);
                instrumentExpirationUnixTime += expirationSize;
            }
        }
        for (const index in this.active.optionSpecial) {
            const specialInstrument = this.active.optionSpecial[index];
            if (!specialInstrument.isEnabled) {
                continue;
            }
            const expirationSize = specialInstrument.title;
            const key = `${this.active.id},${expirationSize},${specialInstrument.expiredAt.toISOString()}`;
            generatedInstrumentsKeys.push(key);
            if (!this.instruments.has(key)) {
                this.instruments.set(key, new BinaryOptionsActiveInstrument(this.active.id, expirationSize, specialInstrument.expiredAt, this.active.deadtime, this.active.profitCommissionPercent));
            }
            this.instruments.get(key).update(this.active.deadtime);
        }
        for (const index in this.instruments) {
            if (!generatedInstrumentsKeys.includes(index)) {
                this.instruments.delete(index);
            }
        }
        this.scheduleNextGeneration();
    }
    /**
     * Closes the instance.
     */
    close() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
        }
    }
}
/**
 * Binary options active's instrument refreshable class.
 */
export class BinaryOptionsActiveInstrument {
    activeId;
    expirationSize;
    expiredAt;
    deadtime;
    profitCommissionPercent;
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
    constructor(activeId, expirationSize, expiredAt, deadtime, profitCommissionPercent) {
        this.activeId = activeId;
        this.expirationSize = expirationSize;
        this.expiredAt = expiredAt;
        this.deadtime = deadtime;
        this.profitCommissionPercent = profitCommissionPercent;
    }
    /**
     * Checks availability for buy option at specified time.
     * @param at - Time for which the check is performed.
     */
    isAvailableForBuyAt(at) {
        return this.purchaseEndTime().getTime() > at.getTime();
    }
    /**
     * Returns the time until which it is possible to open trades that will fall into the current expiration.
     * @returns {Date}
     */
    purchaseEndTime() {
        return new Date(this.expiredAt.getTime() - this.deadtime * 1000);
    }
    /**
     * Returns the remaining duration in milliseconds for which it is possible to purchase options.
     * @param {Date} currentTime - The current time.
     * @returns {number} - The remaining duration in milliseconds.
     */
    durationRemainingForPurchase(currentTime) {
        return this.purchaseEndTime().getTime() - currentTime.getTime();
    }
    /**
     * Returns profit percent.
     */
    profitPercent() {
        return 100 - this.profitCommissionPercent;
    }
    /**
     * Updates the instance from DTO.
     * @param deadtime - How many seconds before expiration time the ability to purchase options for this instrument will not be allowed.
     * @private
     */
    update(deadtime) {
        this.deadtime = deadtime;
    }
}
/**
 * Binary options active's special instrument class.
 */
export class BinaryOptionsActiveSpecialInstrument {
    /**
     * Instrument's title.
     */
    title;
    /**
     * Is instrument allowed to trade.
     */
    isEnabled;
    /**
     * Instrument's expiration time.
     */
    expiredAt;
    /**
     * Creates instance from DTO.
     * @param msg - Instrument's data transfer object.
     * @internal
     * @private
     */
    constructor(msg) {
        this.title = msg.title;
        this.isEnabled = msg.enabled;
        this.expiredAt = new Date(msg.expiredAt * 1000);
    }
}
/**
 * Binary options option order class.
 */
export class BinaryOptionsOption {
    /**
     * Option's ID.
     */
    id;
    /**
     * Option's active ID.
     */
    activeId;
    /**
     * Option's price direction.
     */
    direction;
    /**
     * Option's expiration time.
     */
    expiredAt;
    /**
     * Option's amount of the initial investment.
     */
    price;
    /**
     * Option's profit income percent.
     */
    profitIncomePercent;
    /**
     * The time when the option was purchased.
     */
    openedAt;
    /**
     * The {@link CurrentQuote.value value} of the quote at which the option was purchased.
     */
    openQuoteValue;
    /**
     * Create instance from DTO.
     * @param msg - Option's data transfer object.
     * @internal
     * @private
     */
    constructor(msg) {
        this.id = msg.id;
        this.activeId = msg.activeId;
        this.direction = msg.direction;
        this.expiredAt = new Date(msg.expired * 1000);
        this.price = msg.price;
        this.profitIncomePercent = msg.profitIncome;
        this.openedAt = new Date(msg.timeRate * 1000);
        this.openQuoteValue = msg.value;
    }
}
/**
 * Don't use this class directly from your code. Use {@link ClientSdk.digitalOptions} static method instead.
 *
 * Digital options facade class.
 */
export class DigitalOptions {
    /**
     * Instance of WebSocket API client.
     * @private
     */
    wsApiClient;
    /**
     * Underlyings current state.
     * @private
     */
    underlyings = new Map();
    /**
     * Creates instance from DTO.
     * @param underlyingList - Underlyings data transfer object.
     * @param wsApiClient - Instance of WebSocket API client.
     * @internal
     * @private
     */
    constructor(underlyingList, wsApiClient) {
        this.wsApiClient = wsApiClient;
        for (const index in underlyingList.underlying) {
            const underlying = underlyingList.underlying[index];
            this.underlyings.set(underlying.activeId, new DigitalOptionsUnderlying(underlying, wsApiClient));
        }
    }
    /**
     * Subscribes on underlyings updates, requests current state of underlyings, puts the state into this class instance and returns it.
     * @param wsApiClient - Instance of WebSocket API client.
     */
    static async create(wsApiClient) {
        const request = new SubscribeDigitalOptionInstrumentsUnderlyingListChangedV3();
        await wsApiClient.subscribe(request, (event) => {
            if (event.type !== 'digital-option') {
                return;
            }
            digitalOptionsFacade.updateUnderlyings(event);
        });
        const underlyingList = await wsApiClient.doRequest(new CallDigitalOptionInstrumentsGetUnderlyingListV3(true));
        const digitalOptionsFacade = new DigitalOptions(underlyingList, wsApiClient);
        return digitalOptionsFacade;
    }
    /**
     * Returns list of underlyings available for buy at specified time.
     * @param at - Time for which the check is performed.
     */
    getUnderlyingsAvailableForTradingAt(at) {
        const list = [];
        for (const [activeId] of this.underlyings) {
            if (this.underlyings.get(activeId).isAvailableForTradingAt(at)) {
                list.push(this.underlyings.get(activeId));
            }
        }
        return list;
    }
    /**
     * Makes request for buy digital option.
     * @param instrument - The instrument for which the option is purchased.
     * @param strikePrice - The strike price by which the option is purchased. Can be digit number or string 'SPT'. SPT is a spot strike that is always equal to the {@link CurrentQuote.value value} of the current underlying quote.
     * @param direction - Direction of price change.
     * @param amount - The amount of the initial investment.
     * @param balance - The balance from which the initial investment will be written off and upon successful closing of the position, profit will be credited to this balance.
     */
    async buy(instrument, strikePrice, direction, amount, balance) {
        const strike = instrument.getStrikeByPriceAndDirection(strikePrice, direction);
        const request = new CallDigitalOptionsPlaceDigitalOptionV3(instrument.assetId, strike.symbol, instrument.index, amount, balance.id);
        const response = await this.wsApiClient.doRequest(request);
        return new DigitalOptionsOrder(response);
    }
    /**
     * Shortcut for buy option on spot strike.
     * @param instrument - The instrument for which the option is purchased.
     * @param direction - Direction of price change.
     * @param amount - The amount of the initial investment.
     * @param balance - The balance from which the initial investment will be written off and upon successful closing of the position, profit will be credited to this balance.     */
    buySpotStrike(instrument, direction, amount, balance) {
        return this.buy(instrument, 'SPT', direction, amount, balance);
    }
    /**
     * Updates instance from DTO.
     * @param msg - Underlyings data transfer object.
     * @private
     */
    updateUnderlyings(msg) {
        for (const index in msg.underlying) {
            const underlying = msg.underlying[index];
            if (this.underlyings.has(underlying.activeId)) {
                this.underlyings.get(underlying.activeId).update(underlying);
            }
            else {
                this.underlyings.set(underlying.activeId, new DigitalOptionsUnderlying(underlying, this.wsApiClient));
            }
        }
    }
    /**
     * Closes the instance.
     */
    close() {
        this.underlyings.forEach((underlying) => {
            underlying.close();
        });
    }
}
/**
 * Digital options direction of price change.
 */
export var DigitalOptionsDirection;
(function (DigitalOptionsDirection) {
    /**
     * The decision is that the price will go up.
     */
    DigitalOptionsDirection["Call"] = "call";
    /**
     * The decision is that the price will go down.
     */
    DigitalOptionsDirection["Put"] = "put";
})(DigitalOptionsDirection || (DigitalOptionsDirection = {}));
/**
 * Margin direction.
 */
export var MarginDirection;
(function (MarginDirection) {
    MarginDirection["Buy"] = "buy";
    MarginDirection["Sell"] = "sell";
})(MarginDirection || (MarginDirection = {}));
/**
 * Digital options underlying refreshable class.
 */
export class DigitalOptionsUnderlying {
    /**
     * Underlying active ID.
     */
    activeId;
    /**
     * Is trading suspended on the underlying.
     */
    isSuspended;
    /**
     * Underlying name (ticker/symbol).
     */
    name;
    /**
     * Underlying trading schedule.
     */
    schedule;
    /**
     * Instruments facade class instance.
     * @private
     */
    instrumentsFacade;
    /**
     * Instance of WebSocket API client.
     * @private
     */
    wsApiClient;
    /**
     * Creates instance from DTO.
     * @param msg - Underlying data transfer object.
     * @param wsApiClient - Instance of WebSocket API client.
     * @internal
     * @private
     */
    constructor(msg, wsApiClient) {
        this.activeId = msg.activeId;
        this.isSuspended = msg.isSuspended;
        this.name = msg.name;
        this.wsApiClient = wsApiClient;
        this.schedule = [];
        for (const index in msg.schedule) {
            const session = msg.schedule[index];
            this.schedule.push(new DigitalOptionsUnderlyingTradingSession(session.open, session.close));
        }
    }
    /**
     * Checks availability for trading at specified time.
     * @param at - Time for which the check is performed.
     */
    isAvailableForTradingAt(at) {
        if (this.isSuspended) {
            return false;
        }
        const atUnixTimeMilli = at.getTime();
        return this.schedule.findIndex((session) => {
            return session.open.getTime() <= atUnixTimeMilli && session.close.getTime() >= atUnixTimeMilli;
        }) >= 0;
    }
    /**
     * Returns digital options active's instruments facade.
     */
    async instruments() {
        if (!this.instrumentsFacade) {
            this.instrumentsFacade = await DigitalOptionsUnderlyingInstruments.create(this.activeId, this.wsApiClient);
        }
        return this.instrumentsFacade;
    }
    /**
     * Updates the instance from DTO.
     * @param msg - Underlying data transfer object.
     * @private
     */
    update(msg) {
        this.isSuspended = msg.isSuspended;
        this.name = msg.name;
        this.schedule = [];
        for (const index in msg.schedule) {
            const session = msg.schedule[index];
            this.schedule.push(new DigitalOptionsUnderlyingTradingSession(session.open, session.close));
        }
    }
    /**
     * Closes the instance.
     */
    close() {
        if (this.instrumentsFacade) {
            this.instrumentsFacade.close();
        }
    }
}
/**
 * Digital options active trading session class.
 */
export class DigitalOptionsUnderlyingTradingSession {
    /**
     * Start time of trading session.
     */
    open;
    /**
     * End time of trading session.
     */
    close;
    /**
     * Initialises class instance from DTO.
     * @param openTs - Unix time of session start.
     * @param closeTs - Unix time of session end.
     * @internal
     * @private
     */
    constructor(openTs, closeTs) {
        this.open = new Date(openTs * 1000);
        this.close = new Date(closeTs * 1000);
    }
}
/**
 * Digital options underlying instruments facade class.
 */
export class DigitalOptionsUnderlyingInstruments {
    /**
     * Instruments current state.
     * @private
     */
    instruments = new Map();
    /**
     * Instance of WebSocket API client.
     * @private
     */
    wsApiClient;
    /**
     * Just private constructor. Use {@link DigitalOptionsUnderlyingInstruments.create create} instead.
     * @internal
     * @private
     */
    constructor() {
    }
    /**
     * Subscribes on underlying instruments updates, requests current state of underlying instruments, puts the state into this class instance and returns it.
     * @param assetId
     * @param wsApiClient
     */
    static async create(assetId, wsApiClient) {
        const instrumentsFacade = new DigitalOptionsUnderlyingInstruments();
        instrumentsFacade.wsApiClient = wsApiClient;
        await wsApiClient.subscribe(new SubscribeDigitalOptionInstrumentsInstrumentGeneratedV3(assetId), (event) => {
            if (event.instrumentType !== 'digital-option' || event.assetId !== assetId) {
                return;
            }
            instrumentsFacade.syncInstrumentFromEvent(event);
        });
        const instruments = await wsApiClient.doRequest(new CallDigitalOptionInstrumentsGetInstrumentsV3(assetId));
        instrumentsFacade.syncInstrumentsFromResponse(instruments);
        return instrumentsFacade;
    }
    /**
     * Returns list of instruments available for buy at specified time.
     * @param at - Time for which the check is performed.
     */
    getAvailableForBuyAt(at) {
        const list = [];
        for (const [index] of this.instruments) {
            if (this.instruments.get(index).isAvailableForBuyAt(at)) {
                list.push(this.instruments.get(index));
            }
        }
        return list;
    }
    /**
     * Updates the instance from DTO.
     * @param msg - Instrument data transfer object.
     * @private
     */
    syncInstrumentFromEvent(msg) {
        if (!this.instruments.has(msg.index)) {
            this.instruments.set(msg.index, new DigitalOptionsUnderlyingInstrument(msg, this.wsApiClient));
        }
        else {
            this.instruments.get(msg.index).sync(msg);
        }
    }
    /**
     * Updates the instance from DTO.
     * @param msg - Instruments data transfer object.
     * @private
     */
    syncInstrumentsFromResponse(msg) {
        const indexes = [];
        for (const index in msg.instruments) {
            const instrument = msg.instruments[index];
            indexes.push(instrument.index);
            this.syncInstrumentFromResponse(instrument);
        }
        for (const [index] of this.instruments) {
            if (!indexes.includes(this.instruments.get(index).index)) {
                this.instruments.delete(index);
            }
        }
    }
    /**
     * Updates the instance from DTO.
     * @param msg - Instrument data transfer object.
     * @private
     */
    syncInstrumentFromResponse(msg) {
        if (!this.instruments.has(msg.index)) {
            this.instruments.set(msg.index, new DigitalOptionsUnderlyingInstrument(msg, this.wsApiClient));
        }
        else {
            this.instruments.get(msg.index).sync(msg);
        }
    }
    /**
     * Closes the instance.
     */
    close() {
        this.instruments.forEach((instrument) => {
            instrument.close();
        });
    }
}
/**
 * Digital options underlying instrument refreshable class.
 */
export class DigitalOptionsUnderlyingInstrument {
    /**
     * Instrument's active ID.
     */
    assetId;
    /**
     * Instrument's deadtime. How many seconds before expiration time the ability to purchase options for this instrument will not be allowed.
     */
    deadtime;
    /**
     * Instrument's expiration time.
     */
    expiration;
    /**
     * Instrument's ID.
     */
    index;
    /**
     * Instrument's type.
     */
    instrumentType;
    /**
     * Instrument's period (expiration size).
     */
    period;
    /**
     * Instrument's strikes.
     */
    strikes = new Map();
    /**
     * Instance of WebSocket API client.
     * @private
     */
    wsApiClient;
    /**
     * Timer for periodical actives list update.
     * @private
     */
    intervalId;
    /**
     * Creates instance from DTO.
     * @param msg - Instrument data transfer object.
     * @param wsApiClient
     * @internal
     * @private
     */
    constructor(msg, wsApiClient) {
        this.wsApiClient = wsApiClient;
        this.assetId = msg.assetId;
        this.deadtime = msg.deadtime;
        this.expiration = new Date(msg.expiration * 1000);
        this.index = msg.index;
        this.instrumentType = msg.instrumentType;
        this.period = msg.period;
        for (const index in msg.data) {
            this.strikes.set(msg.data[index].symbol, new DigitalOptionsUnderlyingInstrumentStrike(msg.data[index]));
        }
    }
    /**
     * Checks availability for buy option at specified time.
     * @param at - Time for which the check is performed.
     */
    isAvailableForBuyAt(at) {
        return this.purchaseEndTime().getTime() > at.getTime();
    }
    /**
     * Gets strike with specified price and direction.
     * @param price - Desired strike price.
     * @param direction - Desired strike direction of price change.
     */
    getStrikeByPriceAndDirection(price, direction) {
        for (const strike of this.strikes.values()) {
            if (strike.price === price && strike.direction === direction) {
                return strike;
            }
        }
        throw new Error(`Strike with price '${price}' and direction '${direction}' is not found`);
    }
    /**
     * Calculates profit percent for specified amount and strike price.
     *
     * @param amount
     * @param price
     */
    profitPercent(amount, price = "SPT") {
        const callStrike = this.getStrikeByPriceAndDirection(price, DigitalOptionsDirection.Call);
        if (callStrike.ask === undefined || callStrike.bid === undefined) {
            throw new Error(`Can't get profit percent for strike with price '${price}' because ask/bid prices are undefined`);
        }
        const callProfitPercent = (100 / callStrike.ask * amount - amount) / amount * 100;
        const putStrike = this.getStrikeByPriceAndDirection(price, DigitalOptionsDirection.Put);
        if (putStrike.ask === undefined || putStrike.bid === undefined) {
            throw new Error(`Can't get profit percent for strike with price '${price}' because ask/bid prices are undefined`);
        }
        const putProfitPercent = (100 / putStrike.ask * amount - amount) / amount * 100;
        return Math.floor(Math.min(callProfitPercent, putProfitPercent));
    }
    /**
     * Returns the time until which it is possible to open trades that will fall into the current expiration.
     * @returns {Date}
     */
    purchaseEndTime() {
        return new Date(this.expiration.getTime() - this.deadtime * 1000);
    }
    /**
     * Subscribes on strikes ask/bid prices updates.
     */
    async subscribeOnStrikesAskBidPrices() {
        const request = new SubscribeTradingSettingsDigitalOptionClientPriceGeneratedV1('digital-option', this.assetId, this.index);
        await this.wsApiClient.subscribe(request, (event) => {
            this.syncAskBidPricesFromEvent(event);
        });
        this.intervalId = setInterval(() => {
            if (this.wsApiClient.currentTime.unixMilliTime >= this.expiration.getTime()) {
                this.wsApiClient.unsubscribe(request);
                clearInterval(this.intervalId);
            }
        }, 1000);
    }
    /**
     * Returns the remaining duration in milliseconds for which it is possible to purchase options.
     * @param {Date} currentTime - The current time.
     * @returns {number} - The remaining duration in milliseconds.
     */
    durationRemainingForPurchase(currentTime) {
        return this.purchaseEndTime().getTime() - currentTime.getTime();
    }
    /**
     * Updates the instance from DTO.
     * @param msg - Instrument data transfer object.
     */
    sync(msg) {
        this.assetId = msg.assetId;
        this.deadtime = msg.deadtime;
        this.expiration = new Date(msg.expiration * 1000);
        this.instrumentType = msg.instrumentType;
        this.period = msg.period;
        this.strikes = new Map();
        for (const index in msg.data) {
            this.strikes.set(msg.data[index].symbol, new DigitalOptionsUnderlyingInstrumentStrike(msg.data[index]));
        }
    }
    syncAskBidPricesFromEvent(msg) {
        msg.prices.map((price) => {
            const callSymbol = this.strikes.get(price.call.symbol);
            if (callSymbol) {
                callSymbol.ask = price.call.ask;
                callSymbol.bid = price.call.bid;
            }
            const putSymbol = this.strikes.get(price.put.symbol);
            if (putSymbol) {
                putSymbol.ask = price.put.ask;
                putSymbol.bid = price.put.bid;
            }
        });
    }
    /**
     * Closes the instance.
     */
    close() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
        }
    }
}
/**
 * Digital options underlying instrument strike class.
 */
export class DigitalOptionsUnderlyingInstrumentStrike {
    /**
     * Direction of price change.
     */
    direction;
    /**
     * Strike's price. Can be digit number or string 'SPT'. SPT is a spot strike that is always equal to the {@link CurrentQuote.value value} of the current underlying quote.
     */
    price;
    /**
     * Strike's symbol.
     */
    symbol;
    /**
     * Ask price.
     */
    ask;
    /**
     * Bid price.
     */
    bid;
    /**
     * Creates instance from DTO.
     * @param msg - Strike data transfer object.
     * @internal
     * @private
     */
    constructor(msg) {
        this.direction = msg.direction;
        this.price = msg.strike;
        this.symbol = msg.symbol;
    }
}
/**
 * Digital options order (option) class.
 */
export class DigitalOptionsOrder {
    /**
     * Order's ID.
     */
    id;
    /**
     * Creates instance from DTO.
     * @param msg - Order data transfer object.
     * @internal
     * @private
     */
    constructor(msg) {
        this.id = msg.id;
    }
}
/**
 * Margin order class.
 */
export class MarginOrder {
    /**
     * Order's ID.
     */
    id;
    /**
     * Creates instance from DTO.
     * @param msg - Order data transfer object.
     * @internal
     * @private
     */
    constructor(msg) {
        this.id = msg.id;
    }
}
export class MarginForex {
    /**
     * Instance of WebSocket API client.
     * @private
     */
    wsApiClient;
    /**
     * Underlyings current state.
     * @private
     */
    underlyings = new Map();
    /**
     * Creates instance from DTO.
     * @param underlyingList - Underlyings data transfer object.
     * @param wsApiClient - Instance of WebSocket API client.
     * @internal
     * @private
     */
    constructor(underlyingList, wsApiClient) {
        this.wsApiClient = wsApiClient;
        for (const index in underlyingList.items) {
            const underlying = underlyingList.items[index];
            this.underlyings.set(underlying.activeId, new MarginUnderlying(underlying, "forex", wsApiClient));
        }
    }
    /**
     * Subscribes on underlyings updates, requests current state of underlyings, puts the state into this class instance and returns it.
     * @param wsApiClient - Instance of WebSocket API client.
     */
    static async create(wsApiClient) {
        const request = new SubscribeMarginInstrumentsUnderlyingListChangedV1("forex");
        await wsApiClient.subscribe(request, (event) => {
            marginForexFacade.updateUnderlyings(event);
        });
        const underlyingList = await wsApiClient.doRequest(new CallMarginInstrumentsGetUnderlyingListV1("forex"));
        const marginForexFacade = new MarginForex(underlyingList, wsApiClient);
        return marginForexFacade;
    }
    /**
     * Makes request for buy margin active.
     * @param instrument - The instrument for which the option is purchased.
     * @param direction - Direction of price change.
     * @param count
     * @param balance - The balance from which the initial investment will be written off and upon successful closing of the position, profit will be credited to this balance.
     * @param stopLoss
     * @param takeProfit
     */
    async buy(instrument, direction, count, balance, stopLoss = null, takeProfit = null) {
        const request = new CallMarginPlaceMarketOrderV1(direction, balance.id, count.toString(), instrument.id, instrument.activeId, instrument.calculateLeverageProfile(balance).toString(), "forex", stopLoss, takeProfit);
        const response = await this.wsApiClient.doRequest(request);
        return new MarginOrder(response);
    }
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
    async buyStop(instrument, direction, count, balance, stopPrice, stopLoss = null, takeProfit = null) {
        const request = new CallMarginPlaceStopOrderV1(direction, balance.id, count.toString(), stopPrice.toString(), instrument.id, instrument.activeId, instrument.calculateLeverageProfile(balance).toString(), 'forex', stopLoss, takeProfit);
        const response = await this.wsApiClient.doRequest(request);
        return new MarginOrder(response);
    }
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
    async buyLimit(instrument, direction, count, balance, limitPrice, stopLoss = null, takeProfit = null) {
        const request = new CallMarginPlaceLimitOrderV1(direction, balance.id, count.toString(), limitPrice.toString(), instrument.id, instrument.activeId, instrument.calculateLeverageProfile(balance).toString(), 'forex', stopLoss, takeProfit);
        const response = await this.wsApiClient.doRequest(request);
        return new MarginOrder(response);
    }
    /**
     * Returns list of underlyings available for buy at specified time.
     * @param at - Time for which the check is performed.
     */
    getUnderlyingsAvailableForTradingAt(at) {
        const list = [];
        for (const [activeId] of this.underlyings) {
            if (this.underlyings.get(activeId).isAvailableForTradingAt(at)) {
                list.push(this.underlyings.get(activeId));
            }
        }
        return list;
    }
    /**
     * Updates instance from DTO.
     * @param msg - Underlyings data transfer object.
     * @private
     */
    updateUnderlyings(msg) {
        for (const index in msg.items) {
            const underlying = msg.items[index];
            if (this.underlyings.has(underlying.activeId)) {
                this.underlyings.get(underlying.activeId).update(underlying);
            }
            else {
                this.underlyings.set(underlying.activeId, new MarginUnderlying(underlying, "forex", this.wsApiClient));
            }
        }
    }
}
export class MarginCfd {
    /**
     * Instance of WebSocket API client.
     * @private
     */
    wsApiClient;
    /**
     * Underlyings current state.
     * @private
     */
    underlyings = new Map();
    /**
     * Creates instance from DTO.
     * @param underlyingList - Underlyings data transfer object.
     * @param wsApiClient - Instance of WebSocket API client.
     * @internal
     * @private
     */
    constructor(underlyingList, wsApiClient) {
        this.wsApiClient = wsApiClient;
        for (const index in underlyingList.items) {
            const underlying = underlyingList.items[index];
            this.underlyings.set(underlying.activeId, new MarginUnderlying(underlying, "cfd", wsApiClient));
        }
    }
    /**
     * Subscribes on underlyings updates, requests current state of underlyings, puts the state into this class instance and returns it.
     * @param wsApiClient - Instance of WebSocket API client.
     */
    static async create(wsApiClient) {
        const request = new SubscribeMarginInstrumentsUnderlyingListChangedV1("cfd");
        await wsApiClient.subscribe(request, (event) => {
            marginForexFacade.updateUnderlyings(event);
        });
        const underlyingList = await wsApiClient.doRequest(new CallMarginInstrumentsGetUnderlyingListV1("cfd"));
        const marginForexFacade = new MarginCfd(underlyingList, wsApiClient);
        return marginForexFacade;
    }
    /**
     * Makes request for buy margin active.
     * @param instrument - The instrument for which the option is purchased.
     * @param direction - Direction of price change.
     * @param count
     * @param balance - The balance from which the initial investment will be written off and upon successful closing of the position, profit will be credited to this balance.
     * @param takeProfit
     * @param stopLoss
     */
    async buy(instrument, direction, count, balance, stopLoss = null, takeProfit = null) {
        const request = new CallMarginPlaceMarketOrderV1(direction, balance.id, count.toString(), instrument.id, instrument.activeId, instrument.calculateLeverageProfile(balance).toString(), "cfd", stopLoss, takeProfit);
        const response = await this.wsApiClient.doRequest(request);
        return new MarginOrder(response);
    }
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
    async buyStop(instrument, direction, count, balance, stopPrice, stopLoss = null, takeProfit = null) {
        const request = new CallMarginPlaceStopOrderV1(direction, balance.id, count.toString(), stopPrice.toString(), instrument.id, instrument.activeId, instrument.calculateLeverageProfile(balance).toString(), 'cfd', stopLoss, takeProfit);
        const response = await this.wsApiClient.doRequest(request);
        return new MarginOrder(response);
    }
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
    async buyLimit(instrument, direction, count, balance, limitPrice, stopLoss = null, takeProfit = null) {
        const request = new CallMarginPlaceLimitOrderV1(direction, balance.id, count.toString(), limitPrice.toString(), instrument.id, instrument.activeId, instrument.calculateLeverageProfile(balance).toString(), 'cfd', stopLoss, takeProfit);
        const response = await this.wsApiClient.doRequest(request);
        return new MarginOrder(response);
    }
    /**
     * Returns list of underlyings available for buy at specified time.
     * @param at - Time for which the check is performed.
     */
    getUnderlyingsAvailableForTradingAt(at) {
        const list = [];
        for (const [activeId] of this.underlyings) {
            if (this.underlyings.get(activeId).isAvailableForTradingAt(at)) {
                list.push(this.underlyings.get(activeId));
            }
        }
        return list;
    }
    /**
     * Updates instance from DTO.
     * @param msg - Underlyings data transfer object.
     * @private
     */
    updateUnderlyings(msg) {
        for (const index in msg.items) {
            const underlying = msg.items[index];
            if (this.underlyings.has(underlying.activeId)) {
                this.underlyings.get(underlying.activeId).update(underlying);
            }
            else {
                this.underlyings.set(underlying.activeId, new MarginUnderlying(underlying, "cfd", this.wsApiClient));
            }
        }
    }
}
export class MarginCrypto {
    /**
     * Instance of WebSocket API client.
     * @private
     */
    wsApiClient;
    /**
     * Underlyings current state.
     * @private
     */
    underlyings = new Map();
    /**
     * Creates instance from DTO.
     * @param underlyingList - Underlyings data transfer object.
     * @param wsApiClient - Instance of WebSocket API client.
     * @internal
     * @private
     */
    constructor(underlyingList, wsApiClient) {
        this.wsApiClient = wsApiClient;
        for (const index in underlyingList.items) {
            const underlying = underlyingList.items[index];
            this.underlyings.set(underlying.activeId, new MarginUnderlying(underlying, "crypto", wsApiClient));
        }
    }
    /**
     * Subscribes on underlyings updates, requests current state of underlyings, puts the state into this class instance and returns it.
     * @param wsApiClient - Instance of WebSocket API client.
     */
    static async create(wsApiClient) {
        const request = new SubscribeMarginInstrumentsUnderlyingListChangedV1("crypto");
        await wsApiClient.subscribe(request, (event) => {
            marginForexFacade.updateUnderlyings(event);
        });
        const underlyingList = await wsApiClient.doRequest(new CallMarginInstrumentsGetUnderlyingListV1("crypto"));
        const marginForexFacade = new MarginCrypto(underlyingList, wsApiClient);
        return marginForexFacade;
    }
    /**
     * Makes request for buy margin active.
     * @param instrument - The instrument for which the option is purchased.
     * @param direction - Direction of price change.
     * @param count
     * @param balance - The balance from which the initial investment will be written off and upon successful closing of the position, profit will be credited to this balance.
     * @param stopLoss
     * @param takeProfit
     */
    async buy(instrument, direction, count, balance, stopLoss = null, takeProfit = null) {
        const request = new CallMarginPlaceMarketOrderV1(direction, balance.id, count.toString(), instrument.id, instrument.activeId, instrument.calculateLeverageProfile(balance).toString(), "crypto", stopLoss, takeProfit);
        const response = await this.wsApiClient.doRequest(request);
        return new MarginOrder(response);
    }
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
    async buyStop(instrument, direction, count, balance, stopPrice, stopLoss = null, takeProfit = null) {
        const request = new CallMarginPlaceStopOrderV1(direction, balance.id, count.toString(), stopPrice.toString(), instrument.id, instrument.activeId, instrument.calculateLeverageProfile(balance).toString(), 'crypto', stopLoss, takeProfit);
        const response = await this.wsApiClient.doRequest(request);
        return new MarginOrder(response);
    }
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
    async buyLimit(instrument, direction, count, balance, limitPrice, stopLoss = null, takeProfit = null) {
        const request = new CallMarginPlaceLimitOrderV1(direction, balance.id, count.toString(), limitPrice.toString(), instrument.id, instrument.activeId, instrument.calculateLeverageProfile(balance).toString(), 'crypto', stopLoss, takeProfit);
        const response = await this.wsApiClient.doRequest(request);
        return new MarginOrder(response);
    }
    /**
     * Returns list of underlyings available for buy at specified time.
     * @param at - Time for which the check is performed.
     */
    getUnderlyingsAvailableForTradingAt(at) {
        const list = [];
        for (const [activeId] of this.underlyings) {
            if (this.underlyings.get(activeId).isAvailableForTradingAt(at)) {
                list.push(this.underlyings.get(activeId));
            }
        }
        return list;
    }
    /**
     * Updates instance from DTO.
     * @param msg - Underlyings data transfer object.
     * @private
     */
    updateUnderlyings(msg) {
        for (const index in msg.items) {
            const underlying = msg.items[index];
            if (this.underlyings.has(underlying.activeId)) {
                this.underlyings.get(underlying.activeId).update(underlying);
            }
            else {
                this.underlyings.set(underlying.activeId, new MarginUnderlying(underlying, "crypto", this.wsApiClient));
            }
        }
    }
}
export class MarginUnderlying {
    /**
     * Underlying active ID.
     */
    activeId;
    /**
     * Margin instrument type (cfd/crypto/forex).
     * @private
     */
    marginInstrumentType;
    /**
     * Is trading suspended on the underlying.
     */
    isSuspended;
    /**
     * Underlying name (ticker/symbol).
     */
    name;
    /**
     * Underlying trading schedule.
     */
    schedule;
    /**
     * Instruments facade class instance.
     * @private
     */
    instrumentsFacade;
    /**
     * Instance of WebSocket API client.
     * @private
     */
    wsApiClient;
    /**
     * Creates instance from DTO.
     * @param msg - Underlying data transfer object.
     * @param marginInstrumentType
     * @param wsApiClient - Instance of WebSocket API client.
     * @internal
     * @private
     */
    constructor(msg, marginInstrumentType, wsApiClient) {
        this.activeId = msg.activeId;
        this.marginInstrumentType = marginInstrumentType;
        this.isSuspended = msg.isSuspended;
        this.name = msg.name;
        this.wsApiClient = wsApiClient;
        this.schedule = [];
        for (const index in msg.schedule) {
            const session = msg.schedule[index];
            this.schedule.push(new MarginUnderlyingTradingSession(session.open, session.close));
        }
    }
    /**
     * Checks availability for trading at specified time.
     * @param at - Time for which the check is performed.
     */
    isAvailableForTradingAt(at) {
        if (this.isSuspended) {
            return false;
        }
        const atUnixTimeMilli = at.getTime();
        return this.schedule.findIndex((session) => {
            return session.open.getTime() <= atUnixTimeMilli && session.close.getTime() >= atUnixTimeMilli;
        }) >= 0;
    }
    /**
     * Returns margin active's instruments facade.
     */
    async instruments() {
        if (!this.instrumentsFacade) {
            this.instrumentsFacade = await MarginUnderlyingInstruments.create(this.activeId, this.marginInstrumentType, this.wsApiClient);
        }
        return this.instrumentsFacade;
    }
    /**
     * Updates the instance from DTO.
     * @param msg - Underlying data transfer object.
     * @private
     */
    update(msg) {
        this.isSuspended = msg.isSuspended;
        this.name = msg.name;
        this.schedule = [];
        for (const index in msg.schedule) {
            const session = msg.schedule[index];
            this.schedule.push(new MarginUnderlyingTradingSession(session.open, session.close));
        }
    }
}
/**
 * Margin forex active trading session class.
 */
export class MarginUnderlyingTradingSession {
    /**
     * Start time of trading session.
     */
    open;
    /**
     * End time of trading session.
     */
    close;
    /**
     * Initialises class instance from DTO.
     * @param openTs - Unix time of session start.
     * @param closeTs - Unix time of session end.
     * @internal
     * @private
     */
    constructor(openTs, closeTs) {
        this.open = new Date(openTs * 1000);
        this.close = new Date(closeTs * 1000);
    }
}
/**
 * Margin underlying instruments facade class.
 */
export class MarginUnderlyingInstruments {
    /**
     * Instruments current state.
     * @private
     */
    instruments = new Map();
    /**
     * Just private constructor. Use {@link MarginUnderlyingInstruments.create create} instead.
     * @internal
     * @private
     */
    constructor() {
    }
    /**
     * Subscribes on underlying instruments updates, requests current state of underlying instruments, puts the state into this class instance and returns it.
     * @param activeId
     * @param marginInstrumentType
     * @param wsApiClient
     */
    static async create(activeId, marginInstrumentType, wsApiClient) {
        const instrumentsFacade = new MarginUnderlyingInstruments();
        const instruments = await wsApiClient.doRequest(new CallMarginInstrumentsGetInstrumentsListV1(activeId, marginInstrumentType));
        instrumentsFacade.syncInstrumentsFromResponse(instruments);
        return instrumentsFacade;
    }
    /**
     * Returns list of instruments available for buy at specified time.
     * @param at - Time for which the check is performed.
     */
    getAvailableForBuyAt(at) {
        const list = [];
        for (const [index] of this.instruments) {
            if (this.instruments.get(index).isAvailableForBuyAt(at)) {
                list.push(this.instruments.get(index));
            }
        }
        return list;
    }
    /**
     * Updates the instance from DTO.
     * @param msg - Instruments data transfer object.
     * @private
     */
    syncInstrumentsFromResponse(msg) {
        const instrumentIds = [];
        for (const index in msg.items) {
            const instrument = msg.items[index];
            instrumentIds.push(instrument.id);
            this.syncInstrumentFromResponse(instrument);
        }
        for (const [index] of this.instruments) {
            if (!instrumentIds.includes(this.instruments.get(index).id)) {
                this.instruments.delete(index);
            }
        }
    }
    /**
     * Updates the instance from DTO.
     * @param msg - Instrument data transfer object.
     * @private
     */
    syncInstrumentFromResponse(msg) {
        if (!this.instruments.has(msg.id)) {
            this.instruments.set(msg.id, new MarginUnderlyingInstrument(msg));
        }
        else {
            this.instruments.get(msg.id).sync(msg);
        }
    }
}
/**
 * Margin underlying instruments facade class.
 */
export class MarginUnderlyingInstrument {
    /**
     * Instrument ID.
     */
    id;
    /**
     * Active ID of the instrument.
     */
    activeId;
    /**
     * Allow long positions.
     */
    allowLongPosition;
    /**
     * Allow short positions.
     */
    allowShortPosition;
    /**
     * Default leverage for the instrument.
     */
    defaultLeverage;
    /**
     * Leverage profile for the instrument.
     */
    leverageProfile;
    /**
     * Indicates if the instrument is suspended.
     */
    isSuspended;
    /**
     * The minimum amount when buying an asset.
     */
    minQty;
    /**
     * The step of the amount when buying an asset.
     */
    qtyStep;
    /**
     * Active trading schedule.
     */
    tradable;
    /**
     * Dynamic leverage profiles.
     */
    dynamicLeverageProfiles;
    /**
     * Creates instance from DTO.
     * @param msg - Instrument data transfer object.
     * @internal
     * @private
     */
    constructor(msg) {
        this.id = msg.id;
        this.activeId = msg.activeId;
        this.allowLongPosition = msg.allowLongPosition;
        this.allowShortPosition = msg.allowShortPosition;
        this.defaultLeverage = msg.defaultLeverage;
        this.leverageProfile = msg.leverageProfile;
        this.isSuspended = msg.isSuspended;
        this.minQty = parseFloat(msg.minQty);
        this.qtyStep = parseFloat(msg.qtyStep);
        this.tradable = new MarginUnderlyingInstrumentTradable(msg.tradable.from, msg.tradable.to);
        this.dynamicLeverageProfiles = msg.dynamicLeverageProfile;
    }
    /**
     * Checks availability for buy option at specified time.
     * @param at - Time for which the check is performed.
     */
    isAvailableForBuyAt(at) {
        const atUnixTimeMilli = at.getTime();
        return this.tradable.from.getTime() <= atUnixTimeMilli && this.tradable.to.getTime() >= atUnixTimeMilli;
    }
    /**
     * Returns the remaining duration in milliseconds for which it is possible to purchase options.
     * @param {Date} currentTime - The current time.
     * @returns {number} - The remaining duration in milliseconds.
     */
    durationRemainingForPurchase(currentTime) {
        if (!this.isAvailableForBuyAt(currentTime)) {
            return 0;
        }
        return this.tradable.to.getTime() - currentTime.getTime();
    }
    sync(msg) {
        this.id = msg.id;
        this.activeId = msg.activeId;
        this.allowLongPosition = msg.allowLongPosition;
        this.allowShortPosition = msg.allowShortPosition;
        this.defaultLeverage = msg.defaultLeverage;
        this.leverageProfile = msg.leverageProfile;
        this.isSuspended = msg.isSuspended;
        this.minQty = parseFloat(msg.minQty);
        this.qtyStep = parseFloat(msg.qtyStep);
        this.tradable = new MarginUnderlyingInstrumentTradable(msg.tradable.from, msg.tradable.to);
        this.dynamicLeverageProfiles = msg.dynamicLeverageProfile;
    }
    calculateLeverageProfile(balance) {
        if (!this.dynamicLeverageProfiles) {
            return this.defaultLeverage;
        }
        if (!balance.equityUsd) {
            return this.defaultLeverage;
        }
        if (this.dynamicLeverageProfiles.length === 1) {
            return this.dynamicLeverageProfiles[0].leverage;
        }
        let leverage = this.defaultLeverage;
        for (const index in this.dynamicLeverageProfiles) {
            const profile = this.dynamicLeverageProfiles[index];
            if (balance.equityUsd < profile.equity) {
                return leverage;
            }
            else {
                leverage = profile.leverage;
            }
        }
        return this.dynamicLeverageProfiles[this.dynamicLeverageProfiles.length - 1].leverage;
    }
}
class MarginUnderlyingInstrumentTradable {
    /**
     * Start time of trading session.
     */
    from;
    /**
     * End time of trading session.
     */
    to;
    /**
     * Initialises class instance from DTO.
     * @param fromTs - Unix time of session start.
     * @param toTs - Unix time of session end.
     */
    constructor(fromTs, toTs) {
        this.from = new Date(fromTs * 1000);
        this.to = new Date(toTs * 1000);
    }
}
// Common classes
/**
 * Observable class.
 * @ignore
 * @internal
 */
class Observable {
    observers = [];
    subscribe(func) {
        this.observers.push(func);
    }
    unsubscribe(func) {
        this.observers = this.observers.filter((observer) => observer !== func);
    }
    notify(data) {
        this.observers.forEach((observer) => observer(data));
    }
}
/**
 * HttpApiClient class.
 * @ignore
 * @internal
 */
class HttpApiClient {
    apiUrl;
    isBrowser = typeof window !== 'undefined';
    constructor(apiUrl) {
        this.apiUrl = apiUrl;
    }
    async doRequest(request) {
        const url = new URL(`${this.apiUrl}${request.path()}`);
        if (request.method() === 'GET' && request.messageBody()) {
            Object.entries(request.messageBody()).forEach(([key, value]) => {
                if (Array.isArray(value)) {
                    value.forEach(item => url.searchParams.append(`${key}[]`, String(item)));
                }
                else {
                    url.searchParams.append(key, String(value));
                }
            });
        }
        const requestUrl = url.toString();
        const headers = {
            'Content-Type': 'application/json',
        };
        if (!this.isBrowser) {
            headers['User-Agent'] = 'quadcode-client-sdk-js/1.3.21';
        }
        const requestOptions = {
            method: request.method(),
            headers: headers,
            body: request.method() !== 'GET' ? JSON.stringify(request.messageBody()) : undefined
        };
        try {
            const response = await fetch(requestUrl, requestOptions);
            const data = await response.json();
            return request.createResponse(response.status, data);
        }
        catch (error) {
            console.error(`[HttpApiClient] Request failed:`, {
                url: requestUrl,
                method: request.method(),
                error: error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : undefined
            });
            throw error;
        }
    }
}
// WS API client
/**
 * WebSocket API client class.
 * @ignore
 * @internal
 */
class WsApiClient {
    currentTime;
    /**
     * API URL for WebSocket connection.
     */
    apiUrl;
    onCurrentTimeChangedObserver = new Observable();
    platformId;
    authMethod;
    isBrowser = typeof window !== 'undefined';
    initialReconnectTimeout = 100;
    reconnectMultiplier = 2;
    maxReconnectTimeout = 10000;
    reconnectTimeout = 100;
    disconnecting = false;
    reconnecting = false;
    connection;
    lastRequestId = 0;
    pendingRequests = new Map();
    subscriptions = new Map();
    onConnectionStateChanged;
    timeSyncInterval;
    lastTimeSyncReceived = 0;
    reconnectTimeoutHandle = undefined;
    isClosing = false;
    pendingDrainWaiters = [];
    constructor(apiUrl, platformId, authMethod) {
        this.currentTime = new WsApiClientCurrentTime(new Date().getTime());
        this.apiUrl = apiUrl;
        this.platformId = platformId;
        this.authMethod = authMethod;
    }
    startTimeSyncMonitoring() {
        this.stopTimeSyncMonitoring();
        this.lastTimeSyncReceived = Date.now();
        this.timeSyncInterval = setInterval(() => {
            if (Date.now() - this.lastTimeSyncReceived > 60000 && !this.reconnecting) {
                this.forceCloseConnection();
                this.reconnect();
            }
        }, 10000);
    }
    stopTimeSyncMonitoring() {
        if (this.timeSyncInterval) {
            clearInterval(this.timeSyncInterval);
            this.timeSyncInterval = undefined;
        }
    }
    subscribeOnWsCurrentTime(callback) {
        this.onCurrentTimeChangedObserver.subscribe((time) => callback(new Date(time)));
    }
    unsubscribeOnWsCurrentTime(callback) {
        this.onCurrentTimeChangedObserver.unsubscribe((time) => callback(new Date(time)));
    }
    updateCurrentTime(time) {
        this.currentTime.unixMilliTime = time;
        this.onCurrentTimeChangedObserver.notify(time);
    }
    async connect() {
        if (this.connection !== undefined || this.disconnecting) {
            return;
        }
        return new Promise((resolve, reject) => {
            try {
                if (!this.isBrowser) {
                    this.connection = new WebSocket(this.apiUrl, undefined, {
                        headers: {
                            'cookie': `platform=${this.platformId}`,
                            'user-agent': 'quadcode-client-sdk-js/1.3.21'
                        }
                    });
                }
                else {
                    document.cookie = `platform=${this.platformId};`;
                    this.connection = new WebSocket(this.apiUrl);
                }
                this.connection.onerror = (err) => {
                    this.forceCloseConnection();
                    return reject(err);
                };
            }
            catch (err) {
                return reject(err);
            }
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-expect-error ignore
            this.connection.onmessage = ({ data }) => {
                const frame = JSON.parse(data);
                if (frame.request_id) {
                    if (this.pendingRequests.has(frame.request_id)) {
                        const requestMetaData = this.pendingRequests.get(frame.request_id);
                        if (frame.status >= 4000) {
                            this.finalizeRequest(frame.request_id);
                            requestMetaData.reject(this.createRequestError(frame.status, frame.msg, requestMetaData.request));
                            return;
                        }
                        if (frame.name === 'result' && !requestMetaData.request.resultOnly()) {
                            const result = new Result(frame.msg);
                            if (!result.success) {
                                this.finalizeRequest(frame.request_id);
                                requestMetaData.reject(`request result is not successful`);
                            }
                            return;
                        }
                        try {
                            const response = requestMetaData.request.createResponse(frame.msg);
                            requestMetaData.resolve(response);
                        }
                        catch (e) {
                            requestMetaData.reject(e);
                        }
                        finally {
                            this.finalizeRequest(frame.request_id);
                        }
                    }
                }
                else if (frame.microserviceName && frame.name) {
                    const subscriptionKey = `${frame.microserviceName},${frame.name}`;
                    if (this.subscriptions.has(subscriptionKey)) {
                        const subscriptions = this.subscriptions.get(subscriptionKey);
                        for (const index in subscriptions) {
                            const subscriptionMetaData = subscriptions[index];
                            subscriptionMetaData.callback(subscriptionMetaData.request.createEvent(frame.msg));
                        }
                    }
                }
                else if (frame.name && frame.name === 'timeSync') {
                    this.lastTimeSyncReceived = Date.now();
                    this.updateCurrentTime(frame.msg);
                    return;
                }
                else if (frame.name && frame.name === 'authenticated' && frame.msg === false) {
                    for (const [, requestMetaData] of this.pendingRequests) {
                        if (requestMetaData.request instanceof Authenticate) {
                            requestMetaData.resolve(new Authenticated(false));
                        }
                    }
                }
            };
            this.connection.onopen = async () => {
                try {
                    const isSuccessful = await this.authMethod.authenticateWsApiClient(this);
                    if (!isSuccessful) {
                        this.disconnect();
                        return reject(new Error('authentication is failed'));
                    }
                    const setOptionsResponse = await this.doRequest(new SetOptions(true));
                    if (!setOptionsResponse.success) {
                        this.disconnect();
                        return reject(new Error('setOptions operation is failed'));
                    }
                    // BEGIN_EXCLUDE
                    try {
                        const response = await this.doRequest(new CallGetFeaturesV2());
                        for (const feature of response.features) {
                            if (feature.name === 'client-sdk' && feature.status === 'disabled') {
                                return reject(new Error('platform does not support'));
                            }
                        }
                    }
                    catch (error) {
                        // it's okay
                    }
                    // END_EXCLUDE
                    this.connection.onclose = () => {
                        this.forceCloseConnection();
                        this.reconnect();
                    };
                    this.connection.onerror = () => {
                        this.forceCloseConnection();
                        this.reconnect();
                    };
                    this.startTimeSyncMonitoring();
                    this.onConnectionStateChanged?.(WsConnectionStateEnum.Connected);
                    return resolve();
                }
                catch (e) {
                    this.clear();
                    return reject(e);
                }
            };
        });
    }
    createRequestError(status, details, request) {
        if (request.createError) {
            return request.createError(status, details);
        }
        return new Error(`request is failed with status ${status} and message: ${details?.message}`);
    }
    async disconnectGracefully(timeoutMs = 5000) {
        if (this.disconnecting)
            return;
        this.disconnecting = true;
        this.isClosing = true;
        this.stopTimeSyncMonitoring();
        if (this.reconnectTimeoutHandle) {
            clearTimeout(this.reconnectTimeoutHandle);
            this.reconnectTimeoutHandle = undefined;
        }
        this.reconnecting = false;
        const drained = await this.waitForPendingRequestsEmpty(timeoutMs);
        if (!drained && this.pendingRequests.size > 0) {
            this.rejectAllPendingRequests(new Error('WebSocket disconnected (graceful timeout)'));
        }
        this.forceCloseConnection();
        this.subscriptions.clear();
        this.lastRequestId = 0;
        this.onConnectionStateChanged?.(WsConnectionStateEnum.Disconnected);
    }
    notifyPendingDrainIfNeeded() {
        if (this.pendingRequests.size === 0 && this.pendingDrainWaiters.length > 0) {
            const waiters = this.pendingDrainWaiters;
            this.pendingDrainWaiters = [];
            waiters.forEach((w) => w());
        }
    }
    waitForPendingRequestsEmpty(timeoutMs) {
        if (this.pendingRequests.size === 0)
            return Promise.resolve(true);
        return new Promise((resolve) => {
            const onDrained = () => {
                clearTimeout(timer);
                resolve(true);
            };
            const timer = setTimeout(() => {
                const idx = this.pendingDrainWaiters.indexOf(onDrained);
                if (idx >= 0)
                    this.pendingDrainWaiters.splice(idx, 1);
                resolve(false);
            }, timeoutMs);
            this.pendingDrainWaiters.push(onDrained);
        });
    }
    disconnect() {
        this.disconnecting = true;
        this.clear();
        this.onConnectionStateChanged?.(WsConnectionStateEnum.Disconnected);
    }
    clear() {
        if (this.reconnectTimeoutHandle) {
            clearTimeout(this.reconnectTimeoutHandle);
            this.reconnectTimeoutHandle = undefined;
        }
        this.stopTimeSyncMonitoring();
        this.forceCloseConnection();
        this.reconnecting = false;
        this.lastRequestId = 0;
        this.subscriptions.clear();
    }
    forceCloseConnection() {
        if (this.connection) {
            try {
                if (!this.isBrowser) {
                    this.connection.terminate();
                }
                else {
                    this.connection.close();
                }
            }
            finally {
                this.connection = undefined;
                this.rejectAllPendingRequests(new Error('WebSocket connection closed unexpectedly'));
            }
        }
    }
    reconnect() {
        if (this.disconnecting || this.reconnecting) {
            return;
        }
        this.reconnecting = true;
        this.onConnectionStateChanged?.(WsConnectionStateEnum.Disconnected);
        const attemptReconnect = async () => {
            if (this.disconnecting) {
                this.reconnecting = false;
                return;
            }
            this.connect().then(() => {
                this.resubscribeAll();
                this.reconnectTimeout = this.initialReconnectTimeout;
                this.reconnecting = false;
            }).catch(() => {
                this.reconnectTimeout = Math.min(this.reconnectTimeout * this.reconnectMultiplier, this.maxReconnectTimeout) + this.getJitter();
                this.reconnectTimeoutHandle = setTimeout(attemptReconnect, this.reconnectTimeout);
            });
        };
        this.reconnectTimeoutHandle = setTimeout(attemptReconnect, this.reconnectTimeout);
    }
    getJitter() {
        return Math.floor(Math.random() * 1000);
    }
    finalizeRequest(requestId) {
        this.pendingRequests.delete(requestId);
        this.notifyPendingDrainIfNeeded();
    }
    doRequest(request) {
        if (this.isClosing || this.disconnecting) {
            return Promise.reject(new Error('WebSocket is closing; new requests are rejected'));
        }
        const requestId = (++this.lastRequestId).toString();
        if (!this.connection || this.connection.readyState !== WebSocket.OPEN) {
            return Promise.reject(new Error('WebSocket connection is not open'));
        }
        this.connection.send(JSON.stringify({
            name: request.messageName(),
            request_id: requestId,
            msg: request.messageBody()
        }));
        return new Promise((resolve, reject) => {
            this.pendingRequests.set(requestId, new RequestMetaData(request, resolve, reject));
        });
    }
    rejectAllPendingRequests(reason) {
        for (const [, meta] of this.pendingRequests) {
            meta.reject(reason);
        }
        this.pendingRequests.clear();
    }
    resubscribeAll() {
        return new Promise((resolve, reject) => {
            const promises = [];
            if (this.subscriptions.size > 0) {
                for (const [, value] of this.subscriptions) {
                    for (const index in value) {
                        const subscriptionMetaData = value[index];
                        promises.push(this.doRequest(new SubscribeMessage(subscriptionMetaData.request.messageBody())));
                    }
                }
            }
            Promise.all(promises).then(resolve).catch(reject);
        });
    }
    subscribe(request, callback) {
        return new Promise((resolve, reject) => {
            const subscriptionKey = `${request.eventMicroserviceName()},${request.eventName()}`;
            if (!this.subscriptions.has(subscriptionKey)) {
                this.subscriptions.set(subscriptionKey, []);
            }
            this.subscriptions.get(subscriptionKey).push(new SubscriptionMetaData(request, callback));
            this.doRequest(new SubscribeMessage(request.messageBody())).then(resolve).catch(reject);
        });
    }
    unsubscribe(request) {
        return new Promise((resolve, reject) => {
            const subscriptionKey = `${request.eventMicroserviceName()},${request.eventName()}`;
            if (this.subscriptions.has(subscriptionKey)) {
                const subscriptions = this.subscriptions.get(subscriptionKey);
                for (const index in subscriptions) {
                    const subscriptionMetaData = subscriptions[index];
                    if (subscriptionMetaData.request === request) {
                        subscriptions.splice(parseInt(index), 1);
                        break;
                    }
                }
            }
            this.doRequest(new UnsubscribeMessage(request.messageBody())).then(resolve).catch(reject);
        });
    }
}
class WsApiClientCurrentTime {
    unixMilliTime;
    constructor(unixMilliTime) {
        this.unixMilliTime = unixMilliTime;
    }
}
class RequestMetaData {
    request;
    resolve;
    reject;
    constructor(request, resolve, reject) {
        this.request = request;
        this.resolve = resolve;
        this.reject = reject;
    }
}
class SubscriptionMetaData {
    request;
    callback;
    constructor(request, callback) {
        this.request = request;
        this.callback = callback;
    }
}
// DTO classes
// Inbound messages
class Authenticated {
    isSuccessful;
    constructor(isSuccessful) {
        this.isSuccessful = isSuccessful;
    }
}
class HttpResponse {
    status;
    data;
    constructor(status, data) {
        this.status = status;
        this.data = data;
    }
}
class HttpLoginResponse {
    code;
    ssid;
    constructor(data) {
        this.code = data.code;
        this.ssid = data.ssid;
    }
}
class Result {
    success;
    reason;
    constructor(data) {
        this.success = data.success;
        this.reason = data.reason;
    }
}
class BinaryOptionsOptionV1 {
    id;
    activeId;
    direction;
    expired;
    price;
    profitIncome;
    timeRate;
    type;
    value;
    constructor(data) {
        this.id = data.id;
        this.activeId = data.act;
        this.direction = data.direction;
        this.expired = data.exp;
        this.price = data.price;
        this.profitIncome = data.profit_income;
        this.timeRate = data.time_rate;
        this.type = data.type;
        this.value = data.value;
    }
}
class CoreProfileV1 {
    userId;
    firstName;
    lastName;
    constructor(data) {
        this.userId = data.result.user_id;
        this.firstName = data.result.first_name;
        this.lastName = data.result.last_name;
    }
}
class DigitalOptionInstrumentsInstrumentGeneratedV3 {
    assetId;
    data = [];
    deadtime;
    expiration;
    index;
    instrumentType;
    period;
    constructor(msg) {
        this.assetId = msg.asset_id;
        for (const index in msg.data) {
            this.data.push(new DigitalOptionInstrumentsInstrumentGeneratedV3DataItem(msg.data[index]));
        }
        this.deadtime = msg.deadtime;
        this.expiration = msg.expiration;
        this.index = msg.index;
        this.instrumentType = msg.instrument_type;
        this.period = msg.period;
    }
}
class DigitalOptionInstrumentsInstrumentGeneratedV3DataItem {
    direction;
    strike;
    symbol;
    constructor(msg) {
        this.direction = msg.direction;
        this.strike = msg.strike;
        this.symbol = msg.symbol;
    }
}
class DigitalOptionInstrumentsInstrumentsV3 {
    instruments = [];
    constructor(data) {
        for (const index in data.instruments) {
            const instrument = data.instruments[index];
            this.instruments.push(new DigitalOptionInstrumentsInstrumentsV3Instrument(instrument));
        }
    }
}
class DigitalOptionInstrumentsInstrumentsV3Instrument {
    assetId;
    data = [];
    deadtime;
    expiration;
    index;
    instrumentType;
    period;
    constructor(msg) {
        this.assetId = msg.asset_id;
        for (const index in msg.data) {
            this.data.push(new DigitalOptionInstrumentsInstrumentsV3InstrumentDataItem(msg.data[index]));
        }
        this.deadtime = msg.deadtime;
        this.expiration = msg.expiration;
        this.index = msg.index;
        this.instrumentType = msg.instrument_type;
        this.period = msg.period;
    }
}
class DigitalOptionInstrumentsInstrumentsV3InstrumentDataItem {
    direction;
    strike;
    symbol;
    constructor(msg) {
        this.direction = msg.direction;
        this.strike = msg.strike;
        this.symbol = msg.symbol;
    }
}
class DigitalOptionInstrumentsUnderlyingListChangedV3 {
    type;
    underlying = [];
    constructor(data) {
        this.type = data.type;
        for (const index in data.underlying) {
            const underlying = data.underlying[index];
            this.underlying.push(new DigitalOptionInstrumentsUnderlyingListChangedV3Underlying(underlying.active_id, underlying.is_suspended, underlying.name, underlying.schedule));
        }
    }
}
class DigitalOptionInstrumentsUnderlyingListChangedV3Underlying {
    activeId;
    isSuspended;
    name;
    schedule;
    constructor(activeId, isSuspended, name, schedule) {
        this.activeId = activeId;
        this.isSuspended = isSuspended;
        this.name = name;
        this.schedule = schedule;
    }
}
class DigitalOptionInstrumentsUnderlyingListV3 {
    type;
    underlying = [];
    constructor(data) {
        this.type = data.type;
        for (const index in data.underlying) {
            const underlying = data.underlying[index];
            this.underlying.push(new DigitalOptionInstrumentsUnderlyingListV3Underlying(underlying.active_id, underlying.is_suspended, underlying.name, underlying.schedule));
        }
    }
}
class DigitalOptionInstrumentsUnderlyingListV3Underlying {
    activeId;
    isSuspended;
    name;
    schedule;
    constructor(activeId, isSuspended, name, schedule) {
        this.activeId = activeId;
        this.isSuspended = isSuspended;
        this.name = name;
        this.schedule = schedule;
    }
}
class DigitalOptionPlacedV3 {
    id;
    constructor(data) {
        this.id = data.id;
    }
}
class MarginOrderPlacedV1 {
    id;
    constructor(data) {
        this.id = data.id;
    }
}
class InitializationDataV3 {
    binaryActives = [];
    blitzActives = [];
    turboActives = [];
    constructor(msg) {
        for (const index in msg.binary.actives) {
            this.binaryActives.push(new InitializationDataV3BinaryActive(msg.binary.actives[index]));
        }
        for (const index in msg.blitz.actives) {
            this.blitzActives.push(new InitializationDataV3BlitzActive(msg.blitz.actives[index]));
        }
        for (const index in msg.turbo.actives) {
            this.turboActives.push(new InitializationDataV3TurboActive(msg.turbo.actives[index]));
        }
    }
}
class InitializationDataV3BlitzActive {
    id;
    name;
    ticker;
    isSuspended;
    expirationTimes;
    profitCommission;
    schedule = [];
    constructor(data) {
        this.id = data.id;
        this.name = data.name;
        this.ticker = data.ticker;
        this.isSuspended = data.is_suspended;
        this.expirationTimes = data.option.expiration_times;
        this.profitCommission = data.option.profit.commission;
        this.schedule = data.schedule;
    }
}
class InitializationDataV3TurboActive {
    id;
    name;
    buybackDeadtime;
    deadtime;
    ticker;
    isBuyback;
    isSuspended;
    optionCount;
    expirationTimes;
    profitCommission;
    schedule = [];
    constructor(data) {
        this.id = data.id;
        this.name = data.name;
        this.buybackDeadtime = data.buyback_deadtime;
        this.deadtime = data.deadtime;
        this.ticker = data.ticker;
        this.schedule = data.schedule;
        this.isBuyback = data.is_buyback;
        this.isSuspended = data.is_suspended;
        this.optionCount = data.option.count;
        this.expirationTimes = data.option.expiration_times;
        this.profitCommission = data.option.profit.commission;
    }
}
class InitializationDataV3BinaryActive {
    id;
    name;
    buybackDeadtime;
    deadtime;
    ticker;
    isBuyback;
    isSuspended;
    optionCount;
    optionSpecial = [];
    expirationTimes;
    profitCommission;
    schedule = [];
    constructor(data) {
        this.id = data.id;
        this.name = data.name;
        this.buybackDeadtime = data.buyback_deadtime;
        this.deadtime = data.deadtime;
        this.ticker = data.ticker;
        this.isBuyback = data.is_buyback;
        this.isSuspended = data.is_suspended;
        this.optionCount = data.option.count;
        this.expirationTimes = data.option.expiration_times;
        this.profitCommission = data.option.profit.commission;
        this.schedule = data.schedule;
        for (const expiredAt in data.option.special) {
            this.optionSpecial.push(new InitializationDataV3BinaryActiveSpecialInstrument(parseInt(expiredAt), data.option.special[expiredAt]));
        }
    }
}
class InitializationDataV3BinaryActiveSpecialInstrument {
    title;
    enabled;
    expiredAt;
    constructor(expiredAt, msg) {
        this.title = msg.title;
        this.enabled = msg.enabled;
        this.expiredAt = expiredAt;
    }
}
class BalancesBalanceChangedV1 {
    id;
    type;
    amount;
    bonusAmount;
    currency;
    userId;
    constructor(data) {
        this.id = data.current_balance.id;
        this.type = data.current_balance.type;
        this.amount = data.current_balance.amount;
        this.bonusAmount = data.current_balance.bonus_amount;
        this.currency = data.current_balance.currency;
        this.userId = data.user_id;
    }
}
class DigitalOptionClientPriceGeneratedV1 {
    instrumentIndex;
    assetId;
    digitalOptionTradingGroupId;
    quoteTime;
    prices = [];
    constructor(data) {
        this.instrumentIndex = data.instrument_index;
        this.assetId = data.asset_id;
        this.digitalOptionTradingGroupId = data.digital_option_trading_group_id;
        this.quoteTime = data.quote_time;
        for (const index in data.prices) {
            this.prices.push(new DigitalOptionClientPriceGeneratedV1Price(data.prices[index]));
        }
    }
}
class DigitalOptionClientPriceGeneratedV1Price {
    strike;
    call;
    put;
    constructor(data) {
        this.strike = data.strike;
        this.call = new DigitalOptionClientPriceGeneratedV1CallOrPutPrice(data.call);
        this.put = new DigitalOptionClientPriceGeneratedV1CallOrPutPrice(data.put);
    }
}
class DigitalOptionClientPriceGeneratedV1CallOrPutPrice {
    symbol;
    ask;
    bid;
    constructor(data) {
        this.symbol = data.symbol;
        this.ask = data.ask;
        this.bid = data.bid;
    }
}
class BalancesAvailableBalancesV1 {
    items = [];
    constructor(balances) {
        for (const index in balances) {
            this.items.push(new BalancesAvailableBalancesV1Balance(balances[index]));
        }
    }
}
class BalancesAvailableBalancesV1Balance {
    id;
    type;
    amount;
    bonusAmount;
    currency;
    userId;
    isMargin;
    constructor(data) {
        this.id = data.id;
        this.type = data.type;
        this.amount = data.amount;
        this.bonusAmount = data.bonus_amount;
        this.currency = data.currency;
        this.userId = data.user_id;
        this.isMargin = data.is_marginal;
    }
}
class PortfolioPositionChangedV3 {
    activeId;
    closeProfit;
    closeQuote;
    closeReason;
    closeTime;
    expectedProfit;
    externalId;
    internalId;
    instrumentType;
    invest;
    openQuote;
    openTime;
    pnl;
    pnlRealized;
    quoteTimestamp;
    status;
    userId;
    userBalanceId;
    version;
    direction;
    expirationTime;
    orderIds;
    constructor(data) {
        this.activeId = data.active_id;
        this.closeProfit = data.close_profit;
        this.closeQuote = data.close_quote;
        this.closeReason = data.close_reason;
        this.closeTime = data.close_time;
        this.expectedProfit = data.expected_profit;
        this.instrumentType = data.instrument_type;
        this.externalId = data.external_id;
        this.internalId = data.id;
        this.invest = data.invest;
        this.openQuote = data.open_quote;
        this.openTime = data.open_time;
        this.pnl = data.pnl;
        this.pnlRealized = data.pnl_realized;
        this.quoteTimestamp = data.quote_timestamp;
        this.status = data.status;
        this.userId = data.user_id;
        this.userBalanceId = data.user_balance_id;
        this.version = data.version;
        if (data.raw_event) {
            let order_ids;
            switch (data.instrument_type) {
                case InstrumentType.BinaryOption:
                case InstrumentType.TurboOption:
                case InstrumentType.BlitzOption:
                    order_ids = data.raw_event.binary_options_option_changed1.order_ids;
                    this.direction = data.raw_event.binary_options_option_changed1.direction;
                    if (data.raw_event.binary_options_option_changed1.expiration_time) {
                        this.expirationTime = data.raw_event.binary_options_option_changed1.expiration_time * 1000;
                    }
                    break;
                case InstrumentType.DigitalOption:
                    order_ids = data.raw_event.digital_options_position_changed1.order_ids;
                    this.direction = data.raw_event.digital_options_position_changed1.instrument_dir;
                    if (data.raw_event.digital_options_position_changed1.instrument_expiration) {
                        this.expirationTime = data.raw_event.digital_options_position_changed1.instrument_expiration;
                    }
                    break;
                case InstrumentType.MarginCfd:
                    order_ids = data.raw_event.marginal_cfd_position_changed1.order_ids;
                    break;
                case InstrumentType.MarginForex:
                    order_ids = data.raw_event.marginal_forex_position_changed1.order_ids;
                    break;
                case InstrumentType.MarginCrypto:
                    order_ids = data.raw_event.marginal_crypto_position_changed1.order_ids;
                    break;
            }
            if (order_ids) {
                this.orderIds = order_ids;
            }
            else {
                this.orderIds = [data.external_id];
            }
        }
        else {
            this.orderIds = [data.external_id];
        }
    }
}
class PortfolioPositionsHistoryV2 {
    limit;
    positions = [];
    constructor(data) {
        this.limit = data.limit;
        for (const index in data.positions) {
            this.positions.push(new PortfolioPositionsHistoryV2Position(data.positions[index]));
        }
    }
}
class PortfolioPositionsHistoryV2Position {
    externalId;
    internalId;
    userId;
    userBalanceId;
    activeId;
    instrumentType;
    status;
    openQuote;
    openTime;
    invest;
    closeProfit;
    closeQuote;
    closeReason;
    closeTime;
    pnl;
    pnlRealized;
    pnlNet;
    orderIds;
    direction;
    constructor(data) {
        this.activeId = data.active_id;
        this.closeProfit = data.close_profit;
        this.closeQuote = data.close_quote;
        this.closeReason = data.close_reason;
        this.closeTime = data.close_time;
        this.externalId = data.external_id;
        this.internalId = data.id;
        this.instrumentType = data.instrument_type;
        this.invest = data.invest;
        this.openQuote = data.open_quote;
        this.openTime = data.open_time;
        this.pnl = data.pnl;
        this.pnlRealized = data.pnl_realized;
        this.pnlNet = data.pnl_net;
        this.status = data.status;
        this.userId = data.user_id;
        this.userBalanceId = data.user_balance_id;
        if (data.raw_event) {
            let order_ids;
            switch (data.instrument_type) {
                case InstrumentType.BinaryOption:
                case InstrumentType.TurboOption:
                case InstrumentType.BlitzOption:
                    order_ids = data.raw_event.binary_options_option_changed1.order_ids;
                    this.direction = data.raw_event.binary_options_option_changed1.direction;
                    break;
                case InstrumentType.DigitalOption:
                    order_ids = data.raw_event.digital_options_position_changed1.order_ids;
                    this.direction = data.raw_event.digital_options_position_changed1.instrument_dir;
                    break;
                case InstrumentType.MarginCfd:
                    order_ids = data.raw_event.marginal_cfd_position_changed1.order_ids;
                    break;
                case InstrumentType.MarginForex:
                    order_ids = data.raw_event.marginal_forex_position_changed1.order_ids;
                    break;
                case InstrumentType.MarginCrypto:
                    order_ids = data.raw_event.marginal_crypto_position_changed1.order_ids;
                    break;
            }
            if (order_ids) {
                this.orderIds = order_ids;
            }
            else {
                this.orderIds = [data.external_id];
            }
        }
        else {
            this.orderIds = [data.external_id];
        }
    }
}
class PortfolioPositionsV4 {
    limit;
    positions = [];
    total;
    constructor(data) {
        this.limit = data.limit;
        this.total = data.total;
        for (const index in data.positions) {
            this.positions.push(new PortfolioPositionsV4Position(data.positions[index]));
        }
    }
}
class PortfolioPositionsStateV1 {
    positions = [];
    expiresIn;
    userId;
    subscriptionId;
    constructor(data) {
        this.expiresIn = data.expires_in;
        this.userId = data.user_id;
        this.subscriptionId = data.subscription_id;
        for (const index in data.positions) {
            this.positions.push(new PortfolioPositionsStateV1Position(data.positions[index]));
        }
    }
}
class PortfolioPositionsStateV1Position {
    internalId;
    instrumentType;
    sellProfit;
    margin;
    currentPrice;
    quoteTimestamp;
    pnl;
    pnlNet;
    openPrice;
    expectedProfit;
    currencyConversion;
    constructor(data) {
        this.internalId = data.id;
        this.instrumentType = data.instrument_type;
        this.sellProfit = data.sell_profit;
        this.margin = data.margin;
        this.currentPrice = data.current_price;
        this.quoteTimestamp = data.quote_timestamp;
        this.pnl = data.pnl;
        this.pnlNet = data.pnl_net;
        this.openPrice = data.open_price;
        this.expectedProfit = data.expected_profit;
        this.currencyConversion = data.currency_conversion;
    }
}
class PortfolioPositionsV4Position {
    activeId;
    expectedProfit;
    externalId;
    internalId;
    instrumentType;
    invest;
    openQuote;
    openTime;
    pnl;
    quoteTimestamp;
    status;
    userId;
    userBalanceId;
    orderIds;
    expirationTime;
    direction;
    constructor(data) {
        this.activeId = data.active_id;
        this.expectedProfit = data.expected_profit;
        this.externalId = data.external_id;
        this.internalId = data.id;
        this.instrumentType = data.instrument_type;
        this.invest = data.invest;
        this.openQuote = data.open_quote;
        this.openTime = data.open_time;
        this.pnl = data.pnl;
        this.quoteTimestamp = data.quote_timestamp;
        this.status = data.status;
        this.userId = data.user_id;
        this.userBalanceId = data.user_balance_id;
        if (data.raw_event) {
            let order_ids;
            switch (data.instrument_type) {
                case InstrumentType.BinaryOption:
                case InstrumentType.TurboOption:
                case InstrumentType.BlitzOption:
                    order_ids = data.raw_event.binary_options_option_changed1.order_ids;
                    this.direction = data.raw_event.binary_options_option_changed1.direction;
                    if (data.raw_event.binary_options_option_changed1.expiration_time) {
                        this.expirationTime = data.raw_event.binary_options_option_changed1.expiration_time * 1000;
                    }
                    break;
                case InstrumentType.DigitalOption:
                    order_ids = data.raw_event.digital_options_position_changed1.order_ids;
                    this.direction = data.raw_event.digital_options_position_changed1.instrument_dir;
                    if (data.raw_event.digital_options_position_changed1.instrument_expiration) {
                        this.expirationTime = data.raw_event.digital_options_position_changed1.instrument_expiration;
                    }
                    break;
                case InstrumentType.MarginCfd:
                    order_ids = data.raw_event.marginal_cfd_position_changed1.order_ids;
                    break;
                case InstrumentType.MarginForex:
                    order_ids = data.raw_event.marginal_forex_position_changed1.order_ids;
                    break;
                case InstrumentType.MarginCrypto:
                    order_ids = data.raw_event.marginal_crypto_position_changed1.order_ids;
                    break;
            }
            if (order_ids) {
                this.orderIds = order_ids;
            }
            else {
                this.orderIds = [data.external_id];
            }
        }
        else {
            this.orderIds = [data.external_id];
        }
    }
}
class PositionsRawEvent {
    binary_options_option_changed1;
    digital_options_position_changed1;
    marginal_forex_position_changed1;
    marginal_cfd_position_changed1;
    marginal_crypto_position_changed1;
}
class BinaryOptionsRawEventItem {
    order_ids;
    direction;
    expiration_time;
}
class PositionsRawEventItem {
    order_ids;
    instrument_dir;
    instrument_expiration;
}
class PortfolioOrdersV2 {
    orders = [];
    constructor(data) {
        for (const index in data.items) {
            this.orders.push(new PortfolioOrdersV2Order(data.items[index]));
        }
    }
}
class PortfolioOrdersV2Order {
    id;
    instrumentType;
    kind;
    positionId;
    status;
    userId;
    userBalanceId;
    constructor(data) {
        this.instrumentType = data.instrument_type;
        this.kind = data.kind;
        this.positionId = data.position_id;
        this.status = data.status;
        this.userId = data.user_id;
        this.userBalanceId = data.user_balance_id;
        if (data.raw_event) {
            switch (data.instrument_type) {
                case InstrumentType.DigitalOption:
                    this.id = data.raw_event.digital_options_order_changed1.id;
                    break;
                case InstrumentType.MarginCfd:
                    this.id = data.raw_event.marginal_cfd_order_changed1.id;
                    break;
                case InstrumentType.MarginForex:
                    this.id = data.raw_event.marginal_forex_order_changed1.id;
                    break;
                case InstrumentType.MarginCrypto:
                    this.id = data.raw_event.marginal_crypto_order_changed1.id;
                    break;
            }
        }
    }
}
class PortfolioOrderChangedV2 {
    id;
    instrumentType;
    kind;
    positionId;
    status;
    userId;
    userBalanceId;
    constructor(data) {
        this.instrumentType = data.instrument_type;
        this.kind = data.kind;
        this.positionId = data.position_id;
        this.status = data.status;
        this.userId = data.user_id;
        this.userBalanceId = data.user_balance_id;
        if (data.raw_event) {
            switch (data.instrument_type) {
                case InstrumentType.DigitalOption:
                    this.id = data.raw_event.digital_options_order_changed1.id;
                    break;
                case InstrumentType.MarginCfd:
                    this.id = data.raw_event.marginal_cfd_order_changed1.id;
                    break;
                case InstrumentType.MarginForex:
                    this.id = data.raw_event.marginal_forex_order_changed1.id;
                    break;
                case InstrumentType.MarginCrypto:
                    this.id = data.raw_event.marginal_crypto_order_changed1.id;
                    break;
            }
        }
    }
}
class OrdersRawEvent {
    digital_options_order_changed1;
    marginal_forex_order_changed1;
    marginal_cfd_order_changed1;
    marginal_crypto_order_changed1;
}
class OrdersRawEventItem {
    id;
    constructor(data) {
        this.id = data.id;
    }
}
class QuoteGeneratedV2 {
    activeId;
    time;
    ask;
    bid;
    value;
    phase;
    constructor(data) {
        this.activeId = data.active_id;
        this.time = data.time;
        this.ask = data.ask;
        this.bid = data.bid;
        this.value = data.value;
        this.phase = data.phase;
    }
}
class CandleGeneratedV1 {
    id;
    activeId;
    size;
    at;
    from;
    to;
    ask;
    bid;
    open;
    close;
    min;
    max;
    volume;
    phase;
    constructor(data) {
        this.id = data.id;
        this.activeId = data.active_id;
        this.size = data.size;
        this.at = data.at;
        this.from = data.from;
        this.to = data.to;
        this.ask = data.ask;
        this.bid = data.bid;
        this.open = data.open;
        this.close = data.close;
        this.min = data.min;
        this.max = data.max;
        this.volume = data.volume;
        this.phase = data.phase;
    }
}
// Outbound messages
class HttpGetTranslationsRequest {
    lang;
    groups;
    constructor(lang, groups) {
        this.lang = lang;
        this.groups = groups;
    }
    method() {
        return 'GET';
    }
    path() {
        return '/api/lang/route-translations';
    }
    messageBody() {
        return {
            route: this.lang,
            groups: this.groups
        };
    }
    createResponse(status, data) {
        return new HttpGetTranslationsResponse(data);
    }
}
class HttpGetTranslationsResponse {
    isSuccessful;
    data;
    constructor(data) {
        this.isSuccessful = data.isSuccessful;
        this.data = data;
    }
}
class HttpLoginRequest {
    login;
    password;
    constructor(login, password) {
        this.login = login;
        this.password = password;
    }
    method() {
        return 'POST';
    }
    path() {
        return '/v2/login';
    }
    messageBody() {
        return {
            identifier: this.login,
            password: this.password
        };
    }
    createResponse(status, data) {
        return new HttpResponse(status, new HttpLoginResponse(data));
    }
}
class HttpOAuthRequest {
    redirectUri;
    clientId;
    scope;
    codeChallenge;
    codeChallengeMethod;
    state;
    affiliateId;
    afftrack;
    aff_model;
    constructor(redirectUri, clientId, scope, codeChallenge, codeChallengeMethod, state, affiliateId, afftrack, aff_model) {
        this.redirectUri = redirectUri;
        this.clientId = clientId;
        this.scope = scope;
        this.codeChallenge = codeChallenge;
        this.codeChallengeMethod = codeChallengeMethod;
        this.state = state;
        this.affiliateId = affiliateId;
        this.afftrack = afftrack;
        this.aff_model = aff_model;
    }
    path() {
        return '/auth/oauth.v5/authorize';
    }
    queryParams() {
        const params = new URLSearchParams({
            response_type: 'code',
            redirect_uri: this.redirectUri,
            client_id: this.clientId.toString(),
            scope: this.scope,
            code_challenge: this.codeChallenge,
            code_challenge_method: this.codeChallengeMethod,
        });
        if (this.state)
            params.set('state', this.state);
        if (this.affiliateId)
            params.set('aff', String(this.affiliateId));
        if (this.afftrack)
            params.set('afftrack', this.afftrack);
        if (this.aff_model)
            params.set('aff_model', this.aff_model);
        return params;
    }
    buildUrl(baseUrl) {
        return `${baseUrl}${this.path()}?${this.queryParams().toString()}`;
    }
}
class HttpAccessTokenRequest {
    code;
    clientId;
    codeVerifier;
    redirectUri;
    constructor(code, clientId, codeVerifier, redirectUri) {
        this.code = code;
        this.clientId = clientId;
        this.codeVerifier = codeVerifier;
        this.redirectUri = redirectUri;
    }
    method() {
        return 'POST';
    }
    path() {
        return '/auth/oauth.v5/token';
    }
    messageBody() {
        return {
            grant_type: 'authorization_code',
            code: this.code,
            redirect_uri: this.redirectUri,
            client_id: this.clientId,
            code_verifier: this.codeVerifier,
        };
    }
    createResponse(status, data) {
        return new HttpResponse(status, new HttpAccessTokenResponse(data));
    }
}
class HttpAccessTokenResponse {
    accessToken;
    tokenType;
    expiresIn;
    refreshToken;
    scope;
    constructor(data) {
        this.accessToken = data.access_token;
        this.tokenType = data.token_type;
        this.expiresIn = data.expires_in;
        this.scope = data.scope;
        if (data.refresh_token) {
            this.refreshToken = data.refresh_token;
        }
    }
}
class HttpRefreshAccessTokenRequest {
    refreshToken;
    clientId;
    clientSecret;
    constructor(refreshToken, clientId, clientSecret) {
        this.refreshToken = refreshToken;
        this.clientId = clientId;
        this.clientSecret = clientSecret;
    }
    method() {
        return 'POST';
    }
    path() {
        return '/auth/oauth.v5/token';
    }
    messageBody() {
        return {
            grant_type: 'refresh_token',
            refresh_token: this.refreshToken,
            client_id: this.clientId,
            client_secret: this.clientSecret,
        };
    }
    createResponse(status, data) {
        if (status === 400) {
            return new HttpResponse(status, new HttpOAuthErrorResponse(data));
        }
        return new HttpResponse(status, new HttpRefreshAccessTokenResponse(data));
    }
}
class HttpOAuthErrorResponse {
    code;
    message;
    constructor(data) {
        this.code = data.code;
        this.message = data.message;
    }
}
class HttpRefreshAccessTokenResponse {
    accessToken;
    tokenType;
    expiresIn;
    refreshToken;
    scope;
    constructor(data) {
        this.accessToken = data.access_token;
        this.tokenType = data.token_type;
        this.expiresIn = data.expires_in;
        this.refreshToken = data.refresh_token;
        this.scope = data.scope;
    }
}
class Authenticate {
    ssid;
    constructor(ssid) {
        this.ssid = ssid;
    }
    messageName() {
        return 'authenticate';
    }
    messageBody() {
        return {
            ssid: this.ssid,
            protocol: 3,
            session_id: '',
            client_session_id: ''
        };
    }
    resultOnly() {
        return false;
    }
    createResponse(data) {
        return new Authenticated(data);
    }
}
class CallBinaryOptionsOpenBinaryOptionV2 {
    activeId;
    expiredAt;
    direction;
    price;
    userBalanceId;
    profitPercent;
    constructor(activeId, expiredAt, direction, price, userBalanceId, profitPercent) {
        this.activeId = activeId;
        this.expiredAt = expiredAt;
        this.direction = direction;
        this.price = price;
        this.userBalanceId = userBalanceId;
        this.profitPercent = profitPercent;
    }
    messageName() {
        return 'sendMessage';
    }
    messageBody() {
        return {
            name: 'binary-options.open-option',
            version: '2.0',
            body: {
                active_id: this.activeId,
                direction: this.direction,
                expired: this.expiredAt,
                option_type_id: 1,
                price: this.price,
                user_balance_id: this.userBalanceId,
                profit_percent: this.profitPercent
            }
        };
    }
    createResponse(data) {
        return new BinaryOptionsOptionV1(data);
    }
    resultOnly() {
        return false;
    }
}
class CallPortfolioSubscribePositions {
    frequency;
    positionIds;
    constructor(frequency, positionIds) {
        this.frequency = frequency;
        this.positionIds = positionIds;
    }
    messageName() {
        return 'sendMessage';
    }
    messageBody() {
        return {
            name: 'portfolio.subscribe-positions',
            version: '1.0',
            body: {
                frequency: this.frequency,
                ids: this.positionIds
            }
        };
    }
    createResponse(data) {
        return new Result(data);
    }
    resultOnly() {
        return true;
    }
}
class CallPortfolioGetOrdersV2 {
    userBalanceId;
    constructor(userBalanceId) {
        this.userBalanceId = userBalanceId;
    }
    messageName() {
        return 'sendMessage';
    }
    messageBody() {
        return {
            name: 'portfolio.get-orders',
            version: '2.0',
            body: {
                user_balance_id: this.userBalanceId,
                kind: 'deferred'
            }
        };
    }
    createResponse(data) {
        return new PortfolioOrdersV2(data);
    }
    resultOnly() {
        return false;
    }
}
class CallMarginClosePositionV1 {
    marginInstrumentType;
    positionId;
    constructor(marginInstrumentType, positionId) {
        this.marginInstrumentType = marginInstrumentType;
        this.positionId = positionId;
    }
    messageName() {
        return 'sendMessage';
    }
    messageBody() {
        return {
            name: `marginal-${this.marginInstrumentType}.close-position`,
            version: '1.0',
            body: {
                position_id: this.positionId
            }
        };
    }
    createResponse(data) {
        return new Result(data);
    }
    resultOnly() {
        return true;
    }
}
class CallDigitalOptionsClosePositionV1 {
    positionId;
    constructor(positionId) {
        this.positionId = positionId;
    }
    messageName() {
        return 'sendMessage';
    }
    messageBody() {
        return {
            name: 'digital-options.close-position',
            version: '1.0',
            body: {
                position_id: this.positionId
            }
        };
    }
    createResponse(data) {
        return new Result(data);
    }
    resultOnly() {
        return true;
    }
}
class CallBinaryOptionsSellOptionsV3 {
    optionsIds;
    constructor(optionsIds) {
        this.optionsIds = optionsIds;
    }
    messageName() {
        return 'sendMessage';
    }
    messageBody() {
        return {
            name: 'binary-options.sell-options',
            version: '3.0',
            body: {
                options_ids: this.optionsIds
            }
        };
    }
    createResponse(data) {
        return new Result(data);
    }
    resultOnly() {
        return true;
    }
}
class CallBinaryOptionsOpenBlitzOptionV2 {
    activeId;
    direction;
    expirationSize;
    price;
    userBalanceId;
    profitPercent;
    constructor(activeId, direction, expirationSize, price, userBalanceId, profitPercent) {
        this.activeId = activeId;
        this.direction = direction;
        this.expirationSize = expirationSize;
        this.price = price;
        this.userBalanceId = userBalanceId;
        this.profitPercent = profitPercent;
    }
    messageName() {
        return 'sendMessage';
    }
    messageBody() {
        return {
            name: 'binary-options.open-option',
            version: '2.0',
            body: {
                active_id: this.activeId,
                direction: this.direction,
                expiration_size: this.expirationSize,
                expired: 0,
                option_type_id: 12,
                price: this.price,
                user_balance_id: this.userBalanceId,
                profit_percent: this.profitPercent,
            }
        };
    }
    createResponse(data) {
        return new BinaryOptionsOptionV1(data);
    }
    resultOnly() {
        return false;
    }
}
class CallBinaryOptionsOpenTurboOptionV2 {
    activeId;
    expiredAt;
    direction;
    price;
    userBalanceId;
    profitPercent;
    constructor(activeId, expiredAt, direction, price, userBalanceId, profitPercent) {
        this.activeId = activeId;
        this.expiredAt = expiredAt;
        this.direction = direction;
        this.price = price;
        this.userBalanceId = userBalanceId;
        this.profitPercent = profitPercent;
    }
    messageName() {
        return 'sendMessage';
    }
    messageBody() {
        return {
            name: 'binary-options.open-option',
            version: '2.0',
            body: {
                active_id: this.activeId,
                direction: this.direction,
                expired: this.expiredAt,
                option_type_id: 3,
                price: this.price,
                user_balance_id: this.userBalanceId,
                profit_percent: this.profitPercent,
            }
        };
    }
    createResponse(data) {
        return new BinaryOptionsOptionV1(data);
    }
    resultOnly() {
        return false;
    }
}
class CallCoreGetProfileV1 {
    messageName() {
        return 'sendMessage';
    }
    messageBody() {
        return {
            name: 'core.get-profile',
            version: '1.0',
            body: {}
        };
    }
    createResponse(data) {
        return new CoreProfileV1(data);
    }
    resultOnly() {
        return false;
    }
}
class CallInternalBillingResetTrainingBalanceV4 {
    userBalanceId;
    amount;
    constructor(userBalanceId, amount) {
        this.userBalanceId = userBalanceId;
        this.amount = amount;
    }
    messageName() {
        return 'sendMessage';
    }
    messageBody() {
        return {
            name: 'internal-billing.reset-training-balance',
            version: '4.0',
            body: {
                user_balance_id: this.userBalanceId,
                amount: this.amount
            }
        };
    }
    createResponse(data) {
        return new Result(data);
    }
    resultOnly() {
        return true;
    }
}
class CallDigitalOptionInstrumentsGetInstrumentsV3 {
    assetId;
    constructor(assetId) {
        this.assetId = assetId;
    }
    messageName() {
        return 'sendMessage';
    }
    messageBody() {
        return {
            name: 'digital-option-instruments.get-instruments',
            version: '3.0',
            body: {
                asset_id: this.assetId
            }
        };
    }
    createResponse(data) {
        return new DigitalOptionInstrumentsInstrumentsV3(data);
    }
    resultOnly() {
        return false;
    }
}
class CallDigitalOptionInstrumentsGetUnderlyingListV3 {
    filterSuspended;
    constructor(filterSuspended) {
        this.filterSuspended = filterSuspended;
    }
    messageName() {
        return 'sendMessage';
    }
    messageBody() {
        return {
            name: 'digital-option-instruments.get-underlying-list',
            version: '3.0',
            body: {
                filter_suspended: this.filterSuspended
            }
        };
    }
    createResponse(data) {
        return new DigitalOptionInstrumentsUnderlyingListV3(data);
    }
    resultOnly() {
        return false;
    }
}
class CallDigitalOptionsPlaceDigitalOptionV3 {
    assetId;
    instrumentId;
    instrumentIndex;
    amount;
    userBalanceId;
    constructor(assetId, instrumentId, instrumentIndex, amount, userBalanceId) {
        this.assetId = assetId;
        this.instrumentId = instrumentId;
        this.instrumentIndex = instrumentIndex;
        this.amount = amount;
        this.userBalanceId = userBalanceId;
    }
    messageName() {
        return 'sendMessage';
    }
    messageBody() {
        return {
            name: 'digital-options.place-digital-option',
            version: '3.0',
            body: {
                amount: this.amount.toString(),
                asset_id: this.assetId,
                instrument_id: this.instrumentId,
                instrument_index: this.instrumentIndex,
                user_balance_id: this.userBalanceId
            }
        };
    }
    createResponse(data) {
        return new DigitalOptionPlacedV3(data);
    }
    resultOnly() {
        return false;
    }
}
class CallBinaryOptionsGetInitializationDataV3 {
    messageName() {
        return 'sendMessage';
    }
    messageBody() {
        return {
            name: 'binary-options.get-initialization-data',
            version: '3.0',
            body: {}
        };
    }
    createResponse(data) {
        return new InitializationDataV3(data);
    }
    resultOnly() {
        return false;
    }
}
class CallBalancesGetAvailableBalancesV1 {
    typesIds;
    constructor(typesIds) {
        this.typesIds = typesIds;
    }
    messageName() {
        return 'sendMessage';
    }
    messageBody() {
        return {
            name: 'balances.get-available-balances',
            version: '1.0',
            body: {
                types_ids: this.typesIds
            }
        };
    }
    createResponse(data) {
        return new BalancesAvailableBalancesV1(data);
    }
    resultOnly() {
        return false;
    }
}
class CallPortfolioGetPositionsV4 {
    instrumentTypes;
    limit;
    offset;
    constructor(instrumentTypes, limit, offset) {
        this.instrumentTypes = instrumentTypes;
        this.limit = limit;
        this.offset = offset;
    }
    messageName() {
        return 'sendMessage';
    }
    messageBody() {
        return {
            name: 'portfolio.get-positions',
            version: '4.0',
            body: {
                instrument_types: this.instrumentTypes,
                limit: this.limit,
                offset: this.offset
            }
        };
    }
    createResponse(data) {
        return new PortfolioPositionsV4(data);
    }
    resultOnly() {
        return false;
    }
}
class CallPortfolioGetHistoryPositionsV2 {
    instrumentTypes;
    externalId;
    userId;
    end;
    limit;
    offset;
    constructor(data) {
        this.instrumentTypes = data.instrumentTypes;
        this.externalId = data.externalId;
        this.userId = data.userId;
        this.end = data.end;
        this.limit = data.limit;
        this.offset = data.offset;
    }
    messageName() {
        return 'sendMessage';
    }
    messageBody() {
        const body = {
            instrument_types: this.instrumentTypes
        };
        if (this.externalId !== undefined)
            body.external_id = this.externalId;
        if (this.userId !== undefined)
            body.user_id = this.userId;
        if (this.end !== undefined)
            body.end = this.end;
        if (this.limit !== undefined)
            body.limit = this.limit;
        if (this.offset !== undefined)
            body.offset = this.offset;
        return {
            name: 'portfolio.get-history-positions',
            version: '2.0',
            body
        };
    }
    createResponse(data) {
        return new PortfolioPositionsHistoryV2(data);
    }
    resultOnly() {
        return false;
    }
}
class CallQuotesHistoryGetCandlesV2 {
    activeId;
    size;
    from;
    to;
    fromId;
    toId;
    count;
    backoff;
    onlyClosed;
    kind;
    splitNormalization;
    constructor(data) {
        this.activeId = data.activeId;
        this.size = data.size;
        if (data.options) {
            this.from = data.options.from;
            this.to = data.options.to;
            this.fromId = data.options.fromId;
            this.toId = data.options.toId;
            this.count = data.options.count;
            this.backoff = data.options.backoff;
            this.onlyClosed = data.options.onlyClosed;
            this.kind = data.options.kind;
            this.splitNormalization = data.options.splitNormalization;
        }
    }
    messageName() {
        return 'sendMessage';
    }
    messageBody() {
        return {
            name: 'quotes-history.get-candles',
            version: '2.0',
            body: {
                active_id: this.activeId,
                size: this.size,
                from: this.from,
                to: this.to,
                from_id: this.fromId,
                to_id: this.toId,
                count: this.count,
                backoff: this.backoff,
                only_closed: this.onlyClosed,
                kind: this.kind,
                split_normalization: this.splitNormalization,
            }
        };
    }
    createResponse(data) {
        return new QuotesHistoryCandlesV2(data);
    }
    createError(status, data) {
        const error = new Error(`request is failed with status ${status} and message: ${this.formatErrorMessage(data)}`);
        return Object.assign(error, {
            status,
            details: data,
            requestName: 'quotes-history.get-candles',
            requestVersion: '2.0',
            activeId: this.activeId,
            size: this.size,
            options: {
                from: this.from,
                to: this.to,
                fromId: this.fromId,
                toId: this.toId,
                count: this.count,
                backoff: this.backoff,
                onlyClosed: this.onlyClosed,
                kind: this.kind,
                splitNormalization: this.splitNormalization,
            }
        });
    }
    formatErrorMessage(data) {
        if (data && typeof data === 'object' && !Array.isArray(data)) {
            if ('message' in data && data.message !== undefined) {
                return String(data.message);
            }
            const entries = Object.keys(data)
                .sort()
                .map((key) => `${key}: ${this.formatErrorValue(data[key])}`);
            if (entries.length > 0) {
                return entries.join('; ');
            }
        }
        if (typeof data === 'string') {
            return data;
        }
        return this.stringifyErrorValue(data) ?? 'unknown error';
    }
    formatErrorValue(value) {
        return typeof value === 'string'
            ? value
            : this.stringifyErrorValue(value) ?? String(value);
    }
    stringifyErrorValue(value) {
        try {
            return JSON.stringify(value);
        }
        catch {
            return undefined;
        }
    }
    resultOnly() {
        return false;
    }
}
class QuotesHistoryCandlesV2 {
    candles = [];
    constructor(data) {
        for (const index in data.candles) {
            this.candles.push(new Candle(data.candles[index]));
        }
    }
}
class CallQuotesGetFirstCandlesV1 {
    activeId;
    splitNormalization;
    constructor(activeId, splitNormalization) {
        this.activeId = activeId;
        if (splitNormalization === undefined) {
            this.splitNormalization = false; // Default value if not provided
        }
        else {
            this.splitNormalization = splitNormalization;
        }
    }
    messageName() {
        return 'sendMessage';
    }
    messageBody() {
        return {
            name: 'get-first-candles',
            version: '1.0',
            body: {
                active_id: this.activeId,
                split_normalization: this.splitNormalization,
            }
        };
    }
    createResponse(data) {
        return new QuotesFirstCandlesV1(data);
    }
    resultOnly() {
        return false;
    }
}
class QuotesFirstCandlesV1 {
    candlesBySize = {};
    constructor(data) {
        for (const size in data.candles_by_size) {
            const sizeNumber = Number(size);
            this.candlesBySize[sizeNumber] = new Candle(data.candles_by_size[sizeNumber]);
        }
    }
}
class SetOptions {
    sendResults;
    constructor(sendResults) {
        this.sendResults = sendResults;
    }
    messageName() {
        return 'setOptions';
    }
    messageBody() {
        return {
            sendResults: this.sendResults
        };
    }
    resultOnly() {
        return true;
    }
    createResponse(data) {
        return new Result(data);
    }
}
class SubscribePortfolioPositionsStateV1 {
    messageName() {
        return 'subscribeMessage';
    }
    messageBody() {
        return {
            name: `${this.eventMicroserviceName()}.${this.eventName()}`,
            version: '1.0',
        };
    }
    eventMicroserviceName() {
        return 'portfolio';
    }
    eventName() {
        return 'positions-state';
    }
    createEvent(data) {
        return new PortfolioPositionsStateV1(data);
    }
}
class SubscribeDigitalOptionInstrumentsInstrumentGeneratedV3 {
    assetId;
    constructor(assetId) {
        this.assetId = assetId;
    }
    messageName() {
        return 'subscribeMessage';
    }
    messageBody() {
        return {
            name: `${this.eventMicroserviceName()}.${this.eventName()}`,
            version: '3.0',
            params: {
                routingFilters: {
                    asset_id: this.assetId
                }
            }
        };
    }
    eventMicroserviceName() {
        return 'digital-option-instruments';
    }
    eventName() {
        return 'instrument-generated';
    }
    createEvent(data) {
        return new DigitalOptionInstrumentsInstrumentGeneratedV3(data);
    }
}
class SubscribeTradingSettingsDigitalOptionClientPriceGeneratedV1 {
    instrumentType;
    assetId;
    instrumentIndex;
    constructor(instrumentType, assetId, instrumentIndex) {
        this.instrumentType = instrumentType;
        this.assetId = assetId;
        this.instrumentIndex = instrumentIndex;
    }
    messageName() {
        return 'subscribeMessage';
    }
    messageBody() {
        return {
            name: `${this.eventMicroserviceName()}.${this.eventName()}`,
            version: '1.0',
            params: {
                routingFilters: {
                    asset_id: this.assetId,
                    instrument_index: this.instrumentIndex,
                    instrument_type: this.instrumentType
                }
            }
        };
    }
    eventMicroserviceName() {
        return 'trading-settings';
    }
    eventName() {
        return 'digital-option-client-price-generated';
    }
    createEvent(data) {
        return new DigitalOptionClientPriceGeneratedV1(data);
    }
}
class SubscribeDigitalOptionInstrumentsUnderlyingListChangedV3 {
    messageName() {
        return 'subscribeMessage';
    }
    messageBody() {
        return {
            name: `${this.eventMicroserviceName()}.${this.eventName()}`,
            version: '3.0'
        };
    }
    eventMicroserviceName() {
        return 'digital-option-instruments';
    }
    eventName() {
        return 'underlying-list-changed';
    }
    createEvent(data) {
        return new DigitalOptionInstrumentsUnderlyingListChangedV3(data);
    }
}
class SubscribeMessage {
    body;
    constructor(body) {
        this.body = body;
    }
    messageName() {
        return 'subscribeMessage';
    }
    messageBody() {
        return this.body;
    }
    resultOnly() {
        return true;
    }
    createResponse(data) {
        return new Result(data);
    }
}
class UnsubscribeMessage {
    body;
    constructor(body) {
        this.body = body;
    }
    messageName() {
        return 'unsubscribeMessage';
    }
    messageBody() {
        return this.body;
    }
    resultOnly() {
        return true;
    }
    createResponse(data) {
        return new Result(data);
    }
}
class SubscribeBalancesBalanceChangedV1 {
    messageName() {
        return 'subscribeMessage';
    }
    messageBody() {
        return {
            name: `${this.eventMicroserviceName()}.${this.eventName()}`,
            version: '1.0'
        };
    }
    eventMicroserviceName() {
        return 'balances';
    }
    eventName() {
        return 'balance-changed';
    }
    createEvent(data) {
        return new BalancesBalanceChangedV1(data);
    }
}
class SubscribePortfolioPositionChangedV3 {
    userId;
    constructor(userId) {
        this.userId = userId;
    }
    messageName() {
        return 'subscribeMessage';
    }
    messageBody() {
        return {
            name: `${this.eventMicroserviceName()}.${this.eventName()}`,
            version: '3.0',
            params: {
                routingFilters: {
                    user_id: this.userId,
                }
            }
        };
    }
    eventMicroserviceName() {
        return 'portfolio';
    }
    eventName() {
        return 'position-changed';
    }
    createEvent(data) {
        return new PortfolioPositionChangedV3(data);
    }
}
class SubscribePortfolioOrderChangedV2 {
    userId;
    instrumentType;
    constructor(userId, instrumentType) {
        this.userId = userId;
        this.instrumentType = instrumentType;
    }
    messageName() {
        return 'subscribeMessage';
    }
    messageBody() {
        return {
            name: `${this.eventMicroserviceName()}.${this.eventName()}`,
            version: '2.0',
            params: {
                routingFilters: {
                    user_id: this.userId,
                    instrument_type: this.instrumentType
                }
            }
        };
    }
    eventMicroserviceName() {
        return 'portfolio';
    }
    eventName() {
        return 'order-changed';
    }
    createEvent(data) {
        return new PortfolioOrderChangedV2(data);
    }
}
class SubscribeQuoteGeneratedV2 {
    activeId;
    constructor(activeId) {
        this.activeId = activeId;
    }
    messageName() {
        return 'subscribeMessage';
    }
    messageBody() {
        return {
            name: `${this.eventName()}`,
            version: '2.0',
            params: {
                routingFilters: {
                    active_id: this.activeId
                }
            }
        };
    }
    eventMicroserviceName() {
        return 'quotes-ws';
    }
    eventName() {
        return 'quote-generated';
    }
    createEvent(data) {
        return new QuoteGeneratedV2(data);
    }
}
class SubscribeCandleGeneratedV1 {
    activeId;
    size;
    constructor(activeId, size) {
        this.activeId = activeId;
        this.size = size;
    }
    messageName() {
        return 'subscribeMessage';
    }
    messageBody() {
        return {
            name: `${this.eventName()}`,
            version: '1.0',
            params: {
                routingFilters: {
                    active_id: this.activeId,
                    size: this.size,
                }
            }
        };
    }
    eventMicroserviceName() {
        return 'quotes';
    }
    eventName() {
        return 'candle-generated';
    }
    createEvent(data) {
        return new CandleGeneratedV1(data);
    }
}
class CallMarginCancelPendingOrderV1 {
    marginInstrumentType;
    orderId;
    constructor(marginInstrumentType, orderId) {
        this.marginInstrumentType = marginInstrumentType;
        this.orderId = orderId;
    }
    messageName() {
        return 'sendMessage';
    }
    messageBody() {
        return {
            name: `marginal-${this.marginInstrumentType}.cancel-pending-order`,
            version: '1.0',
            body: {
                order_id: this.orderId
            }
        };
    }
    createResponse(data) {
        return new Result(data);
    }
    resultOnly() {
        return true;
    }
}
class CallMarginPlaceStopOrderV1 {
    side;
    userBalanceId;
    count;
    stopPrice;
    instrumentId;
    instrumentActiveId;
    leverage;
    instrumentType;
    stopLoss;
    takeProfit;
    constructor(side, userBalanceId, count, stopPrice, instrumentId, instrumentActiveId, leverage, instrumentType, stopLoss, takeProfit) {
        this.side = side;
        this.userBalanceId = userBalanceId;
        this.count = count;
        this.stopPrice = stopPrice;
        this.instrumentId = instrumentId;
        this.instrumentActiveId = instrumentActiveId;
        this.leverage = leverage;
        this.instrumentType = instrumentType;
        if (stopLoss) {
            this.stopLoss = {
                value: stopLoss.value.toString(),
                type: stopLoss.type,
            };
        }
        if (takeProfit) {
            this.takeProfit = {
                value: takeProfit.value.toString(),
                type: takeProfit.type,
            };
        }
    }
    messageName() {
        return 'sendMessage';
    }
    messageBody() {
        return {
            name: `marginal-${this.instrumentType}.place-stop-order`,
            version: '1.0',
            body: {
                side: this.side,
                user_balance_id: this.userBalanceId,
                count: this.count,
                stop_price: this.stopPrice,
                instrument_id: this.instrumentId,
                instrument_active_id: this.instrumentActiveId,
                leverage: this.leverage,
                stop_loss: this.stopLoss,
                take_profit: this.takeProfit
            }
        };
    }
    createResponse(data) {
        return new MarginOrderPlacedV1(data);
    }
    resultOnly() {
        return false;
    }
}
class CallMarginPlaceLimitOrderV1 {
    side;
    userBalanceId;
    count;
    limitPrice;
    instrumentId;
    instrumentActiveId;
    leverage;
    instrumentType;
    stopLoss;
    takeProfit;
    constructor(side, userBalanceId, count, limitPrice, instrumentId, instrumentActiveId, leverage, instrumentType, stopLoss, takeProfit) {
        this.side = side;
        this.userBalanceId = userBalanceId;
        this.count = count;
        this.limitPrice = limitPrice;
        this.instrumentId = instrumentId;
        this.instrumentActiveId = instrumentActiveId;
        this.leverage = leverage;
        this.instrumentType = instrumentType;
        if (stopLoss) {
            this.stopLoss = {
                value: stopLoss.value.toString(),
                type: stopLoss.type,
            };
        }
        if (takeProfit) {
            this.takeProfit = {
                value: takeProfit.value.toString(),
                type: takeProfit.type,
            };
        }
    }
    messageName() {
        return 'sendMessage';
    }
    messageBody() {
        return {
            name: `marginal-${this.instrumentType}.place-limit-order`,
            version: '1.0',
            body: {
                side: this.side,
                user_balance_id: this.userBalanceId,
                count: this.count,
                limit_price: this.limitPrice,
                instrument_id: this.instrumentId,
                instrument_active_id: this.instrumentActiveId,
                leverage: this.leverage,
                stop_loss: this.stopLoss,
                take_profit: this.takeProfit
            }
        };
    }
    createResponse(data) {
        return new MarginOrderPlacedV1(data);
    }
    resultOnly() {
        return false;
    }
}
class CallMarginPlaceMarketOrderV1 {
    side;
    userBalanceId;
    count;
    instrumentId;
    instrumentActiveId;
    leverage;
    instrumentType;
    stopLoss;
    takeProfit;
    constructor(side, userBalanceId, count, instrumentId, instrumentActiveId, leverage, instrumentType, stopLoss, takeProfit) {
        this.side = side;
        this.userBalanceId = userBalanceId;
        this.count = count;
        this.instrumentId = instrumentId;
        this.instrumentActiveId = instrumentActiveId;
        this.leverage = leverage;
        this.instrumentType = instrumentType;
        if (stopLoss) {
            this.stopLoss = {
                value: stopLoss.value.toString(),
                type: stopLoss.type,
            };
        }
        if (takeProfit) {
            this.takeProfit = {
                value: takeProfit.value.toString(),
                type: takeProfit.type,
            };
        }
    }
    messageName() {
        return 'sendMessage';
    }
    messageBody() {
        return {
            name: `marginal-${this.instrumentType}.place-market-order`,
            version: '1.0',
            body: {
                side: this.side,
                user_balance_id: this.userBalanceId,
                count: this.count,
                instrument_id: this.instrumentId,
                instrument_active_id: this.instrumentActiveId,
                leverage: this.leverage,
                stop_loss: this.stopLoss,
                take_profit: this.takeProfit
            }
        };
    }
    createResponse(data) {
        return new MarginOrderPlacedV1(data);
    }
    resultOnly() {
        return false;
    }
}
class CallMarginInstrumentsGetUnderlyingListV1 {
    marginInstrumentType;
    constructor(marginInstrumentType) {
        this.marginInstrumentType = marginInstrumentType;
    }
    messageName() {
        return 'sendMessage';
    }
    messageBody() {
        return {
            name: `marginal-${this.marginInstrumentType}-instruments.get-underlying-list`,
            version: '1.0',
            body: {}
        };
    }
    createResponse(data) {
        return new MarginInstrumentsUnderlyingListV1(data);
    }
    resultOnly() {
        return false;
    }
}
class SubscribeMarginInstrumentsUnderlyingListChangedV1 {
    marginInstrumentType;
    constructor(marginInstrumentType) {
        this.marginInstrumentType = marginInstrumentType;
    }
    messageName() {
        return 'subscribeMessage';
    }
    messageBody() {
        return {
            name: `${this.eventMicroserviceName()}.${this.eventName()}`,
            version: '1.0'
        };
    }
    eventMicroserviceName() {
        return `marginal-${this.marginInstrumentType}-instruments`;
    }
    eventName() {
        return 'underlying-list-changed';
    }
    createEvent(data) {
        return new MarginInstrumentsUnderlyingListChangedV1(data);
    }
}
class CallMarginInstrumentsGetInstrumentsListV1 {
    activeId;
    marginInstrumentType;
    constructor(activeId, marginInstrumentType) {
        this.activeId = activeId;
        this.marginInstrumentType = marginInstrumentType;
    }
    messageName() {
        return 'sendMessage';
    }
    messageBody() {
        return {
            name: `marginal-${this.marginInstrumentType}-instruments.get-instruments-list`,
            version: '1.0',
            body: {
                active_id: this.activeId
            }
        };
    }
    createResponse(data) {
        return new MarginInstrumentsInstrumentsListV1(data);
    }
    resultOnly() {
        return false;
    }
}
class CallMarginGetMarginBalanceV1 {
    userBalanceId;
    constructor(userBalanceId) {
        this.userBalanceId = userBalanceId;
    }
    messageName() {
        return 'sendMessage';
    }
    messageBody() {
        return {
            name: 'marginal-portfolio.get-marginal-balance',
            version: '1.0',
            body: {
                user_balance_id: this.userBalanceId
            }
        };
    }
    createResponse(data) {
        return new MarginPortfolioBalanceV1(data);
    }
    resultOnly() {
        return false;
    }
}
class CallSubscribeMarginPortfolioBalanceChangedV1 {
    userBalanceId;
    constructor(userBalanceId) {
        this.userBalanceId = userBalanceId;
    }
    messageName() {
        return 'sendMessage';
    }
    messageBody() {
        return {
            name: 'marginal-portfolio.subscribe-balance-changed',
            version: '1.0',
            body: {
                user_balance_id: this.userBalanceId
            }
        };
    }
    createResponse(data) {
        return new Result(data);
    }
    resultOnly() {
        return true;
    }
}
class SubscribeMarginPortfolioBalanceChangedV1 {
    messageName() {
        return 'subscribeMessage';
    }
    messageBody() {
        return {
            name: `${this.eventMicroserviceName()}.${this.eventName()}`,
            version: '1.0'
        };
    }
    eventMicroserviceName() {
        return 'marginal-portfolio';
    }
    eventName() {
        return 'balance-changed';
    }
    createEvent(data) {
        return new MarginPortfolioBalanceV1(data);
    }
}
class CallGetCurrencyV5 {
    currencyCode;
    constructor(currencyCode) {
        this.currencyCode = currencyCode;
    }
    messageName() {
        return 'sendMessage';
    }
    messageBody() {
        return {
            name: 'get-currency',
            version: '5.0',
            body: {
                name: this.currencyCode
            }
        };
    }
    createResponse(data) {
        return new CurrencyV5(data);
    }
    resultOnly() {
        return false;
    }
}
class CurrencyV5 {
    id;
    name;
    description;
    symbol;
    isVisible;
    mask;
    isTradable;
    code;
    unit;
    rate;
    rateUsd;
    minDealAmount;
    maxDealAmount;
    minorUnits;
    image;
    isCrypto;
    isInout;
    interestRate;
    constructor(data) {
        this.id = data.id;
        this.name = data.name;
        this.description = data.description;
        this.symbol = data.symbol;
        this.isVisible = data.is_visible;
        this.mask = data.mask;
        this.isTradable = data.is_tradable;
        this.code = data.code;
        this.unit = data.unit;
        this.rate = data.rate;
        this.rateUsd = data.rate_usd;
        this.minDealAmount = data.min_deal_amount;
        this.maxDealAmount = data.max_deal_amount;
        this.minorUnits = data.minor_units;
        this.image = data.image;
        this.isCrypto = data.is_crypto;
        this.isInout = data.is_inout;
        this.interestRate = data.interest_rate;
    }
}
class CallGetActiveV5 {
    activeId;
    constructor(activeId) {
        this.activeId = activeId;
    }
    messageName() {
        return 'sendMessage';
    }
    messageBody() {
        return {
            name: 'get-active',
            version: '5.0',
            body: {
                id: this.activeId
            }
        };
    }
    createResponse(data) {
        return new ActiveV5(data);
    }
    resultOnly() {
        return false;
    }
}
class ActiveV5 {
    id;
    name;
    description;
    image;
    isOtc;
    timeFrom;
    timeTo;
    precision;
    pipScale;
    spreadPlus;
    spreadMinus;
    expirationDays;
    currencyLeftSide;
    currencyRightSide;
    type;
    minQty;
    qtyStep;
    typeQty;
    constructor(data) {
        this.id = data.id;
        this.name = data.name;
        this.description = data.description;
        this.image = data.image;
        this.isOtc = data.is_otc;
        this.timeFrom = data.time_from;
        this.timeTo = data.time_to;
        this.precision = data.precision;
        this.pipScale = data.pip_scale;
        this.spreadPlus = data.spread_plus;
        this.spreadMinus = data.spread_minus;
        this.expirationDays = data.expiration_days;
        this.currencyLeftSide = data.currency_left_side;
        this.currencyRightSide = data.currency_right_side;
        this.type = data.type;
        this.minQty = data.min_qty;
        this.qtyStep = data.qty_step;
        this.typeQty = data.type_qty;
    }
}
class CallGetFeaturesV2 {
    messageName() {
        return 'sendMessage';
    }
    messageBody() {
        return {
            name: 'features.get-features',
            version: '2.0',
            body: {
                category: 'client-sdk-js',
            }
        };
    }
    createResponse(data) {
        return new FeaturesV2(data);
    }
    resultOnly() {
        return false;
    }
}
class FeaturesV2 {
    features = [];
    constructor(data) {
        for (const index in data.features) {
            this.features.push(new FeaturesV2Item(data.features[index]));
        }
    }
}
class FeaturesV2Item {
    id;
    name;
    category;
    version;
    status;
    params;
    constructor(msg) {
        this.id = msg.id;
        this.name = msg.name;
        this.category = msg.category;
        this.version = msg.version;
        this.status = msg.status;
        this.params = msg.params;
    }
}
class MarginPortfolioBalanceV1 {
    id;
    type;
    cash;
    bonus;
    currency;
    userId;
    pnl;
    pnlNet;
    equity;
    equityUsd;
    swap;
    dividends;
    margin;
    available;
    marginLevel;
    stopOutLevel;
    constructor(data) {
        this.id = data.id;
        this.type = data.type;
        this.cash = parseFloat(data.cash);
        this.bonus = parseFloat(data.bonus);
        this.currency = data.currency;
        this.userId = data.user_id;
        this.pnl = parseFloat(data.pnl);
        this.pnlNet = parseFloat(data.pnl_net);
        this.equity = parseFloat(data.equity);
        this.equityUsd = parseFloat(data.equity_usd);
        this.swap = parseFloat(data.swap);
        this.dividends = parseFloat(data.dividends);
        this.margin = parseFloat(data.margin);
        this.available = parseFloat(data.available);
        this.marginLevel = parseFloat(data.margin_level);
        this.stopOutLevel = parseFloat(data.stop_out_level);
    }
}
class MarginInstrumentsUnderlyingListV1 {
    items = [];
    constructor(data) {
        for (const index in data.items) {
            const underlying = data.items[index];
            this.items.push(new MarginInstrumentsUnderlyingListV1Item(underlying.active_id, underlying.is_suspended, underlying.name, underlying.schedule));
        }
    }
}
class MarginInstrumentsUnderlyingListChangedV1 {
    type;
    items = [];
    constructor(data) {
        this.type = data.type;
        for (const index in data.items) {
            const underlying = data.items[index];
            this.items.push(new MarginInstrumentsUnderlyingListV1Item(underlying.active_id, underlying.is_suspended, underlying.name, underlying.schedule));
        }
    }
}
class MarginInstrumentsUnderlyingListV1Item {
    activeId;
    isSuspended;
    name;
    schedule;
    constructor(activeId, isSuspended, name, schedule) {
        this.activeId = activeId;
        this.isSuspended = isSuspended;
        this.name = name;
        this.schedule = schedule;
    }
}
class MarginInstrumentsInstrumentsListV1 {
    items = [];
    constructor(data) {
        const dynamicLeverageProfiles = new Map();
        if (data.dynamic_leverage_profiles) {
            for (const index in data.dynamic_leverage_profiles) {
                const dynamicLeverageProfile = data.dynamic_leverage_profiles[index];
                dynamicLeverageProfiles.set(dynamicLeverageProfile.id, dynamicLeverageProfile.items);
            }
        }
        for (const index in data.items) {
            const instrument = data.items[index];
            if (dynamicLeverageProfiles.has(instrument.leverage_profile)) {
                this.items.push(new MarginInstrumentsInstrumentsListV1Item(instrument, dynamicLeverageProfiles.get(instrument.leverage_profile)));
            }
            else {
                this.items.push(new MarginInstrumentsInstrumentsListV1Item(instrument));
            }
        }
    }
}
class MarginInstrumentsInstrumentsListV1DynamicLeverageProfile {
    equity;
    leverage;
    constructor(data) {
        this.equity = data.equity;
        this.leverage = data.leverage;
    }
}
class MarginInstrumentsInstrumentsListV1Item {
    id;
    activeId;
    allowLongPosition;
    allowShortPosition;
    defaultLeverage;
    leverageProfile;
    dynamicLeverageProfile = [];
    isSuspended;
    minQty;
    qtyStep;
    tradable;
    constructor(msg, dynamicLeverageProfile = []) {
        this.id = msg.id;
        this.activeId = msg.active_id;
        this.allowLongPosition = msg.allow_long_position;
        this.allowShortPosition = msg.allow_short_position;
        this.defaultLeverage = msg.default_leverage;
        this.leverageProfile = msg.leverage_profile;
        this.dynamicLeverageProfile = dynamicLeverageProfile;
        this.isSuspended = msg.is_suspended;
        this.minQty = msg.min_qty;
        this.qtyStep = msg.qty_step;
        this.tradable = new MarginInstrumentsInstrumentsListV1Tradable(msg.tradable.from, msg.tradable.to);
    }
}
class MarginInstrumentsInstrumentsListV1Tradable {
    from;
    to;
    constructor(from, to) {
        this.from = from;
        this.to = to;
    }
}
class ChatRoomResponse {
    rooms = [];
    constructor(data) {
        if (data.isSuccessful && data.data && Array.isArray(data.data)) {
            for (const item of data.data) {
                this.rooms.push(new ChatRoom(item));
            }
        }
    }
}
class CallRequestChatRoom {
    messageName() {
        return 'sendMessage';
    }
    messageBody() {
        return {
            name: 'request-chat-room',
            version: '1.0'
        };
    }
    createResponse(data) {
        return new ChatRoomResponse(data);
    }
    resultOnly() {
        return false;
    }
}
class SubscribeChatMessagePublicGenerated {
    roomId;
    constructor(roomId) {
        this.roomId = roomId;
    }
    messageName() {
        return 'subscribeMessage';
    }
    messageBody() {
        return {
            name: 'chat-message-public-generated',
            version: '1.0',
            params: {
                routingFilters: {
                    room_id: this.roomId
                }
            }
        };
    }
    eventMicroserviceName() {
        return 'chat';
    }
    eventName() {
        return 'chat-message-public-generated';
    }
    createEvent(data) {
        return new ChatMessageEvent(data);
    }
}
