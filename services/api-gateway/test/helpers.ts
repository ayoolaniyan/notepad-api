import { once } from "node:events";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { jest } from "@jest/globals";
import express, { type Express } from "express";
import type * as AppModule from "../src/app";

export interface ReceivedRequest {
    method: string;
    url: string;
    headers: IncomingHttpHeaders;
    body: string;
}

export interface FakeUpstream {
    url: string;
    requests: ReceivedRequest[];
    close: () => Promise<void>;
}

// Stands in for auth-service or notes-service: records every request and echoes it back.
// POST .../login succeeds only for password "right"; GET .../slow answers after 1s.
export async function startFakeUpstream(): Promise<FakeUpstream> {
    const requests: ReceivedRequest[] = [];
    const app = express();

    app.use(express.text({ type: "*/*" }));
    app.use((req, res) => {
        const received = { method: req.method, url: req.url, headers: req.headers, body: String(req.body ?? "") };
        requests.push(received);

        if (req.path === "/health") {
            res.json({ success: true });
        } else if (req.path.endsWith("/login")) {
            const ok = received.body.includes('"right"');
            res.status(ok ? 200 : 401).json({ success: ok });
        } else if (req.path.endsWith("/slow")) {
            setTimeout(() => res.json({ success: true }), 1000).unref();
        } else {
            res.json({ success: true, data: { method: req.method, url: req.url } });
        }
    });

    const server = createServer(app).listen(0, "127.0.0.1");
    await once(server, "listening");
    return {
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        requests,
        close: async () => {
            server.closeAllConnections();
            server.close();
            await once(server, "close");
        },
    };
}

// An address nothing is listening on, to simulate a service that is down
export async function unusedUrl(): Promise<string> {
    const server = createServer().listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;
    server.close();
    await once(server, "close");
    return `http://127.0.0.1:${port}`;
}

// The environment from setup-env.ts, before any test's overrides
const baseEnv = { ...process.env };

// Config and rate limiters are created when the gateway's modules load, so each call
// applies the env overrides and loads a fresh copy with empty rate-limit counters.
// Overrides don't carry over from one call to the next.
export function loadGateway(env: Record<string, string> = {}): Express {
    process.env = { ...baseEnv, ...env };
    jest.resetModules();
    const { createApp } = jest.requireActual<typeof AppModule>("../src/app");
    return createApp();
}
