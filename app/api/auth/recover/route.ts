import { recoverInputSchema } from "@/lib/domain/user";
import { recoverAccount } from "@/server/auth/service";
import { createSupabaseAuthAdapter } from "@/server/auth/supabase-adapter";
import { parseRequest, phoneRateBucket } from "@/server/auth/request";
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
        phone: parsed.data.phone,
        recoveryCode: parsed.data.recoveryCode,
        newPassword: parsed.data.newPassword,
        bucket: phoneRateBucket(request, parsed.data.phone),
      },
      adapter.ports,
    );
    return authSuccess({ recoveryCode: result.recoveryCode }, requestId);
  } catch (error) {
    return authFailure(error, requestId);
  }
}
