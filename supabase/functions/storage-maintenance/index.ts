import { createClient } from "@supabase/supabase-js";

declare const Deno: {
  env: { get(name: string): string | undefined };
};

const maintenanceLimit = 100;
const imageBucket = "checkin-images";
const jsonHeaders = {
  "Cache-Control": "private, no-store",
  "Content-Type": "application/json; charset=utf-8",
};

type OperationalError = Error & { code?: unknown };

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: jsonHeaders,
  });
}

async function digest(value: string) {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
}

async function constantTimeEqual(left: string, right: string) {
  const [leftDigest, rightDigest] = await Promise.all([
    digest(left),
    digest(right),
  ]);
  let difference = 0;
  for (let index = 0; index < leftDigest.length; index += 1) {
    difference |= leftDigest[index] ^ rightDigest[index];
  }
  return difference === 0;
}

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([^\s]+)$/iu.exec(authorization);
  return match?.[1] ?? "";
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

function requiredEnvironment() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const secretKey = namedDefaultSecretKey()
    ?? Deno.env.get("SUPABASE_SECRET_KEY")
    ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const maintenanceToken = Deno.env.get("STORAGE_MAINTENANCE_TOKEN");
  if (
    !supabaseUrl
    || !secretKey
    || !maintenanceToken
    || maintenanceToken.length < 32
  ) {
    throw new Error("FUNCTION_CONFIGURATION_ERROR");
  }
  return { supabaseUrl, secretKey, maintenanceToken };
}

function safeErrorFields(error: unknown) {
  const candidate = error && typeof error === "object"
    ? error as OperationalError
    : undefined;
  const candidateCode = typeof candidate?.code === "string"
    && /^[A-Z0-9_]+$/u.test(candidate.code)
    ? candidate.code
    : undefined;
  return {
    errorType: error instanceof Error ? error.name : typeof error,
    errorCode: candidateCode
      ?? (
        error instanceof Error
        && /^[A-Z][A-Z0-9_]+$/u.test(error.message)
          ? error.message
          : "INTERNAL_ERROR"
      ),
  };
}

function rpcFailure(error: unknown) {
  const failure = new Error("STORAGE_MAINTENANCE_RPC_FAILED") as OperationalError;
  if (
    error
    && typeof error === "object"
    && "code" in error
    && typeof error.code === "string"
  ) {
    failure.code = error.code;
  }
  return failure;
}

async function handleRequest(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const environment = requiredEnvironment();
    if (!await constantTimeEqual(
      bearerToken(request),
      environment.maintenanceToken,
    )) {
      return jsonResponse({ ok: false, requestId }, 401);
    }
    if (request.method !== "POST") {
      return jsonResponse({ ok: false, requestId }, 405);
    }

    const supabase = createClient(environment.supabaseUrl, environment.secretKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });
    const reservationResult = await supabase.rpc(
      "delete_expired_storage_upload_reservations",
      { target_limit: maintenanceLimit },
    );
    if (reservationResult.error) throw rpcFailure(reservationResult.error);

    const orphanResult = await supabase.rpc(
      "list_orphan_checkin_image_paths",
      { target_limit: maintenanceLimit },
    );
    if (orphanResult.error) throw rpcFailure(orphanResult.error);
    const orphanPaths = (orphanResult.data ?? []).map(
      (row: { path: string }) => row.path,
    );
    if (orphanPaths.length > 0) {
      const removalResult = await supabase.storage
        .from(imageBucket)
        .remove(orphanPaths);
      if (removalResult.error) throw rpcFailure(removalResult.error);
    }

    const result = {
      deletedReservations: Number(reservationResult.data),
      deletedOrphans: orphanPaths.length,
    };
    console.info("server_event", {
      event: "storage maintenance completed",
      requestId,
      ...result,
    });
    return jsonResponse({ ok: true, ...result, requestId }, 200);
  } catch (error) {
    console.error("server_error", {
      event: "storage maintenance failed",
      requestId,
      ...safeErrorFields(error),
    });
    return jsonResponse({ ok: false, requestId }, 500);
  }
}

const storageMaintenanceHandler = { fetch: handleRequest };

export default storageMaintenanceHandler;
