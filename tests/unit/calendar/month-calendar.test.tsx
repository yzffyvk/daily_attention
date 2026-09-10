import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MonthCalendar } from "@/features/calendar/month-calendar";
import type { CheckInSummary } from "@/features/checkins/types";

const summaries: CheckInSummary[] = [
  {
    date: "2026-07-25",
    attention: "梳理 RAG 的检索链路",
    hasImage: true,
    version: 1,
    updatedAt: "2026-07-25T10:00:00.000Z",
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
  it("previews the full saved title on hover without changing the selected date", async () => {
    const { onSelectDate } = renderCalendar();
    const day = screen.getByRole("button", { name: "7月25日，已保存：梳理 RAG 的检索链路" });
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
    const day = screen.getByRole("button", { name: "7月25日，已保存：梳理 RAG 的检索链路" });
    fireEvent.focus(day);
    expect(screen.getByRole("tooltip")).toHaveTextContent("梳理 RAG 的检索链路");
    fireEvent.keyDown(day, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    fireEvent.blur(day);
    await userEvent.click(day);
    expect(onSelectDate).toHaveBeenCalledWith("2026-07-25");
  });

  it("does not preview stale titles while the calendar is locked", () => {
    render(<MonthCalendar month="2026-07" selectedDate="2026-07-23" today="2026-07-24"
      summaries={summaries} disabled onMonthChange={vi.fn()} onSelectDate={vi.fn()} />);
    fireEvent.pointerEnter(screen.getByRole("button", { name: "7月25日，已保存：梳理 RAG 的检索链路" }));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("gives ordinary, today, completed, and selected dates stable names and states", () => {
    renderCalendar();

    const ordinary = screen.getByRole("button", { name: "7月22日，暂无记录" });
    const selected = screen.getByRole("button", { name: "7月23日，暂无记录，当前选中" });
    const today = screen.getByRole("button", { name: "7月24日，暂无记录，今天" });
    const completed = screen.getByRole("button", {
      name: "7月25日，已保存：梳理 RAG 的检索链路",
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
      screen.getByRole("button", { name: "7月25日，已保存：梳理 RAG 的检索链路" }),
    );
    expect(onSelectDate).toHaveBeenCalledWith("2026-07-25");
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
    expect(screen.queryByRole("button", { name: "7月22日，暂无记录" })).not.toBeInTheDocument();
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
