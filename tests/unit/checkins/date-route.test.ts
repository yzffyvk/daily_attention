import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
  createUrl: vi.fn(),
  assertOwned: vi.fn((userId: string, path: string) => {
    if (path.split("/", 1)[0] !== userId) {
      throw new Error("FORBIDDEN_IMAGE_PATH");
    }
  }),
}));

vi.mock("@/server/checkins/http", () => ({
  checkInFailure: (code: string, message: string, requestId: string, status: number, details = {}) =>
    Response.json(
      { ok: false, error: { code, message, details }, requestId },
      { status, headers: { "Cache-Control": "private, no-store" } },
    ),
  checkInServiceFailure: (error: unknown, requestId: string) =>
    Response.json({ ok: false, error: { error }, requestId }, { status: 503 }),
  checkInSuccess: (data: unknown, requestId: string) =>
    Response.json(
      { ok: true, data, requestId },
      { headers: { "Cache-Control": "private, no-store" } },
    ),
  createCheckInRequestContext: mocks.context,
}));

vi.mock("@/server/checkins/service", () => ({ saveCheckIn: mocks.save }));

vi.mock("@/server/storage/service", () => ({
  assertOwnedImagePath: mocks.assertOwned,
  createCheckInImageUrl: mocks.createUrl,
  removeCheckInImage: mocks.remove,
}));

import { PUT } from "@/app/api/checkins/[date]/route";

const previousImagePath = "user-1/2026-07-23/previous.png";
const nextImagePath = "user-1/2026-07-23/next.png";

const input = {
  attention: "attention",
  sourceUrl: "",
  summary: "",
  inspiration: "",
  imagePath: nextImagePath,
  imageName: "next.png",
  version: 1,
};

function routeContext() {
  return { params: Promise.resolve({ date: "2026-07-23" }) };
}

function request() {
  return new Request("https://example.test/api/checkins/2026-07-23", {
    method: "PUT",
    body: JSON.stringify(input),
    headers: { "Content-Type": "application/json" },
  });
}

describe("check-in image replacement cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes only the previous image after a successful replacement", async () => {
    const supabase = {};
    const previous = { imagePath: previousImagePath };
    const record = { imagePath: nextImagePath, version: 2 };
    mocks.context.mockResolvedValue({
      userId: "user-1",
      supabase,
      repository: { findByDate: vi.fn().mockResolvedValue(previous) },
    });
    mocks.save.mockResolvedValue({ ok: true, record });

    const response = await PUT(request(), routeContext());

    expect(response?.status).toBe(200);
    expect(mocks.remove).toHaveBeenCalledWith(
      "user-1",
      previousImagePath,
      supabase,
    );
    expect(mocks.remove).not.toHaveBeenCalledWith(
      "user-1",
      nextImagePath,
      supabase,
    );
  });

  it("does not delete an uploaded proposal when the save conflicts", async () => {
    mocks.context.mockResolvedValue({
      userId: "user-1",
      supabase: {},
      repository: { findByDate: vi.fn().mockResolvedValue({ imagePath: previousImagePath }) },
    });
    mocks.save.mockResolvedValue({
      ok: false,
      reason: "VERSION_CONFLICT",
      current: { imagePath: previousImagePath, version: 2 },
    });

    const response = await PUT(request(), routeContext());

    expect(response?.status).toBe(409);
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("keeps the existing image when the path is unchanged", async () => {
    const supabase = {};
    mocks.context.mockResolvedValue({
      userId: "user-1",
      supabase,
      repository: { findByDate: vi.fn().mockResolvedValue({ imagePath: previousImagePath }) },
    });
    mocks.save.mockResolvedValue({
      ok: true,
      record: { imagePath: previousImagePath, version: 2 },
    });

    const response = await PUT(
      new Request("https://example.test/api/checkins/2026-07-23", {
        method: "PUT",
        body: JSON.stringify({ ...input, imagePath: previousImagePath }),
        headers: { "Content-Type": "application/json" },
      }),
      routeContext(),
    );

    expect(response?.status).toBe(200);
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("returns the saved record when post-commit old-image cleanup fails", async () => {
    const supabase = {};
    const record = { imagePath: nextImagePath, version: 2 };
    mocks.context.mockResolvedValue({
      userId: "user-1",
      supabase,
      repository: { findByDate: vi.fn().mockResolvedValue({ imagePath: previousImagePath }) },
    });
    mocks.save.mockResolvedValue({ ok: true, record });
    mocks.remove.mockRejectedValue(new Error("storage unavailable"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await PUT(request(), routeContext());

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toMatchObject({ ok: true, data: record });
    expect(mocks.remove).toHaveBeenCalledWith("user-1", previousImagePath, supabase);
    expect(consoleError).toHaveBeenCalledWith(
      "server_error",
      expect.objectContaining({
        event: "check-in image cleanup failed",
        errorType: "Error",
        errorCode: "INTERNAL_ERROR",
        requestId: expect.any(String),
      }),
    );
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(previousImagePath);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(nextImagePath);
    expect(consoleError.mock.calls[0]?.[1]).not.toHaveProperty("error");
    consoleError.mockRestore();
  });

  it("rejects a foreign image path before attempting a save", async () => {
    mocks.context.mockResolvedValue({
      userId: "user-1",
      supabase: {},
      repository: { findByDate: vi.fn() },
    });

    const response = await PUT(
      new Request("https://example.test/api/checkins/2026-07-23", {
        method: "PUT",
        body: JSON.stringify({
          ...input,
          imagePath: "user-2/2026-07-23/foreign.png",
        }),
        headers: { "Content-Type": "application/json" },
      }),
      routeContext(),
    );

    expect(response?.status).toBe(403);
    expect(response?.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response?.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN_IMAGE_PATH" },
    });
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("rejects an empty image path as validation error before attempting a save", async () => {
    mocks.context.mockResolvedValue({
      userId: "user-1",
      supabase: {},
      repository: { findByDate: vi.fn() },
    });

    const response = await PUT(
      new Request("https://example.test/api/checkins/2026-07-23", {
        method: "PUT",
        body: JSON.stringify({ ...input, imagePath: "" }),
        headers: { "Content-Type": "application/json" },
      }),
      routeContext(),
    );

    expect(response?.status).toBe(422);
    await expect(response?.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "VALIDATION_ERROR", details: { field: "imagePath" } },
    });
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
