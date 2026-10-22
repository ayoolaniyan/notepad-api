import "dotenv/config";
import Joi from "joi";

interface Config {
    nodeEnv: "development" | "test" | "production";
    port: number;
    host?: string;
    databaseUrl: string;
    jwt: {
        accessSecret: string;
        issuer: string;
    };
}

const envSchema = Joi.object({
    NODE_ENV: Joi.string().valid("development", "test", "production").default("development"),
    PORT: Joi.number().port().default(3002),
    // Bind to 127.0.0.1 or a private address in production so only the gateway can reach this service
    HOST: Joi.string().hostname(),
    DATABASE_URL: Joi.string()
        .uri({ scheme: ["postgres", "postgresql"] })
        .required()
        .messages({
            "string.uriCustomScheme": "DATABASE_URL must be a postgres:// or postgresql:// connection string",
        }),
    // Must match auth-service, which signs the tokens this service verifies
    JWT_ACCESS_SECRET: Joi.string().min(32).required().messages({
        "string.min": "JWT_ACCESS_SECRET must be at least 32 characters and match auth-service",
    }),
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
    host: value.HOST,
    databaseUrl: value.DATABASE_URL,
    jwt: {
        accessSecret: value.JWT_ACCESS_SECRET,
        issuer: value.JWT_ISSUER,
    },
};
