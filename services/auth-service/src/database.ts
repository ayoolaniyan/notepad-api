import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";
import { config } from "./config";

const adapter = new PrismaPg({ connectionString: config.databaseUrl });

export const prisma = new PrismaClient({ adapter });

export async function isDatabaseHealthy(timeoutMs = 2000): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Database health check timed out")), timeoutMs);
    });

    try {
        await Promise.race([prisma.$queryRaw`SELECT 1`, timeout]);
        return true;
    } catch {
        return false;
    } finally {
        clearTimeout(timer);
    }
}
