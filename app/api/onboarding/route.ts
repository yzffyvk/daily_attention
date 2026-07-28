import { onboardingInputSchema } from "@/lib/domain/user";
import { completeOnboarding } from "@/server/auth/service";
import { createSupabaseAuthAdapter } from "@/server/auth/supabase-adapter";
import { parseRequest } from "@/server/auth/request";
import { authFailure, authSuccess } from "@/server/auth/response";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const parsed = await parseRequest(request, onboardingInputSchema, requestId);
  if ("response" in parsed) return parsed.response;

  try {
    const adapter = await createSupabaseAuthAdapter();
    const user = await adapter.currentUser();
    const current = await adapter.currentProfile(user.id);
    const profile = current.onboardingCompleted
      ? current
      : await completeOnboarding({
          userId: user.id,
          displayName: parsed.data.displayName,
          avatarKey: parsed.data.avatarKey,
        }, adapter.ports);

    return authSuccess({ profile }, requestId);
  } catch (error) {
    return authFailure(error, requestId);
  }
}
