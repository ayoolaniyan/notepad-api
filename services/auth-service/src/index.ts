import { config } from "./config";
import { prisma } from "./database";
import { createApp } from "./app";

const server = createApp().listen(config.port, () => {
    console.log(`auth-service listening on port ${config.port} (${config.nodeEnv})`);
});

async function shutdown(signal: string) {
    console.log(`${signal} received, shutting down`);
    server.close(async () => {
        await prisma.$disconnect();
        process.exit(0);
    });
    // Force exit if connections don't drain in time
    setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
