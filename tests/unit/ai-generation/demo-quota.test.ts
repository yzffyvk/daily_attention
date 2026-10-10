import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installThemeDemoApi } from "@/tests/visual/theme-demo-api";
import { parseQuestionSummary } from "@/lib/domain/knowledge-questions";

async function request(path: string, body?: unknown, method = "POST") {
  const response = await window.fetch(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, ...(await response.json()) };
}
function generation(targetDate: string, idempotencyKey = crypto.randomUUID()) {
  return { targetDate, idempotencyKey, sourceUrl: "https://example.com/learning" };
}
function narrative(dates: string[], entryMode = "ai") {
  return { dates, entryMode, question: "", idempotencyKey: crypto.randomUUID() };
}
beforeEach(() => {
  sessionStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-19T04:00:00Z"));
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected external request"); }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); sessionStorage.clear(); });

describe("demo shared account quota", () => {
  it("demonstrates the current question reader with valid cross-question references", async () => {
    installThemeDemoApi();
    const created = await request("/api/ai/generations", generation("2026-09-19"));
    vi.setSystemTime(new Date("2026-09-19T04:00:10Z"));
    const completed = await request(`/api/ai/generations/${created.data.jobId}`, undefined, "GET");
    const document = parseQuestionSummary(completed.data.result.summary);
    expect(document).not.toBeNull();
    expect(document!.structure.questions.length).toBeGreaterThan(1);
    expect(document!.structure.questions.flatMap(q => q.views).some(v => v.referenceNodeIds.length > 0)).toBe(true);
    expect(completed.data.generationContext.promptVersion).toBe("knowledge-questions-v1");
    expect(document!.warnings.join(" ")).toContain("演示");
  });
  it("keeps requirements in the task snapshot and rejects idempotent replay with different requirements", async () => {
    installThemeDemoApi();
    const input = { ...generation("2026-09-19"), userPrompt: "  重点讲使用边界  " };
    const created = await request("/api/ai/generations", input);
    expect(created.data.generationContext?.userPrompt).toBe("重点讲使用边界");
    const conflict = await request("/api/ai/generations", { ...input, userPrompt: "只讲实现" });
    expect(conflict.status).toBe(409);
    vi.setSystemTime(new Date("2026-09-19T04:00:10Z"));
    const completed = await request(`/api/ai/generations/${created.data.jobId}`, undefined, "GET");
    expect(completed.data.generationContext?.userPrompt).toBe("重点讲使用边界");
  });
  it("shares five requests across record dates and both generation features", async () => {
    const demo = installThemeDemoApi();
    const first = generation("2026-01-01");
    const created = await request("/api/ai/generations", first);
    expect(created.data.quota.remaining).toBe(4);
    expect((await request("/api/knowledge-narratives", narrative(demo.dates.related.slice(0, 2)))).status).toBe(202);
    expect((await request("/api/ai/generations", generation("2026-05-15"))).data.quota.remaining).toBe(2);
    expect((await request("/api/knowledge-narratives", narrative(demo.dates.mixed.slice(0, 2), "manual"))).status).toBe(202);
    expect((await request("/api/ai/generations", generation("2026-09-19"))).data.quota.remaining).toBe(0);
    const sixth = await request("/api/ai/generations", generation("2026-02-01"));
    expect(sixth.status).toBe(429);
    expect(sixth.error.code).toBe("DAILY_AI_LIMIT_REACHED");
    expect((await request("/api/knowledge-narratives", narrative(demo.dates.related.slice(1)))).status).toBe(429);
    const retry = await request("/api/ai/generations", first);
    expect(retry.status).toBe(202);
    expect(retry.data.jobId).toBe(created.data.jobId);
    expect(retry.data.quota.remaining).toBe(0);
  });

  it("retains used quota after reloading the demo", async () => {
    installThemeDemoApi();
    for (let day = 1; day <= 5; day++) await request("/api/ai/generations", generation(`2026-01-0${day}`));
    installThemeDemoApi();
    expect((await request("/api/ai/generations", generation("2026-08-01"))).status).toBe(429);
  });

  it("renews only when the request day crosses midnight in Shanghai", async () => {
    vi.setSystemTime(new Date("2026-09-19T15:59:59Z"));
    installThemeDemoApi();
    for (let day = 1; day <= 5; day++) await request("/api/ai/generations", generation(`2026-01-0${day}`));
    expect((await request("/api/ai/generations", generation("2026-08-01"))).status).toBe(429);
    vi.setSystemTime(new Date("2026-09-19T16:00:00Z"));
    const next = await request("/api/ai/generations", generation("2026-01-01"));
    expect(next.status).toBe(202);
    expect(next.data.quota.remaining).toBe(4);
  });

  it("releases queued cancellation but cannot refund a started model call", async () => {
    installThemeDemoApi();
    const job = await request("/api/ai/generations", generation("2026-01-01"));
    expect((await request(`/api/ai/generations/${job.data.jobId}`, undefined, "DELETE")).status).toBe(200);
    const next = await request("/api/ai/generations", generation("2026-01-02"));
    expect(next.data.quota.remaining).toBe(4);
    vi.setSystemTime(new Date("2026-09-19T04:00:04Z"));
    expect((await request(`/api/ai/generations/${next.data.jobId}`, undefined, "DELETE")).status).toBe(409);
    const third = await request("/api/ai/generations", generation("2026-01-03"));
    expect(third.data.quota).toMatchObject({ used: 2, consumed: 1, reserved: 1, remaining: 3 });
  });

  it("does not regain quota by deleting a completed narrative", async () => {
    const demo = installThemeDemoApi();
    const created = await request("/api/knowledge-narratives", narrative(demo.dates.related.slice(0, 2)));
    vi.setSystemTime(new Date("2026-09-19T04:00:10Z"));
    await request(`/api/knowledge-narratives/${created.data.id}`, undefined, "DELETE");
    const next = await request("/api/ai/generations", generation("2026-01-01"));
    expect(next.data.quota).toMatchObject({ used: 2, consumed: 1, reserved: 1, remaining: 3 });
  });
});
