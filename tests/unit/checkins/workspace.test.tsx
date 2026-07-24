import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CheckInWorkspace } from "@/features/checkins/checkin-workspace";
import { TestQueryProvider } from "@/tests/helpers/test-query-provider";

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CheckInWorkspace", () => {
  it("opens the unsaved switch dialog before changing dates", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input);
        if (path.includes("/api/checkins?month=")) {
          return response({ ok: true, data: [], requestId: "month-request" });
        }
        return response(
          {
            ok: false,
            error: { code: "NOT_FOUND", message: "这一天还没有打卡记录" },
            requestId: "date-request",
          },
          404,
        );
      }),
    );

    render(
      <TestQueryProvider>
        <CheckInWorkspace initialDate="2026-07-23" />
      </TestQueryProvider>,
    );

    await userEvent.type(screen.getByLabelText("attention"), "今天学习了 RAG");
    await userEvent.click(screen.getByRole("button", { name: /7月24日/ }));

    expect(screen.getByRole("dialog", { name: "尚未保存" })).toBeVisible();
    expect(screen.getByRole("button", { name: "保存并切换" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "放弃修改" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "取消" })).toBeEnabled();
  });
});
