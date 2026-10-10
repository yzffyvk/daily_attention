import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { NarrativeEditor } from "@/features/knowledge-narratives/narrative-editor";
import { TestQueryProvider } from "@/tests/helpers/test-query-provider";
import { knowledgeMapFixture, knowledgeMapSourcesFixture, mapDates, sourceRecordsFixture } from "@/tests/helpers/knowledge-map-fixtures";
import type { KnowledgeNarrative } from "@/lib/domain/knowledge-narrative";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function mount(result: KnowledgeNarrative["result"]) {
  const narrative: KnowledgeNarrative = { id: "map", title: result!.title, dates: mapDates, question: "", status: "succeeded", sources: knowledgeMapSourcesFixture(), result, changedDates: [], error: null, createdAt: "2026-09-17T10:00:00Z", updatedAt: "2026-09-17T10:00:00Z" };
  const onSaved = vi.fn();
  render(<TestQueryProvider><NarrativeEditor narrative={narrative} onSaved={onSaved} onCancel={vi.fn()} onDirtyChange={vi.fn()} onSavingChange={vi.fn()} /></TestQueryProvider>);
  return { narrative, onSaved };
}

it("edits concept explanations and speaking steps while keeping provenance and graph references", async () => {
  let body: Record<string, unknown> | undefined;
  vi.stubGlobal("fetch", vi.fn(async (_input, init) => {
    body = JSON.parse(init.body);
    return Response.json({ ok: true, data: { id: "map", result: body!.result }, requestId: "edit" });
  }));
  const { onSaved } = mount(knowledgeMapFixture());
  const user = userEvent.setup();
  await user.clear(screen.getByLabelText("概念 1 解释"));
  await user.type(screen.getByLabelText("概念 1 解释"), "我的理解：先问具体发生过的事情。");
  await user.clear(screen.getByLabelText("表达步骤 2 内容"));
  await user.type(screen.getByLabelText("表达步骤 2 内容"), "用测试结果检验假设，再解释如何调整方案。");
  await user.click(screen.getByRole("button", { name: "保存修改" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(body).toMatchObject({ expectedUpdatedAt: "2026-09-17T10:00:00Z", result: {
    mode: "concept_map", concepts: expect.arrayContaining([
      expect.objectContaining({ id: "interview", branchId: "discover", origin: "record", sourceDates: ["2026-09-01"], explanation: "我的理解：先问具体发生过的事情。" }),
      expect.objectContaining({ id: "hypothesis", origin: "ai_supplement", sourceDates: [], supplementReason: "连接访谈发现与原型测试，明确测试究竟在验证什么。" }),
    ]), outline: expect.arrayContaining([expect.objectContaining({ conceptIds: ["hypothesis", "prototype"], body: "用测试结果检验假设，再解释如何调整方案。" })]),
  } });
});

it("only offers a title edit for mixed records and never rewrites source content", async () => {
  const requests: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_input, init) => {
    const body = JSON.parse(init.body); requests.push(body);
    return Response.json({ ok: true, data: { id: "map", result: body.result }, requestId: "edit" });
  }));
  mount(sourceRecordsFixture()); const user = userEvent.setup();
  expect(screen.getAllByRole("textbox")).toHaveLength(1);
  await user.clear(screen.getByLabelText("脉络名称"));
  await user.type(screen.getByLabelText("脉络名称"), "本周原始记录");
  await user.click(screen.getByRole("button", { name: "保存修改" }));
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0]).toEqual({ result: { ...sourceRecordsFixture(), title: "本周原始记录" }, expectedUpdatedAt: "2026-09-17T10:00:00Z" });
});

it("retains a concept-map draft on revision conflict", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: false, error: { code: "NARRATIVE_EDIT_CONFLICT", message: "内容已更新，请保留当前修改后重新打开。" }, requestId: "conflict" }, { status: 409 })));
  const { onSaved } = mount(knowledgeMapFixture()); const user = userEvent.setup();
  await user.clear(screen.getByLabelText("总览"));
  await user.type(screen.getByLabelText("总览"), "尚未保存的理解");
  await user.click(screen.getByRole("button", { name: "保存修改" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("内容已更新");
  expect(screen.getByLabelText("总览")).toHaveValue("尚未保存的理解");
  expect(onSaved).not.toHaveBeenCalled();
});
