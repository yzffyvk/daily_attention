import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CheckInWorkspace } from "@/features/checkins/checkin-workspace";
import type { CheckInRecord } from "@/features/checkins/types";
import { deleteAttentionDraftDatabase, loadDraft } from "@/lib/indexed-db/drafts";
import { getTodayKey } from "@/features/checkins/dates";

vi.mock("canvas-confetti", () => ({ default: vi.fn() }));

const date = getTodayKey();
const jobId = "10000000-0000-4000-8000-000000000002";
type Mode = "manual" | "ai";

function reply(data: unknown, status = 200) {
  return new Response(JSON.stringify({ ok: true, data, requestId: "mode-fixture" }), {
    status, headers: { "Content-Type": "application/json" },
  });
}

function missing() {
  return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: "暂无记录" }, requestId: "mode-fixture" }), {
    status: 404, headers: { "Content-Type": "application/json" },
  });
}

function saved(mode: Mode, attention: string, summary = ""): CheckInRecord {
  return { id: `record-${mode}`, date, entryMode: mode, attention, sourceUrl: "", summary, inspiration: "",
    imagePath: null, imageName: "", imageUrl: null, version: 1,
    createdAt: `${date}T00:00:00Z`, updatedAt: `${date}T00:00:00Z` };
}

function fixture(initial: Partial<Record<Mode, CheckInRecord>> = {}) {
  const records = new Map<Mode, CheckInRecord>(Object.entries(initial) as [Mode, CheckInRecord][]);
  let complete!: (value: Response) => void;
  let polling = false;
  let submittedPrompt = "";
  const generationContext = () => ({ userPrompt: submittedPrompt, promptVersion: "knowledge-skeleton-user-prompt-v1" });
  const pending = new Promise<Response>((resolve) => { complete = resolve; });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === "/api/ai/generations" && init?.method === "POST") {
      submittedPrompt = JSON.parse(init.body as string).userPrompt ?? "";
      return reply({
      jobId, status: "queued", pollAfterMs: 1,
      generationContext: generationContext(),
      quota: { used: 1, reserved: 1, consumed: 0, limit: 5, remaining: 4 },
    }, 202);
    }
    if (url.pathname === `/api/ai/generations/${jobId}`) { polling = true; return pending; }
    if (url.pathname === `/api/checkins/${date}`) {
      if (init?.method === "PUT") {
        const body = JSON.parse(init.body as string);
        const mode: Mode = body.entryMode ?? "manual";
        const previous = records.get(mode);
        records.set(mode, { ...saved(mode, body.attention), ...body, version: (previous?.version ?? 0) + 1, updatedAt: new Date().toISOString() });
        return reply(records.get(mode));
      }
      const mode: Mode = url.searchParams.get("mode") === "ai" ? "ai" : "manual";
      return records.has(mode) ? reply(records.get(mode)) : missing();
    }
    if (url.pathname === "/api/checkins") return reply([...records.values()].map((record) => ({ ...record, hasImage: false })));
    if (url.pathname === "/api/checkins/stats") return reply({ totalCount: records.size ? 1 : 0, currentStreak: records.size ? 1 : 0, hasTodayRecord: records.size > 0 });
    if (url.pathname === "/api/me") return reply({ profile: null });
    return reply([]);
  }));
  return { records, isPolling: () => polling, succeed: () => complete(reply({ jobId, status: "succeeded", stage: "complete", generationContext: generationContext(), result: {
    attention: "AI 生成的主题", summary: "AI 独立的知识骨架", inspiration: "", sourceTitle: "文章", warnings: [],
  } })) };
}

function mount(userId: string | null = "mode-user") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><CheckInWorkspace initialDate={date} initialToday={date} userId={userId} /></QueryClientProvider>);
}

function edit(id: string, value: string) {
  fireEvent.change(document.getElementById(id)!, { target: { value } });
}

async function switchTo(mode: Mode) {
  await waitFor(() => expect(screen.getByRole("button", { name: mode === "ai" ? /AI 提炼/ : /手动记录/ })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: mode === "ai" ? /AI 提炼/ : /手动记录/ }));
  await waitFor(() => expect(screen.getByRole("button", { name: mode === "ai" ? /AI 提炼/ : /手动记录/ })).toHaveAttribute("aria-pressed", "true"));
  await waitFor(() => expect(screen.getByRole("button", { name: mode === "ai" ? /AI 提炼/ : /手动记录/ })).toBeEnabled());
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
});
afterEach(async () => { cleanup(); await deleteAttentionDraftDatabase(); vi.unstubAllGlobals(); });

describe("manual and AI record isolation", () => {
  it("saves edited requirements separately from the requirements used by the result and restores both", async () => {
    const api = fixture(); mount();
    await waitFor(() => expect(screen.getByLabelText("今日知识主题")).toBeEnabled());
    await switchTo("ai"); edit("source-url", "https://example.com/article");
    fireEvent.click(screen.getByRole("button", { name: /提炼要求/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "提炼要求" }), { target: { value: "解释使用边界" } });
    fireEvent.click(screen.getByRole("button", { name: "生成知识小结" }));
    await waitFor(() => expect(api.isPolling()).toBe(true));
    expect(screen.getByRole("textbox", { name: "提炼要求" })).toBeDisabled();
    await act(async () => api.succeed());
    await waitFor(() => expect(screen.getByRole("textbox", { name: "提炼要求" })).toBeEnabled());
    fireEvent.change(screen.getByRole("textbox", { name: "提炼要求" }), { target: { value: "下次重点讲实现" } });
    expect(screen.getByText(/修改后重新提炼生效/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /完成打卡/ }));
    await waitFor(() => expect(api.records.get("ai")).toMatchObject({
      userPrompt: "下次重点讲实现", summary: "AI 独立的知识骨架",
      aiGenerationContext: { userPrompt: "解释使用边界", promptVersion: "knowledge-skeleton-user-prompt-v1" },
    }));
    await waitFor(() => expect(screen.getByRole("button", { name: /手动记录/ })).toBeEnabled());
    await switchTo("manual");
    expect(screen.queryByRole("textbox", { name: "提炼要求" })).not.toBeInTheDocument();
    cleanup(); mount(); await waitFor(() => expect(screen.getByLabelText("今日知识主题")).toBeEnabled());
    await switchTo("ai");
    await waitFor(() => expect(screen.getByRole("textbox", { name: "提炼要求" })).toHaveValue("下次重点讲实现"));
    expect(screen.getByText("解释使用边界")).toBeInTheDocument();
  });
  it("preserves both unsaved drafts when switching before the autosave delay", async () => {
    fixture(); mount();
    await waitFor(() => expect(screen.getByLabelText("今日知识主题")).toBeEnabled());
    edit("attention", "手动主题"); edit("summary", "手动的小结"); edit("inspiration", "手动的解释");
    await switchTo("ai");
    expect(screen.getByLabelText("今日知识主题")).toHaveValue("");
    expect(document.getElementById("inspiration")).toHaveValue("");
    edit("attention", "AI 侧主题"); edit("inspiration", "AI 侧的解释");
    await switchTo("manual");
    expect(screen.getByLabelText("今日知识主题")).toHaveValue("手动主题");
    expect(document.getElementById("summary")).toHaveValue("手动的小结");
    expect(document.getElementById("inspiration")).toHaveValue("手动的解释");
    await switchTo("ai");
    expect(screen.getByLabelText("今日知识主题")).toHaveValue("AI 侧主题");
    expect(document.getElementById("inspiration")).toHaveValue("AI 侧的解释");
  });

  it("saves and restores two same-day cloud records independently", async () => {
    const api = fixture(); mount();
    await waitFor(() => expect(screen.getByLabelText("今日知识主题")).toBeEnabled());
    edit("attention", "手动已保存主题"); edit("summary", "手动已保存小结");
    fireEvent.click(screen.getByRole("button", { name: /完成打卡/ }));
    await waitFor(() => expect(api.records.get("manual")?.summary).toBe("手动已保存小结"));
    await waitFor(() => expect(screen.getByRole("button", { name: /AI 提炼/ })).toBeEnabled());
    await switchTo("ai"); edit("attention", "AI 已保存主题"); edit("inspiration", "AI 已保存解释");
    fireEvent.click(screen.getByRole("button", { name: /完成打卡/ }));
    await waitFor(() => expect(api.records.get("ai")?.attention).toBe("AI 已保存主题"));
    expect(api.records.get("manual")?.summary).toBe("手动已保存小结");
    cleanup(); mount();
    await waitFor(() => expect(screen.getByLabelText("今日知识主题")).toHaveValue("手动已保存主题"));
    await switchTo("ai");
    await waitFor(() => expect(screen.getByLabelText("今日知识主题")).toHaveValue("AI 已保存主题"));
    expect(document.getElementById("inspiration")).toHaveValue("AI 已保存解释");
  });

  it("routes a late AI result into the AI draft while editing manual on the same date", async () => {
    const api = fixture(); mount();
    await waitFor(() => expect(screen.getByLabelText("今日知识主题")).toBeEnabled());
    edit("attention", "手动主题"); edit("summary", "手动原文"); edit("inspiration", "手动收获");
    await switchTo("ai"); edit("source-url", "https://example.com/chapter");
    fireEvent.click(screen.getByRole("button", { name: /提炼要求/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "提炼要求" }), { target: { value: "解释边界与前提" } });
    fireEvent.click(screen.getByRole("button", { name: "生成知识小结" }));
    await waitFor(() => expect(api.isPolling()).toBe(true));
    await switchTo("manual"); edit("summary", "生成期间继续写的手动原文");
    await act(async () => { api.succeed(); });
    await waitFor(async () => expect(await loadDraft("mode-user", date, "ai")).toMatchObject({
      attention: "AI 生成的主题", userPrompt: "解释边界与前提",
      aiGenerationContext: { userPrompt: "解释边界与前提", promptVersion: "knowledge-skeleton-user-prompt-v1" },
    }));
    expect(screen.getByLabelText("今日知识主题")).toHaveValue("手动主题");
    expect(document.getElementById("summary")).toHaveValue("生成期间继续写的手动原文");
    expect(document.getElementById("inspiration")).toHaveValue("手动收获");
    await switchTo("ai");
    await waitFor(() => expect(screen.getByRole("heading", { name: "AI 生成的主题" })).toBeVisible());
    expect(screen.getByText("AI 独立的知识骨架")).toBeVisible();
    expect(screen.getByRole("textbox", { name: "提炼要求" })).toHaveValue("解释边界与前提");
    cleanup(); mount(); await waitFor(() => expect(screen.getByLabelText("今日知识主题")).toBeEnabled());
    await switchTo("ai");
    await waitFor(() => expect(screen.getByRole("textbox", { name: "提炼要求" })).toHaveValue("解释边界与前提"));
    expect(screen.getByText("解释边界与前提", { selector: ".ai-prompt-history p" })).toBeInTheDocument();
  });
});
