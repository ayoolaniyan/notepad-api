import "dotenv/config";
import Joi from "joi";

interface RateLimit {
    max: number;
    windowMs: number;
}

interface Config {
    nodeEnv: "development" | "test" | "production";
    port: number;
    host?: string;
    upstreams: {
        auth: string;
        notes: string;
    };
    upstreamTimeoutMs: number;
    corsOrigins: string[];
    // Number of proxies (load balancers) in front of the gateway; decides which IP is the client's
    trustProxy: number;
    maxBodyBytes: number;
    rateLimits: {
        global: RateLimit;
        login: RateLimit;
        register: RateLimit;
        refresh: RateLimit;
    };
}

const MINUTE = 60_000;
const serviceUrl = Joi.string().uri({ scheme: ["http", "https"] });

const envSchema = Joi.object({
    NODE_ENV: Joi.string().valid("development", "test", "production").default("development"),
    PORT: Joi.number().port().default(3000),
    HOST: Joi.string().hostname(),
    AUTH_SERVICE_URL: serviceUrl.default("http://localhost:3001"),
    NOTES_SERVICE_URL: serviceUrl.default("http://localhost:3002"),
    UPSTREAM_TIMEOUT_MS: Joi.number().integer().min(100).default(10_000),
    CORS_ORIGINS: Joi.string().default("http://localhost:5173"),
    TRUST_PROXY: Joi.number().integer().min(0).default(0),
    MAX_BODY_BYTES: Joi.number()
        .integer()
        .min(1024)
        .default(1024 * 1024),
    RATE_LIMIT_GLOBAL_MAX: Joi.number().integer().min(1).default(300),
    RATE_LIMIT_GLOBAL_WINDOW_MS: Joi.number().integer().min(1000).default(MINUTE),
    RATE_LIMIT_LOGIN_MAX: Joi.number().integer().min(1).default(5),
    RATE_LIMIT_LOGIN_WINDOW_MS: Joi.number()
        .integer()
        .min(1000)
        .default(15 * MINUTE),
    RATE_LIMIT_REGISTER_MAX: Joi.number().integer().min(1).default(5),
    RATE_LIMIT_REGISTER_WINDOW_MS: Joi.number()
        .integer()
        .min(1000)
        .default(60 * MINUTE),
    RATE_LIMIT_REFRESH_MAX: Joi.number().integer().min(1).default(30),
    RATE_LIMIT_REFRESH_WINDOW_MS: Joi.number().integer().min(1000).default(MINUTE),
}).unknown(true);

const { error, value } = envSchema.validate(process.env, { abortEarly: false });

if (error) {
    console.error("Invalid environment configuration:");
    for (const detail of error.details) {
        console.error(`  - ${detail.message}`);
    }
    process.exit(1);
}

const corsOrigins = (value.CORS_ORIGINS as string)
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

const invalidOrigin = corsOrigins.find((origin) => origin === "*" || Joi.string().uri().validate(origin).error);
if (invalidOrigin) {
    console.error(
        `Invalid environment configuration:\n  - CORS_ORIGINS contains "${invalidOrigin}"; list full origins like https://app.example.com (no "*")`,
    );
    process.exit(1);
}

export const config: Config = {
    nodeEnv: value.NODE_ENV,
    port: value.PORT,
    host: value.HOST,
    upstreams: {
        auth: value.AUTH_SERVICE_URL,
        notes: value.NOTES_SERVICE_URL,
    },
    upstreamTimeoutMs: value.UPSTREAM_TIMEOUT_MS,
    corsOrigins,
    trustProxy: value.TRUST_PROXY,
    maxBodyBytes: value.MAX_BODY_BYTES,
    rateLimits: {
        global: { max: value.RATE_LIMIT_GLOBAL_MAX, windowMs: value.RATE_LIMIT_GLOBAL_WINDOW_MS },
        login: { max: value.RATE_LIMIT_LOGIN_MAX, windowMs: value.RATE_LIMIT_LOGIN_WINDOW_MS },
        register: { max: value.RATE_LIMIT_REGISTER_MAX, windowMs: value.RATE_LIMIT_REGISTER_WINDOW_MS },
        refresh: { max: value.RATE_LIMIT_REFRESH_MAX, windowMs: value.RATE_LIMIT_REFRESH_WINDOW_MS },
    },
};
