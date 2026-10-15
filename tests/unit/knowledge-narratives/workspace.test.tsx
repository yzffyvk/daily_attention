import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { KnowledgeWorkspace } from "@/features/knowledge-narratives/knowledge-workspace";
import { NarrativeReader } from "@/features/knowledge-narratives/narrative-reader";
import { serializeLearningReflections } from "@/lib/domain/learning-reflections";
import type { KnowledgeNarrative, NarrativeResult, LegacyNarrativeResult } from "@/lib/domain/knowledge-narrative";
import { TestQueryProvider } from "@/tests/helpers/test-query-provider";

const dates = ["2026-08-31", "2026-09-02"];
const narrative: KnowledgeNarrative & { result: LegacyNarrativeResult } = {
  id: "saved-narrative", title: "从检索到应用", dates, question: "", status: "succeeded",
  createdAt: "2026-09-10T08:00:00Z", updatedAt: "2026-09-10T08:00:00Z", error: null,
  sources: dates.map(date => ({ date, attention: "检索学习", summary: "保存时的小结", inspiration: "进一步实践", version: 1, sourceUrl: "", hasImage: false })),
  changedDates: [dates[0]],
  result: { title: "从检索到应用", overview: "学习的主线", nodes: dates.map(date => ({ date, label: "理解检索", takeaway: "检索服务于实际问题" })),
    connections: [{ fromDate: dates[0], toDate: dates[1], relation: "应用", explanation: "把检索方法用于问答" }],
    sections: [{ title: "应用中的理解", body: "一段正文\n<script>不会执行</script>", sourceDates: dates }],
    framework: [{ title: "检索框架", body: "理解与验证", sourceDates: dates }], gaps: ["尚需评估"], nextSteps: ["做一次实验"] },
};

function mockApi({ history = false, uncertain = false, retryStatus = 0 } = {}) {
  const bodies: Array<{ dates: string[]; question: string; idempotencyKey: string }> = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    let data: unknown;
    if (path.startsWith("/api/checkins?")) {
      const month = new URL(path, "https://example.invalid").searchParams.get("month");
      data = dates.filter(date => date.startsWith(month!)).map(date => ({ date, attention: "检索学习", hasImage: false, version: 1, updatedAt: narrative.updatedAt }));
    } else if (init?.method === "POST") {
      bodies.push(JSON.parse(String(init.body)));
      if (uncertain && bodies.length === 1) throw new TypeError("connection lost");
      if (uncertain && retryStatus && bodies.length === 2) return new Response(JSON.stringify({ ok: false, error: { code: retryStatus === 429 ? "RATE_LIMITED" : "SESSION_EXPIRED", message: "稍后再试" }, requestId: "retry-rejected" }), { status: retryStatus });
      data = narrative;
    } else if (path.endsWith("/saved-narrative")) data = narrative;
    else data = history ? [narrative] : [];
    return new Response(JSON.stringify({ ok: true, data, requestId: "test" }), { status: init?.method === "POST" ? 202 : 200 });
  }));
  return bodies;
}

function mount() {
  return render(<TestQueryProvider><KnowledgeWorkspace today="2026-09-10" userId="test-user" onClose={vi.fn()} /></TestQueryProvider>);
}

afterEach(() => { cleanup(); sessionStorage.clear(); vi.unstubAllGlobals(); });

it("selects only AI saved records when entered from AI mode", async () => {
  let body: Record<string, unknown> | undefined;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") { body = JSON.parse(String(init.body)); return new Response(JSON.stringify({ ok: true, data: narrative, requestId: "ai-source" }), { status: 202 }); }
    if (String(input).endsWith("/saved-narrative")) return new Response(JSON.stringify({ ok: true, data: narrative, requestId: "ai-source" }));
    const data = String(input).startsWith("/api/checkins?") ? [
      { date: "2026-09-02", entryMode: "ai", attention: "AI 学习一", hasImage: false, version: 1, updatedAt: narrative.updatedAt },
      { date: "2026-09-03", entryMode: "ai", attention: "AI 学习二", hasImage: false, version: 1, updatedAt: narrative.updatedAt },
      { date: "2026-09-04", entryMode: "manual", attention: "手动学习", hasImage: false, version: 1, updatedAt: narrative.updatedAt },
    ] : [];
    return new Response(JSON.stringify({ ok: true, data, requestId: "ai-source" }));
  }));
  render(<TestQueryProvider><KnowledgeWorkspace today="2026-09-10" userId="test-user" entryMode="ai" onClose={vi.fn()} /></TestQueryProvider>);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "新增串联知识" }));
  expect(await screen.findByRole("button", { name: /9月4日/ })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: /9月2日，已保存/ }));
  await user.click(screen.getByRole("button", { name: /9月3日，已保存/ }));
  await user.click(screen.getByRole("button", { name: "生成知识脉络" }));
  await waitFor(() => expect(body).toMatchObject({ entryMode: "ai", dates: ["2026-09-02", "2026-09-03"] }));
});

it("reads all three reflections in a source snapshot without exposing their storage format", async () => {
  const reflections = { explanation: "我自己的解释", insights: "我的新理解", ideas: "值得探索的思想" };
  render(<NarrativeReader narrative={{ ...narrative, sources: narrative.sources.map(source => ({ ...source, inspiration: serializeLearningReflections(reflections) })) }} />);
  await userEvent.click(screen.getAllByRole("button", { name: "查看来源 2026-08-31" })[0]);
  const source = screen.getByRole("region", { name: "来源快照 2026-08-31" });
  for (const label of ["用自己的话解释", "新的理解", "有趣的思想点"]) expect(within(source).getByRole("heading", { name: label })).toBeVisible();
  for (const value of Object.values(reflections)) expect(within(source).getByText(value)).toBeVisible();
  expect(source).not.toHaveTextContent("learning-reflections:v1");
});

it("selects only saved dates, retains cross-month selection and removes selected dates", async () => {
  mockApi(); mount(); const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "新增串联知识" }));
  expect(await screen.findByRole("button", { name: "9月1日，暂无记录" })).toBeDisabled();
  const generate = screen.getByRole("button", { name: "生成知识脉络" });
  expect(generate).toBeDisabled();
  await user.click(screen.getByRole("button", { name: /9月2日，已保存/ }));
  expect(generate).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "上个月" }));
  await user.click(await screen.findByRole("button", { name: /8月31日，已保存/ }));
  expect(generate).toBeEnabled();
  expect(within(screen.getByLabelText("已选日期")).getAllByRole("button")).toHaveLength(2);
  await user.click(screen.getByRole("button", { name: "移除 2026-09-02" }));
  expect(generate).toBeDisabled();
});

it("reuses an uncertain request key, generates from sorted saved dates and reveals source citations as text", async () => {
  const bodies = mockApi({ uncertain: true }); mount(); const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "新增串联知识" }));
  await user.click(await screen.findByRole("button", { name: /9月2日，已保存/ }));
  await user.click(screen.getByRole("button", { name: "上个月" }));
  await user.click(await screen.findByRole("button", { name: /8月31日，已保存/ }));
  await user.type(screen.getByLabelText("想探索的问题（可选）"), "如何应用？");
  await user.click(screen.getByRole("button", { name: "生成知识脉络" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("网络连接失败");
  await user.click(screen.getByRole("button", { name: "重试生成请求" }));
  await screen.findByRole("heading", { name: "从检索到应用" });
  expect(bodies).toHaveLength(2); expect(bodies[1]).toEqual(bodies[0]);
  expect(bodies[0]).toMatchObject({ dates, question: "如何应用？" });
  expect(screen.getByText("把检索方法用于问答")).toBeVisible();
  expect(screen.getByText(/一段正文/)).toHaveTextContent("<script>不会执行</script>");
  await user.click(screen.getAllByRole("button", { name: "查看来源 2026-08-31" })[0]);
  expect(screen.getByRole("region", { name: "来源快照 2026-08-31" })).toHaveTextContent("保存时的小结");
  expect(screen.getByText(/来源记录已有更新/)).toBeVisible();
});

it("discovers saved work on a fresh mount and opens its saved result", async () => {
  mockApi({ history: true }); mount();
  await userEvent.click(await screen.findByRole("button", { name: /打开知识脉络 从检索到应用/ }));
  await waitFor(() => expect(screen.getByRole("heading", { name: "从检索到应用" })).toBeVisible());
});

it.each([429, 401])("preserves the unresolved request identity after a %i rejection of a network retry", async (retryStatus) => {
  const bodies = mockApi({ uncertain: true, retryStatus }); mount(); const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "新增串联知识" }));
  await user.click(await screen.findByRole("button", { name: /9月2日，已保存/ }));
  await user.click(screen.getByRole("button", { name: "上个月" }));
  await user.click(await screen.findByRole("button", { name: /8月31日，已保存/ }));
  await user.click(screen.getByRole("button", { name: "生成知识脉络" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("网络连接失败");
  await user.click(screen.getByRole("button", { name: "重试生成请求" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("稍后再试");
  await user.click(screen.getByRole("button", { name: "重试生成请求" }));
  await screen.findByRole("heading", { name: "从检索到应用" });
  expect(bodies).toHaveLength(3);
  expect(bodies[1]).toEqual(bodies[0]);
  expect(bodies[2]).toEqual(bodies[0]);
});

it.each(["persisted", "in-memory"])("uses a fresh identity for explicit history regeneration with a %s unresolved request", async (recovery) => {
  const storedKey = "10000000-0000-4000-8000-000000000001";
  const bodies = mockApi({ history: true, uncertain: recovery === "in-memory" });
  if (recovery === "persisted") sessionStorage.setItem("knowledge-request:test-user", JSON.stringify({ dates, question: "", idempotencyKey: storedKey }));
  mount(); const user = userEvent.setup();
  if (recovery === "in-memory") {
    await user.click(screen.getByRole("button", { name: "新增串联知识" }));
    await user.click(await screen.findByRole("button", { name: /9月2日，已保存/ }));
    await user.click(screen.getByRole("button", { name: "上个月" }));
    await user.click(await screen.findByRole("button", { name: /8月31日，已保存/ }));
    await user.click(screen.getByRole("button", { name: "生成知识脉络" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("网络连接失败");
    await user.click(screen.getByRole("button", { name: "返回脉络列表" }));
  }
  await user.click(await screen.findByRole("button", { name: /打开知识脉络 从检索到应用/ }));
  await user.click(await screen.findByRole("button", { name: "重新生成" }));
  await user.click(screen.getByRole("button", { name: "生成知识脉络" }));
  await screen.findByRole("heading", { name: "从检索到应用" });
  expect(bodies).toHaveLength(recovery === "persisted" ? 1 : 2);
  expect(bodies.at(-1)?.dates).toEqual(dates);
  expect(bodies.at(-1)?.idempotencyKey).not.toBe(recovery === "persisted" ? storedKey : bodies[0].idempotencyKey);
});

it("polls a persisted queued job until its saved result is ready", async () => {
  let reads = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    const queued = { ...narrative, status: "queued", result: null };
    const data = path.includes("/api/checkins?") ? [] : path.endsWith("/saved-narrative") ? (++reads > 1 ? narrative : queued) : [queued];
    return new Response(JSON.stringify({ ok: true, data, requestId: "poll" }));
  }));
  mount();
  await userEvent.click(await screen.findByRole("button", { name: /打开知识脉络 从检索到应用/ }));
  expect(await screen.findByRole("heading", { name: "等待生成" })).toBeVisible();
  await waitFor(() => expect(screen.getByText("学习的主线")).toBeVisible(), { timeout: 4500 });
  expect(reads).toBeGreaterThanOrEqual(2);
});

function mockLibrary({ editConflict = false, copyUncertain = false, deleteFailure = false, deleteMissing = false, deleteGate, detailGate, items = [narrative] }: {
  editConflict?: boolean; copyUncertain?: boolean; deleteFailure?: boolean; deleteMissing?: boolean; deleteGate?: Promise<void>; detailGate?: Promise<void>; items?: KnowledgeNarrative[];
} = {}) {
  let saved = structuredClone(items);
  let detailReads = 0;
  const edits: Array<{ result: NarrativeResult; expectedUpdatedAt: string }> = [];
  const copies: Array<{ idempotencyKey: string }> = [];
  const deletes: string[] = [];
  const generations: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    const id = path.split("/")[3];
    let data: unknown;
    if (path.startsWith("/api/checkins?")) data = [];
    else if (init?.method === "PATCH") {
      const body = JSON.parse(String(init.body)); edits.push(body);
      if (editConflict && edits.length === 1) return new Response(JSON.stringify({ ok: false, requestId: "edit-conflict", error: { code: "NARRATIVE_EDIT_CONFLICT", message: "这条脉络已在其他页面更新，请保留当前修改并重新打开后编辑" } }), { status: 409 });
      saved = saved.map(item => item.id === id ? { ...item, title: body.result.title, result: body.result, updatedAt: "2026-09-10T09:00:00Z" } : item);
      data = saved.find(item => item.id === id);
    } else if (path.endsWith("/copy")) {
      copies.push(JSON.parse(String(init?.body)));
      if (copyUncertain && copies.length === 1) throw new TypeError("connection lost");
      const count = saved.length;
      const original = saved.find(item => item.id === id)!;
      const title = `${original.title} ${count === 1 ? "" : `${count} `}cp`;
      data = { ...structuredClone(original), id: `copy-${count}`, title, result: { ...original.result, title } };
      saved.unshift(data as KnowledgeNarrative);
    } else if (init?.method === "DELETE") {
      deletes.push(id);
      if (deleteGate) await deleteGate;
      if (deleteMissing) {
        saved = saved.filter(item => item.id !== id);
        return new Response(JSON.stringify({ ok: false, requestId: "already-deleted", error: { code: "NARRATIVE_NOT_FOUND", message: "这条知识脉络不存在" } }), { status: 404 });
      }
      if (deleteFailure && deletes.length === 1) return new Response(JSON.stringify({ ok: false, requestId: "delete-failure", error: { code: "TEMPORARY_ERROR", message: "删除暂时失败，请重试" } }), { status: 503 });
      saved = saved.filter(item => item.id !== id); data = { id };
    } else if (init?.method === "POST") { generations.push(path); data = narrative; }
    else {
      data = id ? saved.find(item => item.id === id) : saved;
      if (id && detailGate && ++detailReads === 2) {
        const snapshot = structuredClone(data);
        await detailGate;
        data = snapshot;
      }
    }
    return new Response(JSON.stringify({ ok: true, data, requestId: "library" }), { status: path.endsWith("/copy") ? 201 : 200 });
  }));
  return { edits, copies, deletes, generations };
}

it("opens with the saved list and offers creation separately, including an empty-state action", async () => {
  mockLibrary({ items: [] }); mount(); const user = userEvent.setup();
  expect(await screen.findByText("还没有知识脉络")).toBeVisible();
  expect(screen.queryByLabelText("想探索的问题（可选）")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "新增串联知识" }));
  expect(screen.getByLabelText("想探索的问题（可选）")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "返回脉络列表" }));
  expect(await screen.findByText("还没有知识脉络")).toBeVisible();
});

it("shows every status, date count and creation date, and only finished rows support editing and copying", async () => {
  mockLibrary({ items: [narrative, { ...narrative, id: "queued", title: "等待中的脉络", status: "queued", result: null }, { ...narrative, id: "generating", title: "生成中的脉络", status: "generating", result: null }, { ...narrative, id: "failed", title: "失败的脉络", status: "failed", result: null }] });
  mount();
  const library = await screen.findByRole("region", { name: "已保存的脉络" });
  expect(await within(library).findAllByRole("listitem")).toHaveLength(4);
  expect(within(library).getAllByText("2 天")).toHaveLength(4);
  expect(within(library).getAllByText("2026-09-10")).toHaveLength(4);
  expect(within(library).getAllByRole("button", { name: /^编辑 / })).toHaveLength(1);
  expect(within(library).getAllByRole("button", { name: /^复制 / })).toHaveLength(1);
  expect(within(library).getAllByRole("button", { name: /^删除 / })).toHaveLength(4);
});

it("edits all narrative text while preserving dates, citations and source snapshots without generation", async () => {
  const api = mockLibrary(); mount(); const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "编辑 从检索到应用" }));
  const replacements = { "脉络名称": "我的检索框架", "总览": "更新的学习主线", "2026-08-31 节点标签": "理解证据", "2026-08-31 节点要点": "证据先于答案", "联系 1 说明": "由证据进入实践", "叙事章节 1 标题": "证据的作用", "叙事章节 1 正文": "新的章节正文", "知识框架 1 标题": "检索与证据", "知识框架 1 正文": "新的框架正文", "待探索问题 1": "如何验证？", "下一步 1": "执行验证实验" };
  for (const [label, text] of Object.entries(replacements)) {
    await user.clear(await screen.findByLabelText(label));
    await user.type(screen.getByLabelText(label), text);
  }
  await user.selectOptions(screen.getByLabelText("联系 1 关系"), "递进");
  await user.click(screen.getByRole("button", { name: "保存修改" }));
  expect(await screen.findByRole("heading", { name: "我的检索框架" })).toBeVisible();
  expect(screen.getByText("更新的学习主线")).toBeVisible();
  expect(screen.getByText("新的章节正文")).toBeVisible();
  expect(api.edits).toHaveLength(1);
  expect(api.edits[0]).toMatchObject({ expectedUpdatedAt: "2026-09-10T08:00:00Z", result: {
    title: "我的检索框架", overview: "更新的学习主线", nodes: [{ date: dates[0], label: "理解证据", takeaway: "证据先于答案" }, narrative.result!.nodes[1]],
    connections: [{ fromDate: dates[0], toDate: dates[1], relation: "递进", explanation: "由证据进入实践" }],
    sections: [{ title: "证据的作用", body: "新的章节正文", sourceDates: dates }], framework: [{ title: "检索与证据", body: "新的框架正文", sourceDates: dates }],
    gaps: ["如何验证？"], nextSteps: ["执行验证实验"],
  } });
  await user.click(screen.getAllByRole("button", { name: "查看来源 2026-08-31" })[0]);
  expect(screen.getByRole("region", { name: "来源快照 2026-08-31" })).toHaveTextContent("保存时的小结");
  expect(api.generations).toHaveLength(0);
  await user.click(screen.getByRole("button", { name: "重新生成" }));
  expect(screen.getByRole("button", { name: "生成知识脉络" })).toBeEnabled();
});

it("retains local inputs and the original revision on a conflict, then saves on explicit retry", async () => {
  const api = mockLibrary({ editConflict: true }); mount(); const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "编辑 从检索到应用" }));
  await user.clear(await screen.findByLabelText("总览")); await user.type(screen.getByLabelText("总览"), "尚未保存的理解");
  await user.click(screen.getByRole("button", { name: "保存修改" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("这条脉络已在其他页面更新");
  expect(screen.getByLabelText("总览")).toHaveValue("尚未保存的理解");
  await user.click(screen.getByRole("button", { name: "保存修改" }));
  expect(await screen.findByText("尚未保存的理解")).toBeVisible();
  expect(api.edits[1]).toEqual(api.edits[0]);
});

it("guards dirty edits on cancel, internal navigation and browser unload; discarding returns to the list", async () => {
  const api = mockLibrary(); mount(); const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "编辑 从检索到应用" }));
  await user.type(await screen.findByLabelText("总览"), "未保存");
  await waitFor(() => {
    const unload = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
  });
  await user.click(screen.getByRole("button", { name: "取消编辑" }));
  const dialog = screen.getByRole("dialog", { name: "放弃未保存的修改？" });
  await user.click(within(dialog).getByRole("button", { name: "继续编辑" }));
  expect(screen.getByLabelText("总览")).toHaveValue("学习的主线未保存");
  await user.click(screen.getByRole("button", { name: "返回脉络列表" }));
  await user.click(screen.getByRole("button", { name: "放弃修改" }));
  expect(await screen.findByRole("region", { name: "已保存的脉络" })).toBeVisible();
  expect(api.edits).toHaveLength(0);
  const cleanUnload = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(cleanUnload);
  expect(cleanUnload.defaultPrevented).toBe(false);
});

it("keeps an uncertain copy key for retry, then creates a fresh independent copy with each new intent", async () => {
  const api = mockLibrary({ copyUncertain: true }); mount(); const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "复制 从检索到应用" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("网络连接失败");
  await user.click(screen.getByRole("button", { name: "复制 从检索到应用" }));
  expect(await screen.findByRole("button", { name: /打开知识脉络 从检索到应用 cp/ })).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("已复制为「从检索到应用 cp」");
  await user.click(screen.getByRole("button", { name: "复制 从检索到应用" }));
  expect(await screen.findByRole("button", { name: /打开知识脉络 从检索到应用 2 cp/ })).toBeVisible();
  expect(api.copies).toHaveLength(3);
  expect(api.copies[1].idempotencyKey).toBe(api.copies[0].idempotencyKey);
  expect(api.copies[2].idempotencyKey).not.toBe(api.copies[0].idempotencyKey);
  expect(api.generations).toHaveLength(0);
});

it("requires accessible deletion confirmation, supports cancellation and preserves retry after failure", async () => {
  let finish!: () => void;
  const deleteGate = new Promise<void>(resolve => { finish = resolve; });
  const api = mockLibrary({ deleteFailure: true, deleteGate }); mount(); const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "删除 从检索到应用" }));
  let dialog = screen.getByRole("dialog", { name: "删除知识脉络？" });
  expect(dialog).toHaveTextContent("删除后不可恢复");
  expect(within(dialog).getByRole("button", { name: "取消" })).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "删除 从检索到应用" })).toHaveFocus();
  expect(api.deletes).toHaveLength(0);
  await user.keyboard("{Enter}");
  dialog = screen.getByRole("dialog", { name: "删除知识脉络？" });
  await user.click(within(dialog).getByRole("button", { name: "确认删除" }));
  expect(within(dialog).getByRole("button", { name: "正在删除…" })).toBeDisabled();
  expect(dialog).toHaveFocus();
  finish();
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("删除暂时失败，请重试");
  await waitFor(() => expect(within(dialog).getByRole("button", { name: "取消" })).toHaveFocus());
  await user.tab({ shift: true });
  expect(dialog.contains(document.activeElement)).toBe(true);
  await user.tab();
  expect(dialog.contains(document.activeElement)).toBe(true);
  await user.click(within(dialog).getByRole("button", { name: "确认删除" }));
  expect(await screen.findByText("还没有知识脉络")).toBeVisible();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(api.deletes).toEqual(["saved-narrative", "saved-narrative"]);
});

it("warns that deleting an active generation will not retain its result", async () => {
  mockLibrary({ items: [{ ...narrative, status: "generating", result: null }] }); mount(); const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "删除 从检索到应用" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("生成结果也不会保留");
});

it("uses a new generation identity when a failed request is followed by explicit new creation", async () => {
  const bodies = mockApi({ uncertain: true }); mount(); const user = userEvent.setup();
  for (let attempt = 0; attempt < 2; attempt++) {
    await user.click(screen.getByRole("button", { name: "新增串联知识" }));
    if (attempt === 0) {
      await user.click(await screen.findByRole("button", { name: /9月2日，已保存/ }));
      await user.click(screen.getByRole("button", { name: "上个月" }));
      await user.click(await screen.findByRole("button", { name: /8月31日，已保存/ }));
    } else {
      await user.click(await screen.findByRole("button", { name: /8月31日，已保存/ }));
      await user.click(screen.getByRole("button", { name: "下个月" }));
      await user.click(await screen.findByRole("button", { name: /9月2日，已保存/ }));
    }
    await user.click(screen.getByRole("button", { name: "生成知识脉络" }));
    if (attempt === 0) {
      expect(await screen.findByRole("alert")).toHaveTextContent("网络连接失败");
      await user.click(screen.getByRole("button", { name: "返回脉络列表" }));
    }
  }
  expect(await screen.findByRole("heading", { name: "从检索到应用" })).toBeVisible();
  expect(bodies).toHaveLength(2);
  expect(bodies[0].dates).toEqual(bodies[1].dates);
  expect(bodies[0].idempotencyKey).not.toBe(bodies[1].idempotencyKey);
});

it("prevents repeated deletion or closing while confirmation is being submitted", async () => {
  let finish!: () => void;
  const deleteGate = new Promise<void>(resolve => { finish = resolve; });
  const api = mockLibrary({ deleteGate }); mount(); const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "删除 从检索到应用" }));
  await user.dblClick(screen.getByRole("button", { name: "确认删除" }));
  expect(screen.getByRole("button", { name: "正在删除…" })).toBeDisabled();
  expect(within(screen.getByRole("dialog")).getByRole("button", { name: "取消" })).toBeDisabled();
  await user.tab();
  expect(screen.getByRole("dialog")).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(screen.getByRole("dialog")).toBeVisible();
  expect(api.deletes).toEqual(["saved-narrative"]);
  finish();
  expect(await screen.findByText("还没有知识脉络")).toBeVisible();
});

it("treats an already deleted response as successful recovery and removes the stale row", async () => {
  mockLibrary({ deleteMissing: true }); mount(); const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "删除 从检索到应用" }));
  await user.click(screen.getByRole("button", { name: "确认删除" }));
  expect(await screen.findByText("还没有知识脉络")).toBeVisible();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("keeps a saved edit when an older detail read arrives after the successful patch", async () => {
  let finish!: () => void;
  const detailGate = new Promise<void>(resolve => { finish = resolve; });
  mockLibrary({ detailGate });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><KnowledgeWorkspace today="2026-09-10" userId="test-user" onClose={vi.fn()} /></QueryClientProvider>);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "编辑 从检索到应用" }));
  await user.clear(await screen.findByLabelText("总览"));
  await user.type(screen.getByLabelText("总览"), "刚保存的新理解");
  const queryKey = ["knowledge-narrative", "test-user", "saved-narrative"];
  await act(async () => { void client.refetchQueries({ queryKey }); });
  await waitFor(() => expect(client.getQueryState(queryKey)?.fetchStatus).toBe("fetching"));
  await user.click(screen.getByRole("button", { name: "保存修改" }));
  expect(await screen.findByText("刚保存的新理解")).toBeVisible();
  await act(async () => { finish(); await detailGate; });
  await waitFor(() => expect(client.getQueryState(queryKey)?.fetchStatus).toBe("idle"));
  expect(screen.getByText("刚保存的新理解")).toBeVisible();
  expect(client.getQueryData<KnowledgeNarrative>(queryKey)?.updatedAt).toBe("2026-09-10T09:00:00Z");
});
