import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, requestApi } from "@/features/checkins/api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("check-in API client", () => {
  it("preserves the cloud record and request metadata on a version conflict", async () => {
    const current = {
      id: "record-1",
      date: "2026-07-24",
      attention: "云端版本",
      sourceUrl: "",
      summary: "",
      inspiration: "",
      imagePath: null,
      imageName: "",
      imageUrl: null,
      version: 2,
      createdAt: "2026-07-24T00:00:00.000Z",
      updatedAt: "2026-07-24T00:00:00.000Z",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: false,
            error: {
              code: "VERSION_CONFLICT",
              message: "云端记录已更新，请确认后重试",
              details: { current },
            },
            requestId: "request-409",
          }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await expect(requestApi("/api/checkins/2026-07-24")).rejects.toMatchObject({
      name: "ApiError",
      status: 409,
      code: "VERSION_CONFLICT",
      requestId: "request-409",
      current,
    } satisfies Partial<ApiError>);
  });

  it("turns malformed failure envelopes into typed API errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: false,
            requestId: "request-malformed",
          }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await expect(requestApi("/api/checkins/2026-07-24")).rejects.toMatchObject({
      name: "ApiError",
      status: 500,
      code: "MALFORMED_RESPONSE",
      requestId: "",
    } satisfies Partial<ApiError>);
  });

  it("rejects a malformed cloud record in a version conflict", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: false,
            error: {
              code: "VERSION_CONFLICT",
              message: "云端记录已更新，请确认后重试",
              details: {
                current: {
                  id: "record-1",
                  date: "2026-02-30",
                  attention: "云端版本",
                  sourceUrl: "",
                  summary: "",
                  inspiration: "",
                  imagePath: null,
                  imageName: "",
                  imageUrl: null,
                  version: 0,
                  createdAt: "2026-07-24T00:00:00.000Z",
                  updatedAt: "2026-07-24T00:00:00.000Z",
                },
              },
            },
            requestId: "request-malformed-current",
          }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await expect(requestApi("/api/checkins/2026-07-24")).rejects.toMatchObject({
      name: "ApiError",
      status: 409,
      code: "MALFORMED_RESPONSE",
      requestId: "request-malformed-current",
    } satisfies Partial<ApiError>);
  });
});
