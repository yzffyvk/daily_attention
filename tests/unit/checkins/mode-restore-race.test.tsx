import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CheckInWorkspace } from "@/features/checkins/checkin-workspace";
import type { CheckInRecord } from "@/features/checkins/types";
import { deleteAttentionDraftDatabase, deleteDraft, loadDraft, saveDraft } from "@/lib/indexed-db/drafts";
import * as draftStore from "@/lib/indexed-db/drafts";
import { getTodayKey } from "@/features/checkins/dates";

vi.mock("canvas-confetti", () => ({ default: vi.fn() }));
vi.mock("@/features/checkins/image-note-uploader", () => ({
  ImageNoteUploader: ({ file, removeImage }: { file: File | null; removeImage: boolean }) => (
    <output aria-label="图片草稿状态">{file?.name ?? "none"}:{String(removeImage)}</output>
  ),
}));

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
  const pending = new Promise<Response>((resolve) => { complete = resolve; });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === "/api/ai/generations" && init?.method === "POST") return reply({
      jobId, status: "queued", pollAfterMs: 1,
      quota: { used: 1, reserved: 1, consumed: 0, limit: 5, remaining: 4 },
    }, 202);
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
  return { records, isPolling: () => polling, succeed: () => complete(reply({ jobId, status: "succeeded", stage: "complete", result: {
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
  fireEvent.click(screen.getByRole("button", { name: mode === "ai" ? /AI 提炼/ : /手动记录/ }));
  await waitFor(() => expect(screen.getByRole("button", { name: mode === "ai" ? /AI 提炼/ : /手动记录/ })).toHaveAttribute("aria-pressed", "true"));
  await waitFor(() => expect(screen.getByRole("button", { name: mode === "ai" ? /AI 提炼/ : /手动记录/ })).toBeEnabled());
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
});
afterEach(async () => { cleanup(); await deleteAttentionDraftDatabase(); vi.unstubAllGlobals(); });


it("preserves all AI reflections and its image when completion arrives during draft restoration", async () => {
 await saveDraft({
   userId: "mode-user", date, entryMode: "ai", attention: "待生成的 AI 主题",
   sourceUrl: "", summary: "", inspiration: "", imageBlob: new Blob(["AI image"], { type: "image/png" }),
   imageName: "ai-note.png", removeImage: false, uploadedImagePath: "checkin-images/mode-user/ai-pending.png",
   baseVersion: null, updatedAt: new Date().toISOString(),
 });
 const api = fixture(); mount();
 await waitFor(() => expect(screen.getByLabelText("今日知识主题")).toBeEnabled());
 edit("attention", "手动草稿主题");
 edit("summary", "手动草稿小结");
 edit("inspiration", "手动解释不受 AI 影响");
 await switchTo("ai");
 edit("inspiration", "AI 侧尚未保存的解释");
 fireEvent.click(screen.getByRole("tab", { name: "新的理解" }));
 edit("inspiration", "AI 侧新的理解");
 fireEvent.click(screen.getByRole("tab", { name: "有趣的思想点" }));
 edit("inspiration", "AI 侧有趣的思想点");
 fireEvent.click(screen.getByRole("tab", { name: "用自己的话解释" }));
 edit("source-url", "https://example.com/chapter");
 fireEvent.click(screen.getByRole("button", { name: "生成知识小结" }));
 await waitFor(() => expect(api.isPolling()).toBe(true));
 await switchTo("manual");
 const originalLoad = draftStore.loadDraft;
 let release!: () => void;
 let began = false;
 const gate = new Promise<void>(resolve => { release = resolve; });
 vi.spyOn(draftStore, "loadDraft").mockImplementation(async (user, target, mode) => {
   const value = await originalLoad(user, target, mode);
   if (mode === "ai" && !began) { began = true; await gate; }
   return value;
 });
 fireEvent.click(screen.getByRole("button", { name: /AI 提炼/ }));
 await waitFor(() => expect(began).toBe(true));
 await waitFor(() => expect(screen.getByRole("button", { name: /AI 提炼/ })).toHaveAttribute("aria-pressed", "true"));
 await act(async () => { api.succeed(); });
 await waitFor(() => expect(screen.getByRole("button", { name: "生成知识小结" })).toBeInTheDocument());
 await act(async () => { release(); });
 await waitFor(() => expect(screen.getByRole("button", { name: /AI 提炼/ })).toBeEnabled());
 await waitFor(() => expect(screen.getByRole("heading", { name: "AI 生成的主题" })).toBeVisible());
 expect(document.getElementById("inspiration")).toHaveValue("AI 侧尚未保存的解释");
 fireEvent.click(screen.getByRole("tab", { name: "新的理解" }));
 expect(document.getElementById("inspiration")).toHaveValue("AI 侧新的理解");
 fireEvent.click(screen.getByRole("tab", { name: "有趣的思想点" }));
 expect(document.getElementById("inspiration")).toHaveValue("AI 侧有趣的思想点");
 expect(screen.getByLabelText("图片草稿状态")).toHaveTextContent("ai-note.png:false");
 expect(screen.getByRole("button", { name: "生成知识小结" })).toBeEnabled();
 await waitFor(async () => {
   const stored = await loadDraft("mode-user", date, "ai");
   expect(stored?.activeAiJob).toBeUndefined();
   expect(stored?.imageName).toBe("ai-note.png");
   expect(stored?.imageBlob).not.toBeNull();
   expect(stored?.uploadedImagePath).toBe("checkin-images/mode-user/ai-pending.png");
 });
 await switchTo("manual");
 expect(screen.getByLabelText("今日知识主题")).toHaveValue("手动草稿主题");
 expect(document.getElementById("summary")).toHaveValue("手动草稿小结");
 expect(document.getElementById("inspiration")).toHaveValue("手动解释不受 AI 影响");
 expect(screen.getByLabelText("图片草稿状态")).toHaveTextContent("none:false");
 await switchTo("ai");
 expect(screen.getByRole("heading", { name: "AI 生成的主题" })).toBeVisible();
 expect(screen.getByRole("button", { name: "生成知识小结" })).toBeEnabled();
});

it("applies a queued result after an incoming read finds no local AI draft", async () => {
 const cloudAi = { ...saved("ai", "云端旧主题", "云端旧骨架"), inspiration: "已保存的 AI 解释" };
 const api = fixture({ ai: cloudAi }); mount();
 await waitFor(() => expect(screen.getByLabelText("今日知识主题")).toBeEnabled());
 edit("attention", "独立的手动主题");
 await switchTo("ai");
 edit("source-url", "https://example.com/chapter");
 fireEvent.click(screen.getByRole("button", { name: "生成知识小结" }));
 await waitFor(() => expect(api.isPolling()).toBe(true));
 await switchTo("manual");
 await deleteDraft("mode-user", date, "ai");
 const originalLoad = draftStore.loadDraft;
 let release!: () => void;
 let began = false;
 const gate = new Promise<void>(resolve => { release = resolve; });
 vi.spyOn(draftStore, "loadDraft").mockImplementation(async (user, target, mode) => {
   const value = await originalLoad(user, target, mode);
   if (mode === "ai" && !began) {
     expect(value).toBeUndefined();
     began = true;
     await gate;
   }
   return value;
 });
 fireEvent.click(screen.getByRole("button", { name: /AI 提炼/ }));
 await waitFor(() => expect(began).toBe(true));
 await act(async () => { api.succeed(); });
 await waitFor(() => expect(screen.getByRole("button", { name: "生成知识小结" })).toBeInTheDocument());
 await act(async () => { release(); });
 await waitFor(() => expect(screen.getByRole("button", { name: /AI 提炼/ })).toBeEnabled());
 await waitFor(() => expect(screen.getByRole("heading", { name: "AI 生成的主题" })).toBeVisible());
 expect(document.getElementById("inspiration")).toHaveValue("已保存的 AI 解释");
 expect(screen.getByRole("button", { name: "生成知识小结" })).toBeEnabled();
 await switchTo("manual");
 expect(screen.getByLabelText("今日知识主题")).toHaveValue("独立的手动主题");
});

it("serializes a completion behind the outgoing AI draft flush", async () => {
 const api = fixture(); mount();
 await waitFor(() => expect(screen.getByLabelText("今日知识主题")).toBeEnabled());
 edit("attention", "保留的手动主题");
 await switchTo("ai");
 edit("inspiration", "切换时保留的 AI 解释");
 edit("source-url", "https://example.com/chapter");
 fireEvent.click(screen.getByRole("button", { name: "生成知识小结" }));
 await waitFor(() => expect(api.isPolling()).toBe(true));
 const originalSave = draftStore.saveDraft;
 let release!: () => void;
 let began = false;
 const gate = new Promise<void>(resolve => { release = resolve; });
 vi.spyOn(draftStore, "saveDraft").mockImplementation(async (stored, options) => {
   await originalSave(stored, options);
   if (stored.entryMode === "ai" && !began) { began = true; await gate; }
 });
 fireEvent.click(screen.getByRole("button", { name: /手动记录/ }));
 await waitFor(() => expect(began).toBe(true));
 await act(async () => { api.succeed(); });
 await waitFor(() => expect(screen.getByRole("button", { name: "生成知识小结" })).toBeInTheDocument());
 await act(async () => { release(); });
 await waitFor(() => expect(screen.getByRole("button", { name: /手动记录/ })).toHaveAttribute("aria-pressed", "true"));
 await waitFor(() => expect(screen.getByRole("button", { name: /AI 提炼/ })).toBeEnabled());
 expect(screen.getByLabelText("今日知识主题")).toHaveValue("保留的手动主题");
 await waitFor(async () => expect(await loadDraft("mode-user", date, "ai")).toMatchObject({
   attention: "AI 生成的主题", inspiration: "切换时保留的 AI 解释",
 }));
 await switchTo("ai");
 expect(screen.getByRole("heading", { name: "AI 生成的主题" })).toBeVisible();
 expect(document.getElementById("inspiration")).toHaveValue("切换时保留的 AI 解释");
 expect(screen.getByRole("button", { name: "生成知识小结" })).toBeEnabled();
});
