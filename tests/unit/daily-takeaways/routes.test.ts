import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ context: vi.fn(), get: vi.fn(), act: vi.fn() }));
vi.mock("@/server/daily-takeaways/http", async () => ({
  ...await vi.importActual<object>("@/server/daily-takeaways/http"), createTakeawayContext: mocks.context,
}));
import { GET, POST } from "@/app/api/daily-takeaways/route";

const request = (body: unknown = { action: "collect", lessonId: "tennis-01", version: 1 }) => new Request("https://example.test/api/daily-takeaways", { method: "POST", body: JSON.stringify(body) });

describe("daily takeaway API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.context.mockResolvedValue({ userId: "verified-owner", repository: { get: mocks.get, act: mocks.act } });
    mocks.get.mockResolvedValue({ history: [] });
    mocks.act.mockResolvedValue({ history: [] });
  });
  it("requires a verified account for reads and writes", async () => {
    mocks.context.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect((await POST(request())).status).toBe(401);
    expect(mocks.act).not.toHaveBeenCalled();
  });
  it("uses the verified owner and returns private noncacheable state", async () => {
    const response = await GET();
    expect(mocks.get).toHaveBeenCalledWith("verified-owner");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect((await POST(request())).status).toBe(200);
    expect(mocks.act).toHaveBeenCalledWith("verified-owner", { action: "collect", lessonId: "tennis-01", version: 1 });
  });
  it("rejects forged dates, ownership, invalid answers and malformed bodies", async () => {
    for (const body of [{ action: "collect", lessonId: "tennis-01", version: 1, userId: "other" }, { action: "skip", lessonId: "tennis-01", version: 1, date: "2026-10-01" }, { action: "quiz", lessonId: "tennis-01", version: 1, answerIndex: 5 }]) {
      expect((await POST(request(body))).status).toBe(422);
    }
    expect((await POST(new Request("https://example.test", { method: "POST", body: "{" }))).status).toBe(422);
    expect(mocks.act).not.toHaveBeenCalled();
  });
  it.each(["DAILY_TAKEAWAY_DONE", "TAKEAWAY_PROGRESS_CHANGED", "TAKEAWAY_CONTENT_UPDATED"])("returns recoverable conflicts: %s", async code => {
    mocks.act.mockRejectedValue({ message: code });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe(code);
  });
  it("does not leak backend errors", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.get.mockRejectedValue(new Error("private internal details"));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private internal details");
  });
});
