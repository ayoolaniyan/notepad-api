import pino from "pino";
import { pinoHttp } from "pino-http";
import { config } from "../config";

export const logger = pino({
    level: config.nodeEnv === "test" ? "silent" : "info",
    base: { service: "api-gateway" },
    // Never log credentials, even if a serializer change starts including headers
    redact: ["req.headers.authorization", "req.headers.cookie", "res.headers['set-cookie']"],
});

// One JSON line per request; bodies and auth headers are never logged
export const accessLog = pinoHttp({
    logger,
    genReqId: (req) => req.headers["x-request-id"] as string,
    serializers: {
        // Path only: query strings can carry user content such as note search terms
        req: (req) => ({ id: req.id, method: req.method, path: req.url?.split("?")[0], remoteAddress: req.remoteAddress }),
        res: (res) => ({ statusCode: res.statusCode }),
    },
    customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info"),
});
