import { recoverInputSchema } from "@/lib/domain/user";
import { recoverAccount } from "@/server/auth/service";
import { createSupabaseAuthAdapter } from "@/server/auth/supabase-adapter";
import { emailRateBucket, parseRequest } from "@/server/auth/request";
import { authFailure, authSuccess } from "@/server/auth/response";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const parsed = await parseRequest(request, recoverInputSchema, requestId);
  if ("response" in parsed) return parsed.response;
  try {
    const adapter = await createSupabaseAuthAdapter();
    const result = await recoverAccount(
      {
        email: parsed.data.email,
        recoveryCode: parsed.data.recoveryCode,
        newPassword: parsed.data.newPassword,
        bucket: emailRateBucket(request, parsed.data.email),
      },
      adapter.ports,
    );
    return authSuccess(
      { profile: result.profile, recoveryCode: result.recoveryCode },
      requestId,
    );
  } catch (error) {
    return authFailure(error, requestId);
  }
}
