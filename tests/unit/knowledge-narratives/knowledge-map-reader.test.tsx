import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { NarrativeReader } from "@/features/knowledge-narratives/narrative-reader";
import type { KnowledgeNarrative, NarrativeResult } from "@/lib/domain/knowledge-narrative";
import { serializeLearningReflections } from "@/lib/domain/learning-reflections";
import { knowledgeMapFixture, knowledgeMapSourcesFixture, mapDates, sourceRecordsFixture } from "@/tests/helpers/knowledge-map-fixtures";

function narrative(result: NarrativeResult): KnowledgeNarrative {
  return { id: "map", title: result.title, dates: mapDates, question: "", status: "succeeded", createdAt: "2026-09-17T00:00:00Z", updatedAt: "2026-09-17T00:00:00Z", error: null, changedDates: [], sources: knowledgeMapSourcesFixture(), result };
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("brings mobile concept details into view even when activating the currently selected node", async () => {
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: query === "(max-width: 800px)" || query === "(prefers-reduced-motion: reduce)" })));
  render(<NarrativeReader narrative={narrative(knowledgeMapFixture())} />);
  const detail = screen.getByRole("region", { name: "概念详情" });
  const scroll = vi.fn();
  Object.defineProperty(detail, "scrollIntoView", { value: scroll });
  const graph = screen.getByRole("region", { name: "概念关系图" });
  const current = within(graph).getByRole("button", { name: "查看概念 用户访谈" });
  current.focus();
  await userEvent.keyboard("{Enter}");
  await waitFor(() => expect(detail).toHaveFocus());
  expect(scroll).toHaveBeenCalledWith({ block: "nearest", behavior: "auto" });
  await userEvent.click(within(graph).getByRole("button", { name: "定位概念 需求假设" }));
  await waitFor(() => expect(detail).toHaveFocus());
  expect(within(detail).getByRole("heading", { name: "需求假设" })).toBeVisible();
  expect(scroll).toHaveBeenCalledTimes(2);
});

it("keeps desktop graph focus on the activated node", async () => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
  render(<NarrativeReader narrative={narrative(knowledgeMapFixture())} />);
  const graph = screen.getByRole("region", { name: "概念关系图" });
  const target = within(graph).getByRole("button", { name: "查看概念 原型测试" });
  await userEvent.click(target);
  expect(target).toHaveFocus();
  expect(within(screen.getByRole("region", { name: "概念详情" })).getByRole("heading", { name: "原型测试" })).toBeVisible();
});

it("reopening the same source from a new citation scrolls it into view and restores the latest citation focus", async () => {
  render(<NarrativeReader narrative={narrative(knowledgeMapFixture())} />);
  const firstCitation = within(screen.getByRole("group", { name: "全部来源日期" })).getByRole("button", { name: `查看来源 ${mapDates[0]}` });
  await userEvent.click(firstCitation);
  const source = screen.getByRole("region", { name: `来源快照 ${mapDates[0]}` });
  await waitFor(() => expect(source).toHaveFocus());
  const scroll = vi.fn();
  Object.defineProperty(source, "scrollIntoView", { value: scroll });
  const latestCitation = within(screen.getByRole("region", { name: "概念详情" })).getByRole("button", { name: `查看来源 ${mapDates[0]}` });
  latestCitation.focus();
  await userEvent.keyboard("{Enter}");
  expect(source).toHaveFocus();
  expect(scroll).toHaveBeenCalledWith({ block: "nearest", behavior: "smooth" });
  await userEvent.click(within(source).getByRole("button", { name: "收起来源" }));
  expect(latestCitation).toHaveFocus();
});

it("describes material gaps as parts to explore", () => {
  render(<NarrativeReader narrative={narrative(knowledgeMapFixture())} />);
  expect(screen.getByRole("heading", { name: "待探索的部分" })).toBeVisible();
});

it("organizes selectable concepts by branches around a core question and keeps outline selections in sync", async () => {
  const result = knowledgeMapFixture();
  render(<NarrativeReader narrative={narrative(result)} />);
  const graph = screen.getByRole("region", { name: "概念关系图" });
  expect(within(graph).getByText(result.focusQuestion)).toBeVisible();
  expect(within(graph).getByRole("heading", { name: "理解用户" })).toBeVisible();
  expect(within(graph).getByText(result.branches[0].summary)).toBeVisible();
  expect(within(graph).getByRole("button", { name: "查看概念 用户访谈" })).toHaveAttribute("aria-pressed", "true");
  await userEvent.click(within(graph).getByRole("button", { name: "查看概念 需求假设" }));
  const detail = screen.getByRole("region", { name: "概念详情" });
  expect(within(detail).getByRole("heading", { name: "需求假设" })).toBeVisible();
  expect(within(detail).getByText(result.concepts[3].supplementReason)).toBeVisible();
  expect(within(detail).queryByRole("button", { name: /查看来源/ })).not.toBeInTheDocument();
  await userEvent.click(within(screen.getByRole("region", { name: "讲述提纲" })).getByRole("button", { name: "查看概念 原型测试" }));
  expect(within(detail).getByRole("heading", { name: "原型测试" })).toBeVisible();
  expect(within(graph).getByRole("button", { name: "查看概念 原型测试" })).toHaveAttribute("aria-pressed", "true");
});

it("labels relationship provenance and lets keyboard citations focus the saved source and restore focus on close", async () => {
  const result = knowledgeMapFixture();
  result.connections[0].origin = "record";
  render(<NarrativeReader narrative={narrative(result)} />);
  const relationships = screen.getByRole("region", { name: "关系说明" });
  expect(within(relationships).getByText("为判断提供线索")).toBeVisible();
  expect(within(relationships).getByText("记录依据")).toBeVisible();
  expect(within(relationships).getAllByText("AI 补充")).toHaveLength(2);
  const citations = screen.getByRole("group", { name: "全部来源日期" });
  for (const date of mapDates) expect(within(citations).getByRole("button", { name: `查看来源 ${date}` })).toBeVisible();
  const trigger = within(citations).getByRole("button", { name: `查看来源 ${mapDates[1]}` });
  trigger.focus();
  await userEvent.keyboard("{Enter}");
  const source = screen.getByRole("region", { name: `来源快照 ${mapDates[1]}` });
  await waitFor(() => expect(source).toHaveFocus());
  expect(source).toHaveTextContent("结合影响与成本，选择先验证的问题。");
  await userEvent.click(within(source).getByRole("button", { name: "收起来源" }));
  expect(trigger).toHaveFocus();
});

it("distinguishes inferred relationships from original record evidence", () => {
  render(<NarrativeReader narrative={narrative(knowledgeMapFixture())} />);
  expect(within(screen.getByRole("region", { name: "关系说明" })).getByText("基于记录推断")).toBeVisible();
});

it.each(["mixed_topics", "insufficient_material"] as const)("shows exact saved originals for %s without forcing a concept graph", reason => {
  const saved = narrative({ ...sourceRecordsFixture(), reason });
  const reflections = { explanation: "我的原话\n第二行", insights: "新的理解原文", ideas: "想法原文" };
  saved.sources[0] = { ...saved.sources[0], summary: "原文小结\n<script>文字</script>", inspiration: serializeLearningReflections(reflections), sourceUrl: "https://example.org/original?x=1", hasImage: true };
  render(<NarrativeReader narrative={saved} />);
  expect(screen.queryByRole("region", { name: "概念关系图" })).not.toBeInTheDocument();
  const source = screen.getByRole("region", { name: `来源快照 ${mapDates[0]}` });
  expect(source).toHaveTextContent(saved.sources[0].attention);
  expect(within(source).getByText(saved.sources[0].summary, { normalizer: value => value })).toBeVisible();
  for (const value of Object.values(reflections)) expect(within(source).getByText(value, { normalizer: value => value })).toBeVisible();
  expect(source).toHaveTextContent(saved.sources[0].sourceUrl);
  expect(source).not.toHaveTextContent("learning-reflections:v1");
  expect(screen.getAllByText("当日有图片笔记；生成内容未读取图片正文。")).toHaveLength(1);
  for (const date of mapDates) expect(screen.getByRole("region", { name: `来源快照 ${date}` })).toBeVisible();
  expect(screen.queryByRole("region", { name: "讲述提纲" })).not.toBeInTheDocument();
});
