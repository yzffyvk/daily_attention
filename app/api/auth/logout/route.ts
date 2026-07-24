import { createSupabaseAuthAdapter } from "@/server/auth/supabase-adapter";
import { emptyInputSchema, parseRequest } from "@/server/auth/request";
import { authFailure, authSuccess } from "@/server/auth/response";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const parsed = await parseRequest(request, emptyInputSchema, requestId);
  if ("response" in parsed) return parsed.response;
  try {
    const adapter = await createSupabaseAuthAdapter();
    await adapter.signOut();
    return authSuccess({}, requestId);
  } catch (error) {
    return authFailure(error, requestId);
  }
}
