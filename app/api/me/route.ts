import { profilePatchSchema } from "@/lib/domain/user";
import { updateProfile } from "@/server/auth/service";
import { createSupabaseAuthAdapter } from "@/server/auth/supabase-adapter";
import { parseRequest } from "@/server/auth/request";
import { authFailure, authSuccess } from "@/server/auth/response";

export const dynamic = "force-dynamic";

export async function GET() {
  const requestId = crypto.randomUUID();
  try {
    const adapter = await createSupabaseAuthAdapter();
    const user = await adapter.currentUser();
    return authSuccess({ profile: await adapter.currentProfile(user.id) }, requestId);
  } catch (error) {
    return authFailure(error, requestId);
  }
}

export async function PATCH(request: Request) {
  const requestId = crypto.randomUUID();
  const parsed = await parseRequest(request, profilePatchSchema, requestId);
  if ("response" in parsed) return parsed.response;
  try {
    const adapter = await createSupabaseAuthAdapter();
    const user = await adapter.currentUser();
    if (parsed.data.name === undefined && parsed.data.avatarKey !== undefined) {
      const updated = await adapter.ports.updateProfileAvatar({
        userId: user.id,
        avatarKey: parsed.data.avatarKey,
      });
      return authSuccess({ profile: updated }, requestId);
    }

    const currentProfile = await adapter.currentProfile(user.id);
    const updated = await updateProfile(
      {
        userId: user.id,
        currentName: currentProfile.displayName,
        nextName: parsed.data.name ?? currentProfile.displayName,
        nextAvatarKey: parsed.data.avatarKey ?? currentProfile.avatarKey,
        currentPassword: parsed.data.currentPassword!,
      },
      adapter.ports,
    );
    return authSuccess({ profile: updated }, requestId);
  } catch (error) {
    return authFailure(error, requestId);
  }
}
