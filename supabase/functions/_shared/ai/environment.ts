type ReadEnvironment = (name: string) => string | undefined;

export function readSupabaseWorkerKey(readEnvironment: ReadEnvironment) {
  const raw = readEnvironment("SUPABASE_SECRET_KEYS");
  if (raw) {
    try {
      const keys = JSON.parse(raw) as Record<string, unknown>;
      if (typeof keys.default === "string") return keys.default;
    } catch { /* Fall back to the explicit single-key configuration. */ }
  }
  return readEnvironment("SUPABASE_SECRET_KEY") ?? readEnvironment("SUPABASE_SERVICE_ROLE_KEY");
}

export function assertAiProviderModeAllowed(input: {
  mode: string;
  nodeEnv?: string;
  integrationTestBindings?: string;
}) {
  if (input.mode !== "deepseek" && input.mode !== "fake") throw new Error("FUNCTION_CONFIGURATION_ERROR");
  if (input.mode === "fake" && input.nodeEnv !== "test" && input.integrationTestBindings !== "true") {
    throw new Error("FUNCTION_CONFIGURATION_ERROR");
  }
}
