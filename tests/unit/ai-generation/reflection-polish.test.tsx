import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ReflectionPolish } from "@/features/ai-generation/reflection-polish";
import { polishReflection } from "@/features/ai-generation/api";

vi.mock("@/features/ai-generation/api", () => ({ polishReflection: vi.fn() }));
const suggested = { polishedAnswer: "模型负责决策，工具让它执行行动。", knowledgePoints: ["模型与工具"], improvements: ["明确了决策和执行的分工。"], cautions: ["还可以结合上下文说明完整关系。"] };
const original = "模型思考，工具执行。";
const summary = "Agent 由模型、上下文和工具构成。";

function Harness({ knowledge = summary, limit = 2000, disabled = false }: { knowledge?: string; limit?: number; disabled?: boolean }) {
  const [answer, setAnswer] = useState(original);
  return <><label>我的回答<input value={answer} onChange={event => setAnswer(event.target.value)} /></label><ReflectionPolish
    input={{ topic: "Agent", summary: knowledge, answer, maxLength: limit }} disabled={disabled}
    canApply={text => text.length <= limit}
    onApply={text => { if (text.length > limit) return false; setAnswer(text); return true; }}
  /></>;
}

beforeEach(() => { vi.mocked(polishReflection).mockReset(); vi.mocked(polishReflection).mockResolvedValue(suggested); });
afterEach(cleanup);

it("previews a suggestion and changes the answer only on explicit adoption, with undo", async () => {
  render(<Harness />); const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "AI 润色" }));
  expect(await screen.findByRole("region", { name: "AI 润色建议" })).toBeVisible();
  expect(screen.getByLabelText("我的回答")).toHaveValue(original);
  expect(screen.getByText(suggested.cautions[0])).toBeVisible();
  await user.click(screen.getByRole("button", { name: "采纳建议" }));
  expect(screen.getByLabelText("我的回答")).toHaveValue(suggested.polishedAnswer);
  await user.click(screen.getByRole("button", { name: "撤销本次润色" }));
  expect(screen.getByLabelText("我的回答")).toHaveValue(original);
});

it("discards a late result when the learner edits their answer", async () => {
  let resolve!: (value: typeof suggested) => void;
  vi.mocked(polishReflection).mockImplementation(() => new Promise(done => { resolve = done; }));
  render(<Harness />); const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "AI 润色" }));
  const signal = vi.mocked(polishReflection).mock.calls[0][1];
  await user.type(screen.getByLabelText("我的回答"), "我又写了一句。");
  expect(signal?.aborted).toBe(true);
  await act(async () => resolve(suggested));
  expect(screen.queryByRole("button", { name: "采纳建议" })).not.toBeInTheDocument();
  expect(screen.getByLabelText("我的回答")).toHaveValue(original + "我又写了一句。");
});

it("invalidates a suggestion when the knowledge context changes", async () => {
  const view = render(<Harness />); const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "AI 润色" }));
  await screen.findByRole("region", { name: "AI 润色建议" });
  view.rerender(<Harness knowledge="光合作用的知识小结。" />);
  expect(screen.queryByRole("region", { name: "AI 润色建议" })).not.toBeInTheDocument();
  expect(screen.getByLabelText("我的回答")).toHaveValue(original);
});

it("allows cancellation and retry without changing the answer", async () => {
  vi.mocked(polishReflection).mockImplementationOnce(() => new Promise(() => {}));
  render(<Harness />); const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "AI 润色" }));
  const signal = vi.mocked(polishReflection).mock.calls[0][1];
  await user.click(screen.getByRole("button", { name: "取消润色" }));
  expect(signal?.aborted).toBe(true);
  await user.click(screen.getByRole("button", { name: "AI 润色" }));
  await screen.findByRole("region", { name: "AI 润色建议" });
  await user.click(screen.getByRole("button", { name: "保留原文" }));
  expect(screen.getByLabelText("我的回答")).toHaveValue(original);
  expect(screen.queryByRole("region", { name: "AI 润色建议" })).not.toBeInTheDocument();
});

it("keeps an error recoverable and does not expose internal error text", async () => {
  vi.mocked(polishReflection).mockRejectedValueOnce(new Error("provider secret/internal error"));
  render(<Harness />); const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "AI 润色" }));
  expect(await screen.findByRole("alert")).not.toHaveTextContent("secret");
  expect(screen.getByLabelText("我的回答")).toHaveValue(original);
  expect(screen.getByRole("button", { name: "AI 润色" })).toBeEnabled();
});

it("blocks adoption that exceeds the full reflection allowance", async () => {
  render(<Harness limit={10} />); const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "AI 润色" }));
  await screen.findByRole("region", { name: "AI 润色建议" });
  expect(screen.getByRole("button", { name: "采纳建议" })).toBeDisabled();
  expect(screen.getByLabelText("我的回答")).toHaveValue(original);
});

it("requires an answer and available knowledge before requesting polish", async () => {
  const view = render(<Harness knowledge="" />); const user = userEvent.setup();
  expect(screen.getByRole("button", { name: "AI 润色" })).toBeDisabled();
  view.rerender(<Harness />);
  await user.clear(screen.getByLabelText("我的回答"));
  expect(screen.getByRole("button", { name: "AI 润色" })).toBeDisabled();
  expect(polishReflection).not.toHaveBeenCalled();
});
