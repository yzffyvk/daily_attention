import { cleanup, render, screen } from "@testing-library/react";
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
});
