import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DailyTakeawayEntry } from "@/features/daily-takeaways/daily-takeaway-entry";
import { TestQueryProvider } from "@/tests/helpers/test-query-provider";
import { takeawayFixture } from "@/tests/helpers/daily-takeaways-fixture";
import { tennisLessons } from "@/lib/domain/tennis-lessons";
import type { TakeawayAction, TakeawayState } from "@/lib/domain/daily-takeaway";
import { getTakeawayState } from "@/features/daily-takeaways/api";

function setup(initial = takeawayFixture(), failFirst = false) {
  let state = initial;
  let failures = failFirst ? 1 : 0;
  const actions: TakeawayAction[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      const input: TakeawayAction = JSON.parse(String(init.body));
      actions.push(input);
      if (failures-- > 0) return Response.json({ ok: false, error: { code: "TAKEAWAY_UNAVAILABLE", message: "暂时无法连接，请重试" }, requestId: "test" }, { status: 503 });
      const lesson = tennisLessons.find(l => l.id === input.lessonId)!;
      if (input.action === "collect") state = { ...state, currentLesson: null, history: [{ lesson, learningDate: state.today, collectedAt: "2026-10-09T03:00:00Z", collectedVersion: lesson.version }, ...state.history] };
      if (input.action === "skip") state = { ...state, currentLesson: tennisLessons[lesson.sequence] ?? null, skippedCount: state.skippedCount + 1 };
      if (input.action === "quiz") state = { ...state, quizResults: [{ lessonId: lesson.id, version: lesson.version, answerIndex: input.answerIndex, correct: input.answerIndex === lesson.quiz.correctIndex, answeredAt: "2026-10-09T03:00:00Z" }] };
    }
    return Response.json({ ok: true, data: state, requestId: "test" });
  }));
  const view = render(<TestQueryProvider><DailyTakeawayEntry userId="learner" /></TestQueryProvider>);
  return { ...view, actions, user: userEvent.setup(), update: (next: TakeawayState) => { state = next; } };
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("daily takeaway experience", () => {
  it("does not open or complete automatically; allows collection without a quiz", async () => {
    const { user, actions } = setup();
    const open = await screen.findByRole("button", { name: "读今日新知" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(open);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(tennisLessons[0].conclusion)).toBeInTheDocument();
    expect(actions).toEqual([]);
    await user.click(within(dialog).getByRole("button", { name: "收下今日新知" }));
    await within(dialog).findByText("今天带走了");
    expect(actions).toEqual([{ action: "collect", lessonId: "tennis-01", version: 1 }]);
    expect(within(dialog).getByText(/累计收下 1 条/)).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "收下今日新知" })).not.toBeInTheDocument();
  });

  it("explains a wrong answer without adding a collection or blocking completion", async () => {
    const { user, actions } = setup();
    await user.click(await screen.findByRole("button", { name: "读今日新知" }));
    await user.click(screen.getByText("做一道小判断"));
    await user.click(screen.getByRole("radio", { name: tennisLessons[0].quiz.options[1] }));
    expect(await screen.findByText(tennisLessons[0].quiz.explanation)).toBeInTheDocument();
    expect(actions[0].action).toBe("quiz");
    expect(screen.getByRole("button", { name: "收下今日新知" })).toBeEnabled();
    expect(screen.getByText("累计收下 0 条")).toBeInTheDocument();
  });

  it("keeps content and counts unchanged after a failed save, then retries", async () => {
    const { user, actions } = setup(takeawayFixture(), true);
    await user.click(await screen.findByRole("button", { name: "读今日新知" }));
    await user.click(screen.getByRole("button", { name: "收下今日新知" }));
    await screen.findByRole("alert");
    expect(screen.getByText(tennisLessons[0].conclusion)).toBeInTheDocument();
    expect(screen.getByText("累计收下 0 条")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "收下今日新知" }));
    await screen.findByText("今天带走了");
    expect(actions).toHaveLength(2);
  });

  it("skips known material without collecting it", async () => {
    const { user, actions } = setup();
    await user.click(await screen.findByRole("button", { name: "读今日新知" }));
    await user.click(screen.getByRole("button", { name: "这条我已了解" }));
    await screen.findByText(tennisLessons[1].conclusion);
    expect(actions[0]).toEqual({ action: "skip", lessonId: "tennis-01", version: 1 });
    expect(screen.getByText("累计收下 0 条")).toBeInTheDocument();
  });

  it("filters history by topic, supports rereading and restores the opener focus", async () => {
    const history = [0, 1].map((i) => ({ lesson: tennisLessons[i], learningDate: `2026-10-0${i + 7}`, collectedAt: `2026-10-0${i + 7}T03:00:00Z`, collectedVersion: 1 }));
    const { user } = setup(takeawayFixture({ currentLesson: tennisLessons[2], history }));
    const open = await screen.findByRole("button", { name: /我的新知/ });
    await user.click(open);
    await user.selectOptions(screen.getByLabelText("按主题筛选"), "terms");
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByRole("button", { name: new RegExp(tennisLessons[0].question) })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: new RegExp(tennisLessons[1].question) }));
    expect(within(dialog).getByText(tennisLessons[1].conclusion)).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "收下今日新知" })).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(open).toHaveFocus();
  });

  it("offers review after exhaustion without recycling or punishing skipped items", async () => {
    setup(takeawayFixture({ currentLesson: null, skippedCount: 30 }));
    expect(await screen.findByText("本阶段已完成")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "读今日新知" })).not.toBeInTheDocument();
    expect(screen.getByText("累计收下 0 条")).toBeInTheDocument();
  });

  it("does not let a GET started during collection overwrite the saved receipt", async () => {
    const initial = takeawayFixture();
    const saved = takeawayFixture({ currentLesson: null, history: [{ lesson: tennisLessons[0], learningDate: initial.today, collectedAt: "2026-10-09T03:00:00Z", collectedVersion: 1 }] });
    const response = (state: TakeawayState) => Response.json({ ok: true, data: state, requestId: "race" });
    let finishSave: ((value: Response) => void) | undefined;
    let finishStaleRead: ((value: Response) => void) | undefined;
    let reads = 0;
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") return new Promise<Response>(resolve => { finishSave = resolve; });
      if (reads++ === 0) return response(initial);
      return new Promise<Response>(resolve => { finishStaleRead = resolve; });
    }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><DailyTakeawayEntry userId="learner" /></QueryClientProvider>);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "读今日新知" }));
    await user.click(screen.getByRole("button", { name: "收下今日新知" }));
    await waitFor(() => expect(finishSave).toBeDefined());
    let pendingRead: Promise<unknown>;
    act(() => { pendingRead = client.fetchQuery({ queryKey: ["daily-takeaways", "learner"], queryFn: ({ signal }) => getTakeawayState(signal), staleTime: 0 }).catch(() => undefined); });
    await waitFor(() => expect(finishStaleRead).toBeDefined());
    await act(async () => { finishSave!(response(saved)); });
    await screen.findByText("今天带走了");
    await act(async () => { finishStaleRead!(response(initial)); await pendingRead; });
    expect(client.getQueryData<TakeawayState>(["daily-takeaways", "learner"])?.history).toHaveLength(1);
    expect(screen.getByText("累计收下 1 条")).toBeInTheDocument();
  });

  it("keeps the opened lesson stable when midnight or another device changes the state", async () => {
    const initial = takeawayFixture();
    let current = initial;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true, data: current, requestId: "stable-reader" })));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><DailyTakeawayEntry userId="learner" /></QueryClientProvider>);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "读今日新知" }));
    current = takeawayFixture({ today: "2026-10-10", nextAvailableAt: "2026-10-10T16:00:00Z", currentLesson: tennisLessons[1], skippedCount: 1 });
    act(() => { client.setQueryData(["daily-takeaways", "learner"], current); });
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(tennisLessons[0].conclusion)).toBeInTheDocument();
    expect(within(dialog).queryByText(tennisLessons[1].conclusion)).not.toBeInTheDocument();
    await user.click(await within(dialog).findByRole("button", { name: "载入最新进度" }));
    expect(await within(dialog).findByText(tennisLessons[1].conclusion)).toBeInTheDocument();
  });
});
