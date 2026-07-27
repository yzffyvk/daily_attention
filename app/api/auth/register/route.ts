import { registerInputSchema } from "@/lib/domain/user";
import { registerAccount } from "@/server/auth/service";
import { createSupabaseAuthAdapter } from "@/server/auth/supabase-adapter";
import { parseRequest, requestIp } from "@/server/auth/request";
import { authFailure, authSuccess } from "@/server/auth/response";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const parsed = await parseRequest(request, registerInputSchema, requestId);
  if ("response" in parsed) return parsed.response;
  try {
    const adapter = await createSupabaseAuthAdapter();
    const result = await registerAccount(
      {
        email: parsed.data.email,
        password: parsed.data.password,
        avatarKey: parsed.data.avatarKey,
        bucket: requestIp(request),
      },
      adapter.ports,
    );
    return authSuccess({ profile: result.profile, recoveryCode: result.recoveryCode }, requestId, 201);
  } catch (error) {
    return authFailure(error, requestId);
  }
}
