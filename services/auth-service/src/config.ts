import "dotenv/config";
import Joi from "joi";

interface Config {
    nodeEnv: "development" | "test" | "production";
    port: number;
    host?: string;
    databaseUrl: string;
    jwt: {
        accessSecret: string;
        accessTtlSeconds: number;
        issuer: string;
    };
    refreshTokenTtlDays: number;
    loginThrottle: {
        maxFailures: number;
        windowMs: number;
    };
}

const envSchema = Joi.object({
    NODE_ENV: Joi.string().valid("development", "test", "production").default("development"),
    PORT: Joi.number().port().default(3001),
    // Bind to 127.0.0.1 or a private address in production so only the gateway can reach this service
    HOST: Joi.string().hostname(),
    DATABASE_URL: Joi.string()
        .uri({ scheme: ["postgres", "postgresql"] })
        .required()
        .messages({
            "string.uriCustomScheme": "DATABASE_URL must be a postgres:// or postgresql:// connection string",
        }),
    JWT_ACCESS_SECRET: Joi.string().min(32).required().messages({
        "string.min": "JWT_ACCESS_SECRET must be at least 32 characters (try: openssl rand -base64 48)",
    }),
    ACCESS_TOKEN_TTL_SECONDS: Joi.number().integer().min(60).default(900),
    REFRESH_TOKEN_TTL_DAYS: Joi.number().integer().min(1).default(7),
    JWT_ISSUER: Joi.string().default("notepad-auth-service"),
    LOGIN_MAX_FAILURES: Joi.number().integer().min(1).default(10),
    LOGIN_LOCKOUT_WINDOW_MINUTES: Joi.number().integer().min(1).default(15),
}).unknown(true);

const { error, value } = envSchema.validate(process.env, { abortEarly: false });

if (error) {
    console.error("Invalid environment configuration:");
    for (const detail of error.details) {
        console.error(`  - ${detail.message}`);
    }
    process.exit(1);
}

export const config: Config = {
    nodeEnv: value.NODE_ENV,
    port: value.PORT,
    host: value.HOST,
    databaseUrl: value.DATABASE_URL,
    jwt: {
        accessSecret: value.JWT_ACCESS_SECRET,
        accessTtlSeconds: value.ACCESS_TOKEN_TTL_SECONDS,
        issuer: value.JWT_ISSUER,
    },
    refreshTokenTtlDays: value.REFRESH_TOKEN_TTL_DAYS,
    loginThrottle: {
        maxFailures: value.LOGIN_MAX_FAILURES,
        windowMs: value.LOGIN_LOCKOUT_WINDOW_MINUTES * 60_000,
    },
};
