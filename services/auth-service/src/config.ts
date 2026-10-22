import "dotenv/config";
import Joi from "joi";

interface Config {
    nodeEnv: "development" | "test" | "production";
    port: number;
    databaseUrl: string;
    jwt: {
        accessSecret: string;
        accessTtlSeconds: number;
        issuer: string;
    };
    refreshTokenTtlDays: number;
}

const envSchema = Joi.object({
    NODE_ENV: Joi.string().valid("development", "test", "production").default("development"),
    PORT: Joi.number().port().default(3001),
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
    databaseUrl: value.DATABASE_URL,
    jwt: {
        accessSecret: value.JWT_ACCESS_SECRET,
        accessTtlSeconds: value.ACCESS_TOKEN_TTL_SECONDS,
        issuer: value.JWT_ISSUER,
    },
    refreshTokenTtlDays: value.REFRESH_TOKEN_TTL_DAYS,
};
