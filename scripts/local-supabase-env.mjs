import { spawnSync } from "node:child_process";

const command = process.platform === "win32" ? "npx.cmd" : "npx";

export function localSupabaseBindings() {
  const result = spawnSync(command, ["supabase", "status", "-o", "env"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error("Local Supabase is not available. Start it with npm run supabase:start.");
  }

  const values = Object.fromEntries(
    result.stdout.split("\n").flatMap((line) => {
      const match = /^([A-Z0-9_]+)=(.+)$/u.exec(line);
      if (!match) return [];
      try {
        return [[match[1], JSON.parse(match[2])]];
      } catch {
        return [];
      }
    }),
  );
  const bindings = {
    NEXT_PUBLIC_SUPABASE_URL: values.API_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: values.PUBLISHABLE_KEY,
    SUPABASE_SECRET_KEY: values.SECRET_KEY,
    AUTH_RATE_LIMIT_PEPPER: "e2e-local-rate-limit-pepper",
    APP_ORIGIN: "http://127.0.0.1:3200",
  };
  if (Object.values(bindings).some((value) => typeof value !== "string" || value.length === 0)) {
    throw new Error("Local Supabase did not report the bindings required by E2E tests.");
  }
  return bindings;
}
