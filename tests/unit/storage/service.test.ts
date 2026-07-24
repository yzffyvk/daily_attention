import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  assertOwnedImagePath,
  buildImagePath,
  createCheckInImageUrl,
  createCheckInUpload,
  removeCheckInImage,
} from "@/server/storage/service";

function supabaseStorage(bucket: Record<string, unknown>) {
  return {
    storage: { from: vi.fn().mockReturnValue(bucket) },
  } as unknown as SupabaseClient<Database>;
}

describe("check-in image paths", () => {
  it("builds an owner/date/random path", () => {
    expect(buildImagePath("user-1", "2026-07-23", "image/jpeg")).toMatch(
      /^user-1\/2026-07-23\/[0-9a-f-]+\.jpg$/u,
    );
  });

  it("rejects another user's path", () => {
    expect(() =>
      assertOwnedImagePath("user-1", "user-2/2026-07-23/file.jpg"),
    ).toThrow("FORBIDDEN_IMAGE_PATH");
  });

  it("rejects unsupported image types", () => {
    expect(() => buildImagePath("user-1", "2026-07-23", "image/gif")).toThrow(
      "UNSUPPORTED_IMAGE_TYPE",
    );
  });

  it("creates non-upsert upload signatures in the private image bucket", async () => {
    const createSignedUploadUrl = vi.fn().mockResolvedValue({
      data: { path: "user-1/2026-07-23/new.png", token: "upload-token" },
      error: null,
    });
    const supabase = supabaseStorage({ createSignedUploadUrl });

    await expect(
      createCheckInUpload("user-1", "2026-07-23", "image/png", supabase),
    ).resolves.toEqual({
      path: "user-1/2026-07-23/new.png",
      token: "upload-token",
    });
    expect(supabase.storage.from).toHaveBeenCalledWith("checkin-images");
    expect(createSignedUploadUrl).toHaveBeenCalledWith(
      expect.stringMatching(/^user-1\/2026-07-23\/.+\.png$/u),
      { upsert: false },
    );
  });

  it("creates read URLs with an exact ten-minute expiry", async () => {
    const createSignedUrl = vi.fn().mockResolvedValue({
      data: { signedUrl: "https://example.test/read" },
      error: null,
    });

    await expect(
      createCheckInImageUrl(
        "user-1/2026-07-23/file.webp",
        supabaseStorage({ createSignedUrl }),
      ),
    ).resolves.toBe("https://example.test/read");
    expect(createSignedUrl).toHaveBeenCalledWith(
      "user-1/2026-07-23/file.webp",
      600,
    );
  });

  it("deletes only the authenticated user's object", async () => {
    const remove = vi.fn().mockResolvedValue({ data: [], error: null });
    const supabase = supabaseStorage({ remove });

    await removeCheckInImage("user-1", "user-1/2026-07-23/file.jpg", supabase);
    expect(remove).toHaveBeenCalledWith(["user-1/2026-07-23/file.jpg"]);
    await expect(
      removeCheckInImage("user-1", "user-2/2026-07-23/file.jpg", supabase),
    ).rejects.toThrow("FORBIDDEN_IMAGE_PATH");
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
