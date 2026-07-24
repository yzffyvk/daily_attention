import { loginInputSchema } from "@/lib/domain/user";
import { loginAccount } from "@/server/auth/service";
import { createSupabaseAuthAdapter } from "@/server/auth/supabase-adapter";
import { nameRateBucket, parseRequest } from "@/server/auth/request";
import { authFailure, authSuccess } from "@/server/auth/response";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const parsed = await parseRequest(request, loginInputSchema, requestId);
  if ("response" in parsed) return parsed.response;
  try {
    const adapter = await createSupabaseAuthAdapter();
    await loginAccount({ ...parsed.data, bucket: nameRateBucket(request, parsed.data.name) }, adapter.ports);
    return authSuccess({}, requestId);
  } catch (error) {
    return authFailure(error, requestId);
  }
}
