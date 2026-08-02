import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

declare const Deno: {
  env: { get(name: string): string | undefined };
};

const cleanupLimit = 500;
const jsonHeaders = {
  "Cache-Control": "private, no-store",
  "Content-Type": "application/json; charset=utf-8",
};

export type AiMaintenanceDependencies = {
  triggerToken: string;
  expire(limit: number): Promise<{ clearedResults: number; deletedJobs: number }>;
};

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

async function digest(value: string) {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
}

async function constantTimeEqual(left: string, right: string) {
  const [leftDigest, rightDigest] = await Promise.all([digest(left), digest(right)]);
  let difference = 0;
  for (let index = 0; index < leftDigest.length; index += 1) {
    difference |= leftDigest[index]! ^ rightDigest[index]!;
  }
  return difference === 0;
}

function bearerToken(request: Request) {
  return /^Bearer ([^\s]+)$/iu.exec(
    request.headers.get("authorization") ?? "",
  )?.[1] ?? "";
}

export function createMaintenanceHandler(dependencies: AiMaintenanceDependencies) {
  return async function handleRequest(request: Request) {
    const requestId = crypto.randomUUID();
    if (!await constantTimeEqual(bearerToken(request), dependencies.triggerToken)) {
      return jsonResponse({ ok: false, requestId }, 401);
    }
    if (request.method !== "POST") return jsonResponse({ ok: false, requestId }, 405);

    try {
      const result = await dependencies.expire(cleanupLimit);
      return jsonResponse({ requestId, ...result }, 200);
    } catch {
      return jsonResponse({ ok: false, requestId }, 500);
    }
  };
}

function namedDefaultSecretKey() {
  const rawKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (!rawKeys) return undefined;
  try {
    const keys = JSON.parse(rawKeys) as Record<string, unknown>;
    return typeof keys.default === "string" ? keys.default : undefined;
  } catch {
    return undefined;
  }
}

function productionDependencies(): AiMaintenanceDependencies {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const secretKey = namedDefaultSecretKey()
    ?? Deno.env.get("SUPABASE_SECRET_KEY")
    ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const triggerToken = Deno.env.get("AI_MAINTENANCE_TOKEN");
  if (!supabaseUrl || !secretKey || !triggerToken || triggerToken.length < 32) {
    throw new Error("FUNCTION_CONFIGURATION_ERROR");
  }
  const client = createClient(supabaseUrl, secretKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  const resultSchema = z.array(z.object({
    cleared_results: z.number().int().nonnegative(),
    deleted_jobs: z.number().int().nonnegative(),
  })).length(1);

  return {
    triggerToken,
    async expire(limit) {
      const { data, error } = await client.rpc("expire_ai_generation_data", {
        target_limit: limit,
      });
      if (error) throw new Error("AI_MAINTENANCE_RPC_FAILED");
      const parsed = resultSchema.safeParse(data);
      if (!parsed.success) throw new Error("AI_MAINTENANCE_RPC_MALFORMED");
      return {
        clearedResults: parsed.data[0]!.cleared_results,
        deletedJobs: parsed.data[0]!.deleted_jobs,
      };
    },
  };
}

const handler = {
  fetch(request: Request) {
    try {
      return createMaintenanceHandler(productionDependencies())(request);
    } catch {
      return Promise.resolve(jsonResponse({ ok: false, requestId: crypto.randomUUID() }, 500));
    }
  },
};

export default handler;
