import { Express } from "express";
import { Server } from "node:http";

export interface StartServerOptions {
    name: string;
    port: number;
    // Interface to bind; omit for all interfaces. Use 127.0.0.1 or a private network address
    // for services that should only be reachable through the gateway
    host?: string;
    nodeEnv: string;
    // Release resources (e.g. database connections) after in-flight requests finish
    onShutdown?: () => Promise<void>;
    forceExitAfterMs?: number;
}

// Starts listening and shuts down gracefully on SIGINT/SIGTERM
export function startServer(app: Express, { name, port, host, nodeEnv, onShutdown, forceExitAfterMs = 10_000 }: StartServerOptions): Server {
    const onListening = (err?: Error) => {
        // Express 5 passes listen errors (e.g. EADDRINUSE) to this callback instead of throwing
        if (err) {
            console.error(`${name} failed to listen on port ${port}: ${err.message}`);
            process.exit(1);
        }
        console.log(`${name} listening on ${host ? `${host}:` : "port "}${port} (${nodeEnv})`);
    };
    const server = host ? app.listen(port, host, onListening) : app.listen(port, onListening);

    const shutdown = (signal: string) => {
        console.log(`${signal} received, shutting down`);
        server.close(() => {
            Promise.resolve(onShutdown?.()).then(
                () => process.exit(0),
                (err: unknown) => {
                    console.error(`${name} shutdown failed:`, err);
                    process.exit(1);
                },
            );
        });
        // Force exit if connections don't drain in time
        setTimeout(() => process.exit(1), forceExitAfterMs).unref();
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));

    return server;
}
