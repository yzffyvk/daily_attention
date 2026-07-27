import { rotateRecoveryCode } from "@/server/auth/service";
import { createSupabaseAuthAdapter } from "@/server/auth/supabase-adapter";
import { parseRequest, rotateInputSchema } from "@/server/auth/request";
import { authFailure, authSuccess } from "@/server/auth/response";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const parsed = await parseRequest(request, rotateInputSchema, requestId);
  if ("response" in parsed) return parsed.response;
  try {
    const adapter = await createSupabaseAuthAdapter();
    const user = await adapter.currentUser();
    const currentProfile = await adapter.currentProfile(user.id);
    const result = await rotateRecoveryCode(
      {
        userId: user.id,
        email: currentProfile.email,
        currentPassword: parsed.data.currentPassword,
        bucket: user.id,
      },
      adapter.ports,
    );
    return authSuccess({ recoveryCode: result.recoveryCode }, requestId);
  } catch (error) {
    return authFailure(error, requestId);
  }
}
