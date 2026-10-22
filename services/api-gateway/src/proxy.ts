import { ServerResponse } from "node:http";
import { createProxyMiddleware } from "http-proxy-middleware";
import { fail } from "@notepad/shared";
import { config } from "./config";
import { logger } from "./middleware/logger";

interface ServiceProxyOptions {
    name: string;
    target: string;
    // Path prefix on the upstream service, e.g. /auth for auth-service
    upstreamPrefix: string;
    // Extra headers to set on every response from this service
    responseHeaders?: Record<string, string>;
}

// Proxies a mounted path to a service. Bodies are streamed, not parsed.
// Mount with app.use("/api/v1/auth", ...): Express strips the mount path, so
// /api/v1/auth/login reaches the service as /auth/login.
export function createServiceProxy({ name, target, upstreamPrefix, responseHeaders = {} }: ServiceProxyOptions) {
    return createProxyMiddleware({
        target,
        changeOrigin: true,
        xfwd: true,
        pathRewrite: (path) => upstreamPrefix + (path === "/" ? "" : path),
        on: {
            proxyReq: (proxyReq) => {
                // The proxy's own proxyTimeout aborts without a distinguishable error,
                // so time out here with ETIMEDOUT to tell a slow service from a dead one
                proxyReq.setTimeout(config.upstreamTimeoutMs, () => {
                    proxyReq.destroy(Object.assign(new Error(`${name} timed out`), { code: "ETIMEDOUT" }));
                });
            },
            proxyRes: (proxyRes) => {
                delete proxyRes.headers["x-powered-by"];
                Object.assign(proxyRes.headers, responseHeaders);
            },
            error: (err, req, res) => {
                const code = (err as NodeJS.ErrnoException).code;
                logger.error({ err: { message: err.message, code }, upstream: name, reqId: req.headers["x-request-id"] }, "upstream error");

                if (!(res instanceof ServerResponse)) {
                    res.destroy();
                    return;
                }
                if (res.headersSent) {
                    // Part of the response is already on its way; all we can do is cut it off
                    res.destroy();
                    return;
                }
                const timedOut = code === "ETIMEDOUT";
                res.statusCode = timedOut ? 504 : 502;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify(fail(timedOut ? "Service timed out" : "Service unavailable")));
            },
        },
    });
}
