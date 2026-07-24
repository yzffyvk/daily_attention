import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

const CHECK_IN_IMAGE_BUCKET = "checkin-images";
const SIGNED_READ_URL_SECONDS = 10 * 60;

const EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

export type CheckInImageMimeType = keyof typeof EXTENSIONS;

function extensionFor(mimeType: string): string {
  const extension = EXTENSIONS[mimeType as CheckInImageMimeType];
  if (!extension) throw new Error("UNSUPPORTED_IMAGE_TYPE");
  return extension;
}

export function buildImagePath(
  userId: string,
  date: string,
  mimeType: string,
) {
  return `${userId}/${date}/${crypto.randomUUID()}.${extensionFor(mimeType)}`;
}

export function assertOwnedImagePath(userId: string, path: string) {
  if (path.split("/", 1)[0] !== userId) {
    throw new Error("FORBIDDEN_IMAGE_PATH");
  }
}

export async function createCheckInUpload(
  userId: string,
  date: string,
  mimeType: string,
  supabase: SupabaseClient<Database>,
) {
  const path = buildImagePath(userId, date, mimeType);
  const { data, error } = await supabase.storage
    .from(CHECK_IN_IMAGE_BUCKET)
    .createSignedUploadUrl(path, { upsert: false });
  if (error) throw error;
  return { path: data.path, token: data.token };
}

export async function createCheckInImageUrl(
  path: string,
  supabase: SupabaseClient<Database>,
) {
  const { data, error } = await supabase.storage
    .from(CHECK_IN_IMAGE_BUCKET)
    .createSignedUrl(path, SIGNED_READ_URL_SECONDS);
  if (error) throw error;
  return data.signedUrl;
}

export async function removeCheckInImage(
  userId: string,
  path: string,
  supabase: SupabaseClient<Database>,
) {
  assertOwnedImagePath(userId, path);
  const { error } = await supabase.storage
    .from(CHECK_IN_IMAGE_BUCKET)
    .remove([path]);
  if (error) throw error;
}
