import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppHeader } from "@/features/profile/app-header";
import { TestQueryProvider } from "@/tests/helpers/test-query-provider";

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("profile header", () => {
  it("loads lifetime totals and a cross-month current streak from the stats query", async () => {
    const profile = { id: "profile-1", avatarKey: 1, displayName: "学习者" };
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = String(input);
        if (path.startsWith("/api/checkins/stats?")) {
          return Promise.resolve(response({
            ok: true,
            data: {
              totalCount: 41,
              currentStreak: 6,
              hasTodayRecord: true,
            },
            requestId: "stats-request",
          }));
        }
        return Promise.resolve(response({
          ok: true,
          data: { profile },
          requestId: "profile-request",
        }));
      }),
    );

    render(
      <TestQueryProvider>
        <AppHeader
          initialProfile={profile}
          isCelebrating={false}
          isMuted={false}
          onRequestLogout={vi.fn()}
          onSelectToday={vi.fn()}
          onToggleMuted={vi.fn()}
          today="2026-07-01"
        />
      </TestQueryProvider>,
    );

    expect(await screen.findByText("41")).toBeVisible();
    expect(screen.getByText("6")).toBeVisible();
    expect(screen.getByText("累计记录")).toBeVisible();
    expect(screen.getByText("当前连续")).toBeVisible();
    expect(screen.getByText("已经打卡")).toBeVisible();
  });

  it("keeps a stats failure visible and independently retryable", async () => {
    const profile = { id: "profile-1", avatarKey: 1, displayName: "学习者" };
    let statsRequests = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = String(input);
        if (path.startsWith("/api/checkins/stats?")) {
          statsRequests += 1;
          if (statsRequests === 1) {
            return Promise.resolve(response({
              ok: false,
              error: {
                code: "SERVICE_UNAVAILABLE",
                message: "学习统计暂时不可用",
              },
              requestId: "stats-error-request",
            }, 503));
          }
          return Promise.resolve(response({
            ok: true,
            data: {
              totalCount: 12,
              currentStreak: 2,
              hasTodayRecord: false,
            },
            requestId: "stats-retry-request",
          }));
        }
        return Promise.resolve(response({
          ok: true,
          data: { profile },
          requestId: "profile-request",
        }));
      }),
    );

    render(
      <TestQueryProvider>
        <AppHeader
          initialProfile={profile}
          isCelebrating={false}
          isMuted={false}
          onRequestLogout={vi.fn()}
          onSelectToday={vi.fn()}
          onToggleMuted={vi.fn()}
          today="2026-07-01"
        />
      </TestQueryProvider>,
    );

    expect(await screen.findByRole("status", { name: "学习统计错误" })).toHaveTextContent(
      "学习统计暂时不可用",
    );
    await userEvent.click(screen.getByRole("button", { name: "重试学习统计" }));
    expect(await screen.findByText("12")).toBeVisible();
    expect(screen.queryByRole("status", { name: "学习统计错误" })).not.toBeInTheDocument();
  });

  it("keeps a duplicate profile name as its meaningful 409 error", async () => {
    const profile = { id: "profile-1", avatarKey: 1, displayName: "学习者" };
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).startsWith("/api/checkins/stats?")) {
          return Promise.resolve(response({
            ok: true,
            data: {
              totalCount: 0,
              currentStreak: 0,
              hasTodayRecord: false,
            },
            requestId: "stats-request",
          }));
        }
        if (init?.method === "PATCH") {
          return Promise.resolve(response({
            ok: false,
            error: {
              code: "NAME_TAKEN",
              message: "这个名称已经被使用",
              details: { field: "name" },
            },
            requestId: "name-taken-request",
          }, 409));
        }
        return Promise.resolve(response({
          ok: true,
          data: { profile },
          requestId: "profile-request",
        }));
      }),
    );

    render(
      <TestQueryProvider>
        <AppHeader
          initialProfile={profile}
          isCelebrating={false}
          isMuted={false}
          onRequestLogout={vi.fn()}
          onSelectToday={vi.fn()}
          onToggleMuted={vi.fn()}
          today="2026-07-23"
        />
      </TestQueryProvider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "打开账户菜单" }));
    await user.click(screen.getByRole("menuitem", { name: "编辑资料" }));
    await user.clear(screen.getByLabelText("名称"));
    await user.type(screen.getByLabelText("名称"), "已有名称");
    await user.type(screen.getByLabelText("当前密码"), "password123");
    await user.click(screen.getByRole("button", { name: "保存资料" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("这个名称已经被使用");
    expect(screen.getByLabelText("名称")).toHaveValue("已有名称");
    expect(screen.getByRole("dialog", { name: "编辑资料" })).toBeVisible();
  });
});
