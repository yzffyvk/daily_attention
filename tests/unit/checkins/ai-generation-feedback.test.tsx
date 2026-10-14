import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CheckInWorkspace } from "@/features/checkins/checkin-workspace";
import { formatCalendarDate, formatDate, getTodayKey } from "@/features/checkins/dates";
import { TestQueryProvider } from "@/tests/helpers/test-query-provider";
import { deleteAttentionDraftDatabase, loadDraft } from "@/lib/indexed-db/drafts";
import type { CheckInRecord } from "@/features/checkins/types";
import type { AiGenerationJobData } from "@/features/ai-generation/types";

vi.mock("canvas-confetti", () => ({ default: vi.fn() }));
const date = getTodayKey();
const jobId = "10000000-0000-4000-8000-000000000011";
const result = { attention: "生成的主题", summary: "生成的知识小结", inspiration: "", sourceTitle: "原文", warnings: [] };
const quota = { used: 1, reserved: 0, consumed: 1, limit: 5, remaining: 4 };

function reply(data: unknown) {
  return new Response(JSON.stringify({ ok: true, data, requestId: "feedback" }), { headers: { "Content-Type": "application/json" } });
}
function missing() {
  return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: "暂无记录" }, requestId: "feedback" }), { status: 404, headers: { "Content-Type": "application/json" } });
}
function fixture(initial?: CheckInRecord) {
  let record = initial;
  let current: AiGenerationJobData = { jobId, status: "generating", stage: "generating", progress: { phase: "writing", preview: "本轮预览", updatedAt: new Date().toISOString() }, cancellation: { freeRemaining: 0, requiresConfirmation: true, charged: null }, quota: { ...quota, limit: 5 } };
  let finishCancel!: (value: Response) => void;
  const cancelling = new Promise<Response>((resolve) => { finishCancel = resolve; });
  const requests: boolean[] = [];
  let saves = 0;
  let polls = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === "/api/ai/generations" && init?.method === "POST") return reply({ jobId, status: "queued", pollAfterMs: 1, quota });
    if (url.pathname === `/api/ai/generations/${jobId}`) {
      if (init?.method === "DELETE") { requests.push(JSON.parse(init.body as string).confirmQuotaConsumption); return cancelling; }
      polls += 1;
      return reply(current);
    }
    if (url.pathname === `/api/checkins/${date}`) {
      if (init?.method === "PUT") {
        saves += 1;
        record = { id: "ai-record", date, ...JSON.parse(init.body as string), version: (record?.version ?? 0) + 1, imagePath: null, imageName: "", imageUrl: null, createdAt: `${date}T00:00:00Z`, updatedAt: new Date().toISOString() };
        return reply(record);
      }
      return url.searchParams.get("mode") === "ai" && record ? reply(record) : missing();
    }
    if (url.pathname === "/api/checkins") return reply([]);
    if (url.pathname === "/api/checkins/stats") return reply({ totalCount: record ? 1 : 0, currentStreak: 0, hasTodayRecord: !!record });
    if (/^\/api\/checkins\/\d{4}-\d{2}-\d{2}$/.test(url.pathname)) return missing();
    if (url.pathname === "/api/me") return reply({ profile: null });
    return reply([]);
  }));
  return { requests, saves: () => saves, polls: () => polls, succeed: () => { current = { jobId, status: "succeeded", stage: "complete", result, quota: { ...quota, limit: 5 } }; }, cancel: () => finishCancel(reply({ jobId, status: "cancelled", stage: "complete", quota, cancellation: { freeRemaining: 0, requiresConfirmation: false, charged: true } })) };
}
function mount() {
  return render(<TestQueryProvider><CheckInWorkspace initialDate={date} initialToday={date} userId="feedback-user" /></TestQueryProvider>);
}
async function switchTo(mode: "manual" | "ai") {
  const name = mode === "ai" ? /AI 提炼/ : /手动记录/;
  await waitFor(() => expect(within(screen.getByRole("group", { name: "选择打卡方式" })).getByRole("button", { name })).toBeEnabled());
  fireEvent.click(within(screen.getByRole("group", { name: "选择打卡方式" })).getByRole("button", { name }));
  await waitFor(() => expect(within(screen.getByRole("group", { name: "选择打卡方式" })).getByRole("button", { name })).toHaveAttribute("aria-pressed", "true"));
  await waitFor(() => expect(document.querySelector(".checkin-form")).toHaveAttribute("aria-busy", "false"));
}
async function generate() {
  fireEvent.change(document.getElementById("source-url")!, { target: { value: "https://example.com" } });
  fireEvent.click(screen.getByRole("button", { name: "生成知识小结" }));
  await waitFor(() => expect(screen.getByText("本轮预览")).toBeVisible());
}
beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
});
afterEach(async () => { cleanup(); await deleteAttentionDraftDatabase(); vi.unstubAllGlobals(); });

describe("AI generation feedback", () => {
  it("clears success when generated content is discarded before switching dates", async () => {
    const previous = { id: "old", date, entryMode: "ai" as const, attention: "此前主题", sourceUrl: "https://example.com", summary: "此前小结", inspiration: "", version: 1, imagePath: null, imageName: "", imageUrl: null, createdAt: `${date}T00:00:00Z`, updatedAt: `${date}T00:00:00Z` };
    const api = fixture(previous); mount(); await switchTo("ai");
    await waitFor(() => expect(screen.getByText("此前小结")).toBeVisible());
    await generate(); api.succeed();
    await waitFor(() => expect(screen.getByRole("status", { name: "AI 提炼成功" })).toBeVisible(), { timeout: 2000 });
    const otherDate = new Date(Date.parse(`${date}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
    fireEvent.click(screen.getByRole("button", { name: `${formatCalendarDate(otherDate)}，暂无记录` }));
    fireEvent.click(screen.getByRole("button", { name: "放弃修改" }));
    await waitFor(() => expect(screen.getByText(formatDate(otherDate), { selector: ".editor-date" })).toBeVisible());
    await waitFor(() => expect(screen.getByLabelText("今日知识主题")).toBeEnabled());
    expect(screen.queryByRole("status", { name: "AI 提炼成功" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${formatCalendarDate(date)}，`) }));
    await waitFor(() => expect(screen.getByText("此前小结")).toBeVisible());
    expect(screen.queryByRole("status", { name: "AI 提炼成功" })).not.toBeInTheDocument();
    expect(api.saves()).toBe(0);
  });

  it("confirms quota consumption accessibly and preserves edited prior results when cancelled", async () => {
    const api = fixture({ id: "old", date, entryMode: "ai", attention: "此前主题", sourceUrl: "https://example.com", summary: "此前小结", inspiration: "", version: 1, imagePath: null, imageName: "", imageUrl: null, createdAt: `${date}T00:00:00Z`, updatedAt: `${date}T00:00:00Z` });
    mount(); await switchTo("ai");
    await waitFor(() => expect(screen.getByRole("heading", { name: "此前主题" })).toBeVisible());
    fireEvent.change(document.getElementById("inspiration")!, { target: { value: "生成时继续编辑的理解" } });
    await generate();
    const cancelButton = screen.getByRole("button", { name: "取消任务" });
    fireEvent.click(cancelButton);
    const dialog = screen.getByRole("dialog", { name: "取消将消耗 1 次额度" });
    expect(dialog).toHaveTextContent("今日生成开始后的 2 次免费取消已用完");
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "继续生成" })).toHaveFocus());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "取消将消耗 1 次额度" })).not.toBeInTheDocument();
    expect(api.requests).toEqual([]);
    fireEvent.click(cancelButton);
    fireEvent.click(screen.getByRole("button", { name: "确认取消并消耗 1 次额度" }));
    expect(screen.getByRole("button", { name: "正在取消…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "正在取消任务…" })).toBeDisabled();
    expect(api.requests).toEqual([true]);
    await act(async () => api.cancel());
    await waitFor(() => expect(screen.queryByText("本轮预览")).not.toBeInTheDocument());
    expect(screen.getByText("此前小结")).toBeVisible();
    expect(document.getElementById("inspiration")).toHaveValue("生成时继续编辑的理解");
    expect(screen.getByText(/任务已取消.*扣除 1 次.*剩余 0 次/)).toBeVisible();
    expect(api.saves()).toBe(0);
  });

  it("keeps generated success visible after the toast expires and distinguishes a later cloud save", async () => {
    const api = fixture(); mount(); await switchTo("ai"); await generate();
    api.succeed();
    // Success is observed on the next 1-second poll; leave time for its render too.
    await waitFor(() => expect(screen.getByRole("status", { name: "AI 提炼成功" })).toHaveTextContent("请审阅后保存"), { timeout: 2000 });
    expect(api.saves()).toBe(0);
    await waitFor(() => expect(screen.queryByText("AI 提炼成功，请审阅后保存。", { selector: ".light-toast" })).not.toBeInTheDocument(), { timeout: 4000 });
    expect(screen.getByRole("status", { name: "AI 提炼成功" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /完成打卡/ }));
    await waitFor(() => expect(screen.getByRole("status", { name: "AI 提炼成功" })).toHaveTextContent("内容已保存"));
    expect(api.saves()).toBe(1);
  });

  it("shows a dated toast while editing manual and displays success only with the AI draft", async () => {
    const api = fixture(); mount(); await switchTo("ai"); await generate();
    await switchTo("manual");
    fireEvent.change(document.getElementById("attention")!, { target: { value: "手动主题" } });
    fireEvent.change(document.getElementById("summary")!, { target: { value: "手动小结" } });
    api.succeed();
    await waitFor(() => expect(screen.getByText(`${formatDate(date)}的 AI 提炼成功，请切换到 AI 提炼审阅后保存。`)).toBeVisible(), { timeout: 2000 });
    expect(screen.queryByRole("status", { name: "AI 提炼成功" })).not.toBeInTheDocument();
    expect(document.getElementById("summary")).toHaveValue("手动小结");
    await waitFor(async () => expect(await loadDraft("feedback-user", date, "ai")).toMatchObject({ summary: "生成的知识小结" }));
    await switchTo("ai");
    await waitFor(() => expect(screen.getByRole("status", { name: "AI 提炼成功" })).toBeVisible());
    expect(screen.getByText("生成的知识小结")).toBeVisible();
    expect(api.saves()).toBe(0);
  });
});
