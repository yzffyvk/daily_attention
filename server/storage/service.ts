import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  releaseStorageUploadReservation,
  reserveStorageUpload,
} from "@/server/rate-limit/service";

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
  size: number,
  admin: SupabaseClient<Database>,
) {
  const path = buildImagePath(userId, date, mimeType);
  const quotaAdmin = admin as unknown as Parameters<
    typeof reserveStorageUpload
  >[1];
  await reserveStorageUpload({ userId, path, size }, quotaAdmin);
  try {
    const { data, error } = await admin.storage
      .from(CHECK_IN_IMAGE_BUCKET)
      .createSignedUploadUrl(path, { upsert: false });
    if (error) throw error;
    if (
      data.path !== path
      || typeof data.token !== "string"
      || data.token.length === 0
    ) {
      throw new Error("Malformed signed upload response");
    }
    return { path: data.path, token: data.token };
  } catch (error) {
    await releaseStorageUploadReservation(
      { userId, path },
      quotaAdmin,
    ).catch(() => undefined);
    throw error;
  }
}

export function isStorageUploadLimitError(
  error: unknown,
): error is {
  code: "RATE_LIMITED";
  reason: "RATE_LIMITED" | "STORAGE_QUOTA_EXCEEDED";
  retryAfterSeconds: number;
} {
  if (!error || typeof error !== "object") return false;
  const candidate = error as Record<string, unknown>;
  return (
    candidate.code === "RATE_LIMITED"
    && (
      candidate.reason === "RATE_LIMITED"
      || candidate.reason === "STORAGE_QUOTA_EXCEEDED"
    )
    && typeof candidate.retryAfterSeconds === "number"
  );
}

export async function releaseCheckInUploadReservation(
  userId: string,
  path: string,
  admin: SupabaseClient<Database>,
) {
  await releaseStorageUploadReservation(
    { userId, path },
    admin as unknown as Parameters<typeof releaseStorageUploadReservation>[1],
  );
}

export async function createCheckInImageUrl(
  userId: string,
  path: string,
  supabase: SupabaseClient<Database>,
) {
  assertOwnedImagePath(userId, path);
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
