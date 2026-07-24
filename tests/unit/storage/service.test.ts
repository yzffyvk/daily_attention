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
    const rpc = vi.fn().mockResolvedValue({
      data: [{ allowed: true, reason: null, retry_after_seconds: 0 }],
      error: null,
    });
    const createSignedUploadUrl = vi.fn(
      async (path: string) => ({
        data: { path, token: "upload-token" },
        error: null,
      }),
    );
    const supabase = {
      ...supabaseStorage({ createSignedUploadUrl }),
      rpc,
    } as unknown as SupabaseClient<Database>;

    await expect(
      createCheckInUpload(
        "user-1",
        "2026-07-23",
        "image/png",
        1024,
        supabase,
      ),
    ).resolves.toEqual({
      path: expect.stringMatching(/^user-1\/2026-07-23\/.+\.png$/u),
      token: "upload-token",
    });
    expect(supabase.storage.from).toHaveBeenCalledWith("checkin-images");
    expect(createSignedUploadUrl).toHaveBeenCalledWith(
      expect.stringMatching(/^user-1\/2026-07-23\/.+\.png$/u),
      { upsert: false },
    );
  });

  it("releases a quota reservation when Storage cannot create the signature", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: [{ allowed: true, reason: null, retry_after_seconds: 0 }],
        error: null,
      })
      .mockResolvedValueOnce({ data: true, error: null });
    const createSignedUploadUrl = vi.fn().mockResolvedValue({
      data: null,
      error: new Error("storage unavailable"),
    });
    const supabase = {
      ...supabaseStorage({ createSignedUploadUrl }),
      rpc,
    } as unknown as SupabaseClient<Database>;

    await expect(
      createCheckInUpload(
        "user-1",
        "2026-07-23",
        "image/png",
        1024,
        supabase,
      ),
    ).rejects.toThrow("storage unavailable");

    expect(rpc).toHaveBeenLastCalledWith(
      "release_checkin_image_upload_reservation",
      expect.objectContaining({
        target_user_id: "user-1",
        target_path: expect.stringMatching(/^user-1\/2026-07-23\/.+\.png$/u),
      }),
    );
  });

  it("creates read URLs with an exact ten-minute expiry", async () => {
    const createSignedUrl = vi.fn().mockResolvedValue({
      data: { signedUrl: "https://example.test/read" },
      error: null,
    });

    await expect(
      createCheckInImageUrl(
        "user-1",
        "user-1/2026-07-23/file.webp",
        supabaseStorage({ createSignedUrl }),
      ),
    ).resolves.toBe("https://example.test/read");
    expect(createSignedUrl).toHaveBeenCalledWith(
      "user-1/2026-07-23/file.webp",
      600,
    );
  });

  it("rejects a foreign read path before calling Storage", async () => {
    const createSignedUrl = vi.fn();

    await expect(
      createCheckInImageUrl(
        "user-1",
        "user-2/2026-07-23/file.webp",
        supabaseStorage({ createSignedUrl }),
      ),
    ).rejects.toThrow("FORBIDDEN_IMAGE_PATH");
    expect(createSignedUrl).not.toHaveBeenCalled();
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
