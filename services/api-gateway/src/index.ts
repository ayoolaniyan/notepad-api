import { startServer } from "@notepad/shared";
import { config } from "./config";
import { createApp } from "./app";

startServer(createApp(), {
    name: "api-gateway",
    port: config.port,
    host: config.host,
    nodeEnv: config.nodeEnv,
});
