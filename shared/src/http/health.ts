import { RequestHandler } from "express";

export interface HealthCheckOptions {
    service: string;
    // Resolves if the dependency is reachable; rejects otherwise
    checkDatabase: () => Promise<unknown>;
    timeoutMs?: number;
}

// GET /health handler: 200 when the database answers in time, 503 otherwise (never hangs)
export function createHealthHandler({ service, checkDatabase, timeoutMs = 2000 }: HealthCheckOptions): RequestHandler {
    return async (_req, res) => {
        const database = await withTimeout(checkDatabase(), timeoutMs).then(() => true, () => false);
        res.status(database ? 200 : 503).json({
            success: database,
            data: { service, status: database ? "ok" : "degraded", database },
        });
    };
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
    });
    try {
        return await Promise.race([promise, timeout]);
    } finally {
        clearTimeout(timer);
    }
}
