import { startServer } from "@notepad/shared";
import { config } from "./config";
import { prisma } from "./database";
import { createApp } from "./app";
import { deleteExpiredRefreshTokens } from "./services/auth.service";
import { scheduleTokenCleanup } from "./utils/tokenCleanup";

const stopTokenCleanup = scheduleTokenCleanup(() => deleteExpiredRefreshTokens(), config.refreshTokenCleanupIntervalMs);

startServer(createApp(), {
    name: "auth-service",
    port: config.port,
    host: config.host,
    nodeEnv: config.nodeEnv,
    onShutdown: async () => {
        stopTokenCleanup();
        await prisma.$disconnect();
    },
});
