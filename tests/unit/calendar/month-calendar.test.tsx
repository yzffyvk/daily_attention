import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MonthCalendar } from "@/features/calendar/month-calendar";
import type { CheckInSummary } from "@/features/checkins/types";

const summaries: CheckInSummary[] = [
  {
    date: "2026-07-22",
    attention: "梳理 RAG 的检索链路",
    hasImage: true,
    version: 1,
    updatedAt: "2026-07-22T10:00:00.000Z",
  },
];

function renderCalendar() {
  const onSelectDate = vi.fn();
  render(
    <MonthCalendar
      month="2026-07"
      onMonthChange={vi.fn()}
      onSelectDate={onSelectDate}
      selectedDate="2026-07-23"
      summaries={summaries}
      today="2026-07-24"
    />,
  );
  return { onSelectDate };
}

afterEach(() => {
  cleanup();
});

describe("MonthCalendar", () => {
  it("keeps today marked independently of the selected date and explains future dates", () => {
    renderCalendar();
    const today = screen.getByRole("button", { name: "7月24日，暂无记录，今天" });
    expect(within(today).getByText("今", { exact: true })).toBeInTheDocument();
    expect(today).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: /7月25日.*未到日期/ })).toBeDisabled();
    expect(screen.getByText("可记录今天及以前的收获")).toBeInTheDocument();
    expect(screen.getByText("未到日期", { exact: true })).toBeInTheDocument();
  });

  it("counts saved days once per viewed month, excluding future dates", () => {
    const props = { month: "2026-07", selectedDate: "2026-07-23", today: "2026-07-24", onMonthChange: vi.fn(), onSelectDate: vi.fn(),
      summaries: [
        { ...summaries[0], entryMode: "manual" as const },
        { ...summaries[0], entryMode: "ai" as const },
        { ...summaries[0], date: "2026-07-21" },
        { ...summaries[0], date: "2026-08-01" },
        { ...summaries[0], date: "2026-07-25" },
      ] };
    const { rerender } = render(<MonthCalendar {...props} />);
    expect(screen.getByRole("status", { name: "本月学习积累" })).toHaveTextContent("2 天");
    rerender(<MonthCalendar {...props} month="2026-08" />);
    expect(screen.getByRole("status", { name: "本月学习积累" })).toHaveTextContent("这个月还未到来");
  });

  it("shows a compact title and lets the selected day's full entries open their saved mode", async () => {
    const onSelectEntryMode = vi.fn();
    render(<MonthCalendar month="2026-07" selectedDate="2026-07-22" today="2026-07-24" activeEntryMode="manual" onSelectEntryMode={onSelectEntryMode}
      summaries={[{ ...summaries[0], entryMode: "ai", attention: "AI 小结" }, { ...summaries[0], entryMode: "manual", attention: "手动小结" }]}
      onMonthChange={vi.fn()} onSelectDate={vi.fn()} />);
    const day = screen.getByRole("button", { name: /7月22日，已保存/ });
    expect(within(day).getByText("手动小结", { exact: true })).toBeInTheDocument();
    expect(within(day).queryByText("AI 小结", { exact: true })).not.toBeInTheDocument();
    const details = screen.getByRole("region", { name: "7月22日的收获" });
    expect(details).toHaveTextContent("手动小结");
    expect(details).toHaveTextContent("AI 小结");
    await userEvent.click(within(details).getByRole("button", { name: "查看这天的 AI 提炼" }));
    expect(onSelectEntryMode).toHaveBeenCalledWith("ai");
  });

  it("explains an empty current mode while retaining the saved entry in the other mode", async () => {
    const onSelectEntryMode = vi.fn();
    const props = { month: "2026-07", selectedDate: "2026-07-22", today: "2026-07-24", activeEntryMode: "manual" as const, onSelectEntryMode,
      summaries: [{ ...summaries[0], entryMode: "ai" as const }], onMonthChange: vi.fn(), onSelectDate: vi.fn() };
    const { rerender } = render(<MonthCalendar {...props} />);
    const details = screen.getByRole("region", { name: "7月22日的收获" });
    expect(details).toHaveTextContent("手动记录尚未保存");
    const open = within(details).getByRole("button", { name: "查看这天的 AI 提炼" });
    rerender(<MonthCalendar {...props} disabled />);
    expect(open).toBeDisabled();
    await userEvent.click(open);
    expect(onSelectEntryMode).not.toHaveBeenCalled();
  });

  it("does not add a single-day reader to the multi-select calendar", () => {
    render(<MonthCalendar month="2026-07" selectedDate="2026-07-22" selectedDates={["2026-07-22"]} summaries={summaries} today="2026-07-24" onMonthChange={vi.fn()} onSelectDate={vi.fn()} />);
    expect(screen.queryByRole("region", { name: "7月22日的收获" })).not.toBeInTheDocument();
    expect(screen.getByText("选择 2–14 个已保存日期，可跨月、不连续选择")).toBeInTheDocument();
  });
  it("disables future dates, including previously saved future entries", async () => {
    const onSelectDate = vi.fn();
    const props = { month: "2026-07", selectedDate: "2026-07-24", today: "2026-07-24",
      summaries: [{ ...summaries[0], date: "2026-07-25" }], onMonthChange: vi.fn(), onSelectDate };
    const { rerender } = render(<MonthCalendar {...props} />);
    expect(screen.getByRole("button", { name: /7月24日/ })).toBeEnabled();
    const tomorrow = screen.getByRole("button", { name: /7月25日/ });
    expect(tomorrow).toBeDisabled();
    expect(screen.getByRole("button", { name: /7月26日/ })).toBeDisabled();
    await userEvent.click(tomorrow);
    expect(onSelectDate).not.toHaveBeenCalled();
    rerender(<MonthCalendar {...props} today="2026-07-25" />);
    expect(screen.getByRole("button", { name: /7月25日/ })).toBeEnabled();
  });
  it("shows both same-day mode titles in one calendar day", () => {
    render(<MonthCalendar month="2026-07" selectedDate="2026-07-23" today="2026-07-24"
      summaries={[
        { ...summaries[0], entryMode: "ai", attention: "AI 小结" },
        { ...summaries[0], entryMode: "manual", attention: "手动小结" },
      ]} onMonthChange={vi.fn()} onSelectDate={vi.fn()} />);
    const day = screen.getByRole("button", { name: "7月22日，已保存：手动：手动小结 · AI：AI 小结" });
    expect(screen.getAllByRole("button", { name: /7月22日/ })).toHaveLength(1);
    fireEvent.focus(day);
    expect(screen.getByRole("tooltip")).toHaveTextContent("手动：手动小结 · AI：AI 小结");
  });

  it("limits multi-selection to fourteen saved days while permitting deselection", () => {
    const selectedDates = Array.from({ length: 14 }, (_, index) => `2026-07-${String(index + 1).padStart(2, "0")}`);
    const saved = [...selectedDates, "2026-07-15"].map(date => ({ ...summaries[0], date }));
    render(<MonthCalendar month="2026-07" selectedDate="" selectedDates={selectedDates} summaries={saved} today="2026-07-24" onMonthChange={vi.fn()} onSelectDate={vi.fn()} />);
    expect(screen.getByRole("button", { name: /7月15日，已保存/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /7月14日，已保存/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /7月14日，已保存/ })).toHaveAttribute("aria-pressed", "true");
  });
  it("previews the full saved title on hover without changing the selected date", async () => {
    const { onSelectDate } = renderCalendar();
    const day = screen.getByRole("button", { name: "7月22日，已保存：梳理 RAG 的检索链路" });
    const user = userEvent.setup();
    await user.hover(day);
    expect(screen.getByRole("tooltip")).toHaveTextContent("梳理 RAG 的检索链路");
    expect(day).toHaveAttribute("aria-describedby", screen.getByRole("tooltip").id);
    expect(onSelectDate).not.toHaveBeenCalled();
    await user.unhover(day);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("lets keyboard users preview a title, dismiss it with Escape, and still select the date", async () => {
    const { onSelectDate } = renderCalendar();
    const day = screen.getByRole("button", { name: "7月22日，已保存：梳理 RAG 的检索链路" });
    fireEvent.focus(day);
    expect(screen.getByRole("tooltip")).toHaveTextContent("梳理 RAG 的检索链路");
    fireEvent.keyDown(day, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    fireEvent.blur(day);
    await userEvent.click(day);
    expect(onSelectDate).toHaveBeenCalledWith("2026-07-22");
  });

  it("does not preview stale titles while the calendar is locked", () => {
    render(<MonthCalendar month="2026-07" selectedDate="2026-07-23" today="2026-07-24"
      summaries={summaries} disabled onMonthChange={vi.fn()} onSelectDate={vi.fn()} />);
    fireEvent.pointerEnter(screen.getByRole("button", { name: "7月22日，已保存：梳理 RAG 的检索链路" }));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("gives ordinary, today, completed, and selected dates stable names and states", () => {
    renderCalendar();

    const ordinary = screen.getByRole("button", { name: "7月21日，暂无记录" });
    const selected = screen.getByRole("button", { name: "7月23日，暂无记录，当前选中" });
    const today = screen.getByRole("button", { name: "7月24日，暂无记录，今天" });
    const completed = screen.getByRole("button", {
      name: "7月22日，已保存：梳理 RAG 的检索链路",
    });

    expect(ordinary).toHaveAttribute("aria-pressed", "false");
    expect(selected).toHaveAttribute("aria-pressed", "true");
    expect(today).toHaveClass("today");
    expect(completed).toHaveClass("recorded");
    expect(completed).toHaveTextContent("梳理 RAG 的检索链路");
  });

  it("selects the clicked date", async () => {
    const { onSelectDate } = renderCalendar();
    await userEvent.click(
      screen.getByRole("button", { name: "7月22日，已保存：梳理 RAG 的检索链路" }),
    );
    expect(onSelectDate).toHaveBeenCalledWith("2026-07-22");
  });

  it("shows an accessible loading state instead of an empty month before data arrives", () => {
    render(
      <MonthCalendar
        isLoading
        month="2026-07"
        onMonthChange={vi.fn()}
        onRetry={vi.fn()}
        onSelectDate={vi.fn()}
        selectedDate="2026-07-23"
        summaries={undefined}
        today="2026-07-24"
      />,
    );

    expect(screen.getByRole("status", { name: "正在读取月度记录" })).toBeVisible();
    expect(screen.queryByLabelText("月度学习日历")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "7月21日，暂无记录" })).not.toBeInTheDocument();
  });

  it("shows a retryable month error without presenting unknown dates as empty", async () => {
    const onRetry = vi.fn();
    render(
      <MonthCalendar
        errorMessage="月度记录读取失败"
        isRetrying={false}
        month="2026-07"
        onMonthChange={vi.fn()}
        onRetry={onRetry}
        onSelectDate={vi.fn()}
        selectedDate="2026-07-23"
        summaries={undefined}
        today="2026-07-24"
      />,
    );

    expect(screen.getByRole("alert", { name: "月度记录读取失败" })).toBeVisible();
    expect(screen.queryByLabelText("月度学习日历")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "重试月度记录" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
