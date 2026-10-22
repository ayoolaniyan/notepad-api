import { RequestHandler } from "express";
import { config } from "./config";

type UpstreamStatus = "ok" | "down";

async function checkUpstream(baseUrl: string, timeoutMs: number): Promise<UpstreamStatus> {
    try {
        const res = await fetch(new URL("/health", baseUrl), { signal: AbortSignal.timeout(timeoutMs) });
        return res.ok ? "ok" : "down";
    } catch {
        return "down";
    }
}

// 200 only when every upstream service reports healthy; 503 otherwise
export function createGatewayHealthHandler(timeoutMs = 2000): RequestHandler {
    return async (_req, res) => {
        const names = Object.keys(config.upstreams) as (keyof typeof config.upstreams)[];
        const results = await Promise.all(names.map((name) => checkUpstream(config.upstreams[name], timeoutMs)));
        const upstreams = Object.fromEntries(names.map((name, i) => [name, results[i]]));
        const healthy = results.every((status) => status === "ok");

        res.status(healthy ? 200 : 503).json({
            success: healthy,
            data: { service: "api-gateway", status: healthy ? "ok" : "degraded", upstreams },
        });
    };
}
