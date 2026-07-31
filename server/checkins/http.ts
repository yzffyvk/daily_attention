import "server-only";

import { apiFailure, apiSuccess } from "@/lib/api/result";
import {
  logServerError,
  operationalErrorFields,
} from "@/lib/server/logging";
import { createServerSupabase } from "@/lib/supabase/server";
import { createCheckInRepository } from "./repository";

const noStoreHeaders = { "Cache-Control": "private, no-store" };

export function checkInSuccess<T>(
  data: T,
  requestId: string,
  status = 200,
) {
  return Response.json(apiSuccess(data, requestId), {
    status,
    headers: noStoreHeaders,
  });
}

export function checkInFailure(
  code: string,
  message: string,
  requestId: string,
  status: number,
  details: { field?: string; current?: unknown } = {},
) {
  return Response.json(apiFailure(code, message, requestId, details), {
    status,
    headers: noStoreHeaders,
  });
}

export async function createCheckInRequestContext() {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", data.user.id)
    .maybeSingle();
  if (profileError || !profile) return null;
  return {
    userId: data.user.id,
    repository: createCheckInRepository(supabase),
    supabase,
  };
}

export function checkInServiceFailure(error: unknown, requestId: string) {
  logServerError("check-in request failed", {
    requestId,
    ...operationalErrorFields(error),
  });
  return checkInFailure(
    "SERVICE_UNAVAILABLE",
    "服务暂时不可用，请稍后再试",
    requestId,
    503,
  );
}
