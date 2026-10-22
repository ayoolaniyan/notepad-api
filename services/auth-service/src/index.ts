import { startServer } from "@notepad/shared";
import { config } from "./config";
import { prisma } from "./database";
import { createApp } from "./app";

startServer(createApp(), {
    name: "auth-service",
    port: config.port,
    nodeEnv: config.nodeEnv,
    onShutdown: () => prisma.$disconnect(),
});
