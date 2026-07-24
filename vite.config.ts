import vinext from "vinext";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import { sites } from "./build/sites-vite-plugin";

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  main: process.env.INTEGRATION_TEST_BINDINGS === "true" ? resolve("./worker/index.ts") : "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
};

function integrationBindings() {
  if (process.env.INTEGRATION_TEST_BINDINGS !== "true") return undefined;

  const names = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SECRET_KEY",
    "AUTH_RATE_LIMIT_PEPPER",
    "APP_ORIGIN",
  ] as const;
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length > 0) throw new Error(`Missing integration bindings: ${missing.join(", ")}`);

  return Object.fromEntries(names.map((name) => [name, process.env[name]! ]));
}

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");
  const bindings = integrationBindings();

  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: {
          ...localBindingConfig,
          ...(bindings ? { vars: bindings } : {}),
        },
      }),
    ],
  };
});
