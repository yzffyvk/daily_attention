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
  it("keeps a duplicate profile name as its meaningful 409 error", async () => {
    const profile = { id: "profile-1", avatarKey: 1, displayName: "学习者" };
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
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
          hasTodayRecord={false}
          initialProfile={profile}
          isCelebrating={false}
          isMuted={false}
          onRequestLogout={vi.fn()}
          onSelectToday={vi.fn()}
          onToggleMuted={vi.fn()}
          streak={0}
          today="2026-07-23"
          totalRecords={0}
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
