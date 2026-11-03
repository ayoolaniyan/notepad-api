import { ApiClient, ApiError } from "./http";

interface TokenResponse {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
}

interface Session {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
}

export class AuthError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "AuthError";
    }
}

export interface AuthManagerOptions {
    now?: () => number;
    // Refresh this long before the access token expires, so calls don't start with a dead token
    refreshMarginMs?: number;
}

// Holds one account's tokens in memory and hands a valid access token to each call.
//
// auth-service rotates the refresh token on every use and treats a second use of the same token
// as theft (it then revokes every session of the user). So at most one login or refresh runs at
// a time, every caller waits for it, and a refresh token is only ever sent once.
export class AuthManager {
    private session: Session | null = null;
    private pending: Promise<Session> | null = null;
    // Set when the configured password is rejected: retrying would only count towards the
    // account's login lockout, so stop until the server is restarted with new credentials
    private credentialsRejected = false;
    private readonly now: () => number;
    private readonly refreshMarginMs: number;

    constructor(
        private readonly api: ApiClient,
        private readonly credentials: { email: string; password: string },
        { now = Date.now, refreshMarginMs = 30_000 }: AuthManagerOptions = {},
    ) {
        this.now = now;
        this.refreshMarginMs = refreshMarginMs;
    }

    // Runs fn with an access token. On a 401 it renews the session once and retries once.
    async call<T>(fn: (accessToken: string) => Promise<T>): Promise<T> {
        const session = await this.currentSession();
        try {
            return await fn(session.accessToken);
        } catch (err) {
            if (!(err instanceof ApiError && err.status === 401)) throw err;
        }
        const renewed = await this.renew(session);
        try {
            return await fn(renewed.accessToken);
        } catch (err) {
            if (err instanceof ApiError && err.status === 401) {
                throw new AuthError("notepad-api rejected a freshly issued access token. Try again shortly.");
            }
            throw err;
        }
    }

    // Revokes the refresh token, so it doesn't stay usable after the server exits. Best effort.
    async logout(): Promise<void> {
        const session = this.session;
        this.session = null;
        if (!session) return;
        await this.api
            .request("POST", "/auth/logout", { body: { refreshToken: session.refreshToken } })
            .catch(() => undefined);
    }

    private currentSession(): Promise<Session> {
        if (this.pending) return this.pending;
        if (!this.session) return this.exclusive(() => this.login());
        if (this.now() >= this.session.expiresAt - this.refreshMarginMs) return this.renew(this.session);
        return Promise.resolve(this.session);
    }

    // Replaces `stale` with a new session, unless another call has already done so
    private renew(stale: Session): Promise<Session> {
        if (this.pending) return this.pending;
        if (this.session && this.session !== stale) return Promise.resolve(this.session);
        return this.exclusive(() => this.refreshOrLogin(stale));
    }

    private exclusive(op: () => Promise<Session>): Promise<Session> {
        this.pending = op()
            .then((session) => (this.session = session))
            .finally(() => (this.pending = null));
        return this.pending;
    }

    private async refreshOrLogin(stale: Session): Promise<Session> {
        // Never offer this token again, whatever the outcome
        this.session = null;
        try {
            const tokens = await this.api.request<TokenResponse>("POST", "/auth/refresh", {
                body: { refreshToken: stale.refreshToken },
            });
            return this.toSession(tokens);
        } catch (err) {
            // Revoked or expired refresh token: fall back to one fresh login. Anything else
            // (rate limit, network) is passed on rather than spending a login on it.
            if (err instanceof ApiError && err.status === 401) return this.login();
            throw err;
        }
    }

    private async login(): Promise<Session> {
        if (this.credentialsRejected) {
            throw new AuthError(
                "notepad-api rejected NOTEPAD_EMAIL/NOTEPAD_PASSWORD earlier. Fix the credentials and restart the MCP server.",
            );
        }
        try {
            const tokens = await this.api.request<TokenResponse>("POST", "/auth/login", { body: this.credentials });
            return this.toSession(tokens);
        } catch (err) {
            if (err instanceof ApiError && err.status === 401) {
                this.credentialsRejected = true;
                throw new AuthError(
                    "Login failed: notepad-api rejected NOTEPAD_EMAIL/NOTEPAD_PASSWORD. Fix the credentials and restart the MCP server.",
                );
            }
            throw err;
        }
    }

    private toSession({ accessToken, refreshToken, expiresIn }: TokenResponse): Session {
        return { accessToken, refreshToken, expiresAt: this.now() + expiresIn * 1000 };
    }
}
