export type GatewayConfig = {
  host: string;
  port: number;
  token: string;
};

export function readGatewayConfig(
  environment: NodeJS.ProcessEnv = process.env,
): GatewayConfig {
  const token = environment.SAFE_FETCH_GATEWAY_TOKEN;
  if (!token || token.length < 32 || token.length > 512) {
    throw new Error("SAFE_FETCH_GATEWAY_TOKEN must contain 32-512 characters");
  }

  const port = Number(environment.PORT ?? "8788");
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  return {
    host: environment.HOST?.trim() || "0.0.0.0",
    port,
    token,
  };
}
