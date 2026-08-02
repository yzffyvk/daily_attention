import { readGatewayConfig } from "./config.js";
import { createGatewayServer } from "./server.js";

const config = readGatewayConfig();
const server = createGatewayServer(config);

server.listen(config.port, config.host, () => {
  console.info("gateway_ready", { port: config.port });
});

function shutdown() {
  server.close((error) => {
    process.exitCode = error ? 1 : 0;
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
