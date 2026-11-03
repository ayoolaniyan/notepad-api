export type FetchFn = typeof fetch;

export type ApiErrorKind = "http" | "timeout" | "network";

// A failed call to the gateway. `status` is 0 when no HTTP response arrived.
export class ApiError extends Error {
    constructor(
        public readonly kind: ApiErrorKind,
        public readonly status: number,
        message: string,
        public readonly fieldErrors?: Record<string, string[]>,
        public readonly retryAfterSeconds?: number,
    ) {
        super(message);
        this.name = "ApiError";
    }
}

interface Envelope<T> {
    success: boolean;
    data?: T;
    message?: string;
    error?: string;
    errors?: Record<string, string[]>;
}

export interface RequestOptions {
    token?: string;
    body?: unknown;
    query?: Record<string, string | number | boolean | undefined>;
}

// Matches the gateway's own upstream timeout, so a hung service surfaces as the gateway's 504
// rather than racing it
export const REQUEST_TIMEOUT_MS = 10_000;

// Thin JSON client for the gateway's /api/v1 routes. It unwraps the { success, data } envelope
// and turns every failure into an ApiError. It never retries: retries are the caller's decision.
export class ApiClient {
    constructor(
        public readonly baseUrl: string,
        private readonly fetchFn: FetchFn = fetch,
        private readonly timeoutMs = REQUEST_TIMEOUT_MS,
    ) {}

    async request<T>(method: string, path: string, { token, body, query }: RequestOptions = {}): Promise<T> {
        const url = new URL(`${this.baseUrl}/api/v1${path}`);
        for (const [key, value] of Object.entries(query ?? {})) {
            if (value !== undefined) url.searchParams.set(key, String(value));
        }
        const headers: Record<string, string> = { Accept: "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;
        if (body !== undefined) headers["Content-Type"] = "application/json";

        let res: Response;
        try {
            res = await this.fetchFn(url, {
                method,
                headers,
                body: body === undefined ? undefined : JSON.stringify(body),
                signal: AbortSignal.timeout(this.timeoutMs),
            });
        } catch (err) {
            throw networkError(err, this.baseUrl, this.timeoutMs);
        }

        const envelope = (await res.json().catch(() => undefined)) as Envelope<T> | undefined;
        if (res.ok && envelope?.success) return envelope.data as T;

        throw new ApiError(
            "http",
            res.status,
            envelope?.error ?? `HTTP ${res.status}`,
            envelope?.errors,
            retryAfterSeconds(res.headers),
        );
    }
}

function networkError(err: unknown, baseUrl: string, timeoutMs: number): ApiError {
    const name = (err as Error)?.name;
    if (name === "TimeoutError" || name === "AbortError") {
        return new ApiError("timeout", 0, `No response from notepad-api within ${timeoutMs / 1000} seconds`);
    }
    // Node's fetch wraps the socket error (ECONNREFUSED, ENOTFOUND, ...) in `cause`
    const code = (err as { cause?: { code?: string } })?.cause?.code;
    return new ApiError("network", 0, `Could not reach notepad-api at ${baseUrl}${code ? ` (${code})` : ""}`);
}

// Retry-After is seconds on this API; RateLimit-Reset (draft-6 headers) is the fallback
function retryAfterSeconds(headers: Headers): number | undefined {
    for (const name of ["retry-after", "ratelimit-reset"]) {
        const seconds = Number(headers.get(name));
        if (headers.has(name) && Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
    }
    return undefined;
}
