import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ context: vi.fn(), enabled: vi.fn(), consume: vi.fn(), polish: vi.fn() }));
vi.mock("@/server/ai/http", async () => ({ ...(await vi.importActual<typeof import("@/server/ai/http")>("@/server/ai/http")), createAiRequestContext: mocks.context, isAiGenerationEnabled: mocks.enabled }));
vi.mock("@/server/rate-limit/service", () => ({ consumeRateLimit: mocks.consume }));
vi.mock("@/server/ai/reflection-polish", () => ({ polishReflection: mocks.polish }));

import { POST } from "@/app/api/ai/reflection-polish/route";

const userId = "00000000-0000-4000-8000-000000000001";
const input = { topic: "Agent", summary: "Agent 由模型与工具组成。", answer: "我理解 Agent 会使用工具。", maxLength: 200 };
const output = { polishedAnswer: "我理解 Agent 会让模型调用工具来完成任务。", knowledgePoints: ["模型与工具"], improvements: ["表达更具体"], cautions: [] };
function request(body: string = JSON.stringify(input), headers: Record<string, string> = {}) { return new Request("https://example.test/api/ai/reflection-polish", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body }); }

describe("reflection polish route", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.context.mockResolvedValue({ userId, admin: {} }); mocks.enabled.mockReturnValue(true); mocks.polish.mockResolvedValue(output); });

  it("authenticates, rate limits by account, and returns a transient suggestion", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.consume).toHaveBeenCalledWith("aiGenerate", `reflection-polish:${userId}`, {});
    expect(mocks.polish).toHaveBeenCalledWith(input, userId, expect.any(AbortSignal));
    await expect(response.json()).resolves.toMatchObject({ ok: true, data: output });
  });

  it("rejects unauthenticated and disabled requests before parsing or calling the provider", async () => {
    mocks.context.mockResolvedValueOnce(null);
    expect((await POST(request("broken"))).status).toBe(401);
    mocks.context.mockResolvedValueOnce({ userId, admin: {} }); mocks.enabled.mockReturnValueOnce(false);
    expect((await POST(request("broken"))).status).toBe(403);
    expect(mocks.polish).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong content type", request(JSON.stringify(input), { "Content-Type": "text/plain" })],
    ["cross origin", request(JSON.stringify(input), { Origin: "https://evil.test" })],
    ["oversized", request(JSON.stringify({ ...input, summary: "a".repeat(70_000) }))],
    ["answer longer than maxLength", request(JSON.stringify({ ...input, maxLength: 5 }))],
  ])("rejects %s without consuming quota", async (_name, req) => {
    const response = await POST(req);
    expect(response.status).toBe(422);
    expect(mocks.consume).not.toHaveBeenCalled();
    expect(mocks.polish).not.toHaveBeenCalled();
  });
});
