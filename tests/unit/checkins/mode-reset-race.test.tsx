import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CheckInWorkspace } from "@/features/checkins/checkin-workspace";
import type { CheckInRecord } from "@/features/checkins/types";
import { deleteAttentionDraftDatabase } from "@/lib/indexed-db/drafts";
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


import * as draftStore from "@/lib/indexed-db/drafts";
it("keeps reset effective when switching modes while draft deletion is pending", async () => {
 fixture(); mount();
 await waitFor(() => expect(screen.getByLabelText("今日知识主题")).toBeEnabled());
 edit("attention", "应该还原的手动内容");
 await switchTo("ai"); await switchTo("manual");
 const originalDelete = draftStore.deleteDraft;
 let release!: () => void;
 let began = false;
 const gate = new Promise<void>(resolve => { release = resolve; });
 vi.spyOn(draftStore, "deleteDraft").mockImplementation(async (user, target, mode) => {
   await originalDelete(user, target, mode);
   if (mode === "manual" && !began) { began = true; await gate; }
 });
 fireEvent.click(screen.getByRole("button", { name: "还原未保存的修改" }));
 await waitFor(() => expect(began).toBe(true));
 expect(screen.getByRole("button", { name: /AI 提炼/ })).toBeDisabled();
 fireEvent.click(screen.getByRole("button", { name: /AI 提炼/ }));
 expect(screen.getByRole("button", { name: /手动记录/ })).toHaveAttribute("aria-pressed", "true");
 await act(async () => { release(); });
 await waitFor(() => expect(screen.getByRole("button", { name: /AI 提炼/ })).toBeEnabled());
 await switchTo("ai");
 await switchTo("manual");
 expect(screen.getByLabelText("今日知识主题")).toHaveValue("");
});
