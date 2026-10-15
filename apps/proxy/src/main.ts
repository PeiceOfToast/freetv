import { loadConfig } from "./config.js";
import { createProxyServer } from "./server.js";

const config = loadConfig();
const proxy = createProxyServer(config);

if (config.allowPrivate && config.logLevel !== "silent") {
  console.warn("proxy: PROXY_ALLOW_PRIVATE=true (dev only) - private and loopback targets are reachable");
}

proxy.server.listen(config.port, () => {
  if (config.logLevel !== "silent") console.log(`proxy listening on :${config.port} (public path ${config.publicPath || "/"})`);
});

const shutdown = () => { proxy.close().finally(() => process.exit(0)); };
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
