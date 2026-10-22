export class AppError extends Error {
    constructor(
        public readonly statusCode: number,
        message: string,
        public readonly errors?: Record<string, string[]>,
        // Extra response headers, e.g. Retry-After on 429
        public readonly headers?: Record<string, string>,
    ) {
        super(message);
        this.name = "AppError";
    }
}
