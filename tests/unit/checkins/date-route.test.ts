import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { GET, PUT } from "@/app/api/checkins/[date]/route";

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
  afterEach(() => vi.useRealTimers());
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(["manual", "ai"])("rejects future %s records before reading or writing storage", async entryMode => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T15:59:59Z"));
    const findByDate = vi.fn().mockResolvedValue(null);
    mocks.context.mockResolvedValue({ userId: "user-1", supabase: {}, repository: { findByDate } });
    mocks.save.mockResolvedValue({ ok: true, record: {} });
    const response = await PUT(new Request("https://example.test/api/checkins/2026-10-15", {
      method: "PUT", body: JSON.stringify({ ...input, entryMode }),
    }), { params: Promise.resolve({ date: "2026-10-15" }) });
    expect(response?.status).toBe(422);
    await expect(response?.json()).resolves.toMatchObject({ error: { code: "VALIDATION_ERROR", details: { field: "date" } } });
    expect(findByDate).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("allows the new Beijing day as soon as midnight arrives", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T16:00:00Z"));
    mocks.context.mockResolvedValue({ userId: "user-1", supabase: {}, repository: { findByDate: vi.fn().mockResolvedValue(null) } });
    mocks.save.mockResolvedValue({ ok: true, record: {} });
    expect((await PUT(request(), { params: Promise.resolve({ date: "2026-10-15" }) }))?.status).toBe(200);
  });

  it.each([["", "manual"], ["?mode=ai", "ai"]])("reads only the selected mode (%s)", async (query, mode) => {
    const record = { id: mode, entryMode: mode, imagePath: null, version: 1 };
    const findByDate = vi.fn(async (_user: string, _date: string, selected = "manual") =>
      selected === mode ? record : null);
    mocks.context.mockResolvedValue({ userId: "user-1", supabase: {}, repository: { findByDate } });
    const response = await GET(new Request(`https://example.test/api/checkins/2026-07-23${query}`), routeContext());
    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toMatchObject({ data: record });
    expect(findByDate).toHaveBeenCalledWith("user-1", "2026-07-23", mode);
  });

  it("rejects an invalid read mode before accessing records", async () => {
    const findByDate = vi.fn();
    mocks.context.mockResolvedValue({ userId: "user-1", supabase: {}, repository: { findByDate } });
    const response = await GET(new Request("https://example.test/api/checkins/2026-07-23?mode=other"), routeContext());
    expect(response?.status).toBe(422);
    await expect(response?.json()).resolves.toMatchObject({ error: { code: "VALIDATION_ERROR", details: { field: "mode" } } });
    expect(findByDate).not.toHaveBeenCalled();
  });

  it("cleans up only the AI image when an AI save replaces its image", async () => {
    const supabase = {};
    const manualPath = "user-1/2026-07-23/manual.png";
    const aiPath = "user-1/2026-07-23/ai.png";
    mocks.context.mockResolvedValue({
      userId: "user-1", supabase,
      repository: { findByDate: vi.fn(async (_user: string, _date: string, mode = "manual") =>
        ({ imagePath: mode === "ai" ? aiPath : manualPath })) },
    });
    mocks.save.mockResolvedValue({ ok: true, record: { entryMode: "ai", imagePath: nextImagePath, version: 2 } });
    const response = await PUT(new Request("https://example.test/api/checkins/2026-07-23", {
      method: "PUT", body: JSON.stringify({ ...input, entryMode: "ai" }),
    }), routeContext());
    expect(response?.status).toBe(200);
    expect(mocks.remove).toHaveBeenCalledWith("user-1", aiPath, supabase);
    expect(mocks.remove).not.toHaveBeenCalledWith("user-1", manualPath, supabase);
    expect(mocks.save).toHaveBeenCalledWith("user-1", "2026-07-23", expect.objectContaining({ entryMode: "ai" }), expect.anything());
  });

  it("sends missing write mode as manual for legacy clients", async () => {
    mocks.context.mockResolvedValue({ userId: "user-1", supabase: {}, repository: { findByDate: vi.fn().mockResolvedValue(null) } });
    mocks.save.mockResolvedValue({ ok: true, record: { entryMode: "manual", imagePath: null, version: 1 } });
    expect((await PUT(request(), routeContext()))?.status).toBe(200);
    expect(mocks.save).toHaveBeenCalledWith("user-1", "2026-07-23", expect.objectContaining({ entryMode: "manual" }), expect.anything());
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
