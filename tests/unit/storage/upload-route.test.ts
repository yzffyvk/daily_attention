import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  admin: {},
  context: vi.fn(),
  createAdmin: vi.fn(),
  createUpload: vi.fn(),
  releaseUpload: vi.fn(),
  removeImage: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabase: mocks.createAdmin,
}));

vi.mock("@/server/checkins/http", () => ({
  checkInFailure: (
    code: string,
    message: string,
    requestId: string,
    status: number,
    details = {},
  ) =>
    Response.json(
      { ok: false, error: { code, message, details }, requestId },
      { status, headers: { "Cache-Control": "private, no-store" } },
    ),
  checkInServiceFailure: (_error: unknown, requestId: string) =>
    Response.json({ ok: false, requestId }, { status: 503 }),
  checkInSuccess: (data: unknown, requestId: string) =>
    Response.json({ ok: true, data, requestId }),
  createCheckInRequestContext: mocks.context,
}));

vi.mock("@/server/storage/service", () => ({
  assertOwnedImagePath: vi.fn(),
  createCheckInUpload: mocks.createUpload,
  isStorageUploadLimitError: (error: unknown) =>
    !!error
    && typeof error === "object"
    && (error as { code?: string }).code === "RATE_LIMITED",
  releaseCheckInUploadReservation: mocks.releaseUpload,
  removeCheckInImage: mocks.removeImage,
}));

import { DELETE, POST } from "@/app/api/uploads/checkin-image/route";

function request() {
  return new Request("https://example.test/api/uploads/checkin-image", {
    method: "POST",
    body: JSON.stringify({
      date: "2026-07-25",
      mimeType: "image/png",
      size: 1024,
    }),
  });
}

function deleteRequest(path: string) {
  return new Request("https://example.test/api/uploads/checkin-image", {
    method: "DELETE",
    body: JSON.stringify({ path }),
  });
}

describe("POST /api/uploads/checkin-image", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.context.mockResolvedValue({
      userId: "user-1",
      supabase: { userClient: true },
    });
    mocks.createAdmin.mockReturnValue(mocks.admin);
  });

  it("uses the admin client for quota reservation and signed upload creation", async () => {
    mocks.createUpload.mockResolvedValue({
      path: "user-1/2026-07-25/image.png",
      token: "signed-token",
    });

    const response = await POST(request());

    expect(response).toBeDefined();
    if (!response) throw new Error("Route returned no response");
    expect(response.status).toBe(200);
    expect(mocks.createUpload).toHaveBeenCalledWith(
      "user-1",
      "2026-07-25",
      "image/png",
      1024,
      mocks.admin,
    );
  });

  it.each(["RATE_LIMITED", "STORAGE_QUOTA_EXCEEDED"])(
    "returns 429 when the upload limiter rejects %s",
    async (reason) => {
      mocks.createUpload.mockRejectedValue(
        Object.assign(new Error(reason), {
          code: "RATE_LIMITED",
          reason,
          retryAfterSeconds: reason === "RATE_LIMITED" ? 60 : 0,
        }),
      );

      const response = await POST(request());
      expect(response).toBeDefined();
      if (!response) throw new Error("Route returned no response");
      const body = await response.json() as {
        error: { code: string; message: string };
      };

      expect(response.status).toBe(429);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(body.error.code).toBe("RATE_LIMITED");
      expect(body.error.message).not.toContain(reason);
    },
  );

  it("releases an upload reservation when the browser reports a failed upload", async () => {
    const path = "user-1/2026-07-25/image.png";

    const response = await DELETE(deleteRequest(path));

    expect(response).toBeDefined();
    if (!response) throw new Error("Route returned no response");
    expect(response.status).toBe(200);
    expect(mocks.removeImage).toHaveBeenCalledWith(
      "user-1",
      path,
      expect.objectContaining({ userClient: true }),
    );
    expect(mocks.releaseUpload).toHaveBeenCalledWith(
      "user-1",
      path,
      mocks.admin,
    );
  });
});
