import { loadConfig } from "../config/env.js";
import { migrate } from "../db/client.js";
import { createApp } from "./app.js";

const config = loadConfig();
await migrate();

const server = createApp().listen(config.port, config.host, () => {
  console.log(`Hermes server listening on http://${config.host}:${config.port}`);
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
